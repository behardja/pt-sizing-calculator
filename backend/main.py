"""FastAPI app exposing /api/monitoring/query, /api/count-tokens, /api/run-and-count."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import generate as generate_mod
from . import monitoring as monitoring_mod
from . import tokens as tokens_mod


app = FastAPI(title="PT Sizing Calculator API")

# CORS only matters for direct browser calls (Vite proxies, but useful for dev curl).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/host-project")
def host_project() -> dict[str, str | None]:
    """Best-effort detect the GCP project the backend is running against.

    Tries Application Default Credentials first (works locally and on GCE);
    falls back to the GCE metadata server for the project of the host VM.
    Returns {"project_id": null} if neither works — the UI can show empty.
    """
    import google.auth
    import urllib.request

    try:
        _, project = google.auth.default()
        if project:
            return {"project_id": project, "source": "adc"}
    except Exception:
        pass

    try:
        req = urllib.request.Request(
            "http://metadata.google.internal/computeMetadata/v1/project/project-id",
            headers={"Metadata-Flavor": "Google"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            return {"project_id": resp.read().decode().strip(), "source": "metadata"}
    except Exception:
        pass

    return {"project_id": None, "source": None}


class MonitoringQueryBody(BaseModel):
    project_id: str
    model: str = "gemini-3.1-flash-image-preview"
    window_days: int = 7
    # Time-of-day filter — defaults preserve "no filter" behavior.
    days_of_week: list[int] | None = None     # Mon=0…Sun=6; None/empty = all
    hour_start: int = 0                       # inclusive
    hour_end: int = 24                        # exclusive
    timezone: str = "UTC"                     # IANA name


@app.post("/api/monitoring/query")
def post_monitoring_query(body: MonitoringQueryBody) -> dict[str, Any]:
    try:
        return monitoring_mod.query_historical(
            project_id=body.project_id,
            model=body.model,
            window_days=body.window_days,
            days_of_week=body.days_of_week,
            hour_start=body.hour_start,
            hour_end=body.hour_end,
            timezone=body.timezone,
        )
    except ValueError as e:
        # Bad timezone or other input validation issue.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        msg = str(e)
        status = 500
        lower = msg.lower()
        if "permission" in lower or "denied" in lower or "403" in lower:
            status = 403
            msg = (
                f"Cloud Monitoring permission denied on project {body.project_id!r}. "
                f"ADC identity needs roles/monitoring.viewer. Original: {msg}"
            )
        elif "unauthenticated" in lower or "401" in lower:
            status = 401
            msg = (
                "ADC missing or invalid. Run `gcloud auth application-default login` "
                f"or set GOOGLE_APPLICATION_CREDENTIALS. Original: {msg}"
            )
        raise HTTPException(status_code=status, detail=msg)


@app.post("/api/count-tokens")
async def post_count_tokens(
    kind: str = Form(...),
    text: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    model: str = Form(default=tokens_mod.DEFAULT_MODEL),
) -> dict[str, Any]:
    """Count tokens for one sample of a given `kind` (input | output_text | output_image).

    Accepts either text, image, or both as parts of a single sample.
    """
    if kind not in {"input", "output_text", "output_image"}:
        raise HTTPException(
            status_code=400,
            detail=f"kind must be one of input | output_text | output_image, got {kind!r}",
        )

    image_bytes = None
    image_mime = None
    image_filename = None
    if image is not None:
        image_bytes = await image.read()
        image_mime = image.content_type or "image/png"
        image_filename = image.filename

    if not text and image_bytes is None:
        raise HTTPException(
            status_code=400, detail="Provide text, an image, or both."
        )

    try:
        total = tokens_mod.count_tokens(
            text=text,
            image_bytes=image_bytes,
            image_mime=image_mime,
            model=model,
        )
    except tokens_mod.TokenCountError as e:
        msg = str(e)
        lower = msg.lower()
        status = 502
        if "permission" in lower or "denied" in lower or "403" in lower:
            status = 403
        elif "unauthenticated" in lower or "401" in lower or "adc" in lower:
            status = 401
        raise HTTPException(status_code=status, detail=msg)

    return {
        "kind": kind,
        "total_tokens": total,
        "sample": {
            "filename": image_filename,
            "mime": image_mime,
            "has_text": bool(text),
            "text_chars": len(text) if text else 0,
        },
        "model": model,
    }


@app.post("/api/run-and-count")
async def post_run_and_count(
    text: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    model: str = Form(default=tokens_mod.DEFAULT_MODEL),
) -> dict[str, Any]:
    """Run a single generateContent call and return per-modality token counts.

    Used by the input card's "Run to est. outputs" action — one model call
    populates a3 (input), a4 (output text), a5 (output image) all at once.

    Note: this IS a billed model call, unlike /api/count-tokens.
    """
    image_bytes = None
    image_mime = None
    if image is not None:
        image_bytes = await image.read()
        image_mime = image.content_type or "image/png"

    if not text and image_bytes is None:
        raise HTTPException(
            status_code=400, detail="Provide text, an image, or both."
        )

    try:
        result = generate_mod.run_and_count(
            text=text,
            image_bytes=image_bytes,
            image_mime=image_mime,
            model=model,
        )
    except generate_mod.GenerateError as e:
        msg = str(e)
        lower = msg.lower()
        status = 502
        if "permission" in lower or "denied" in lower or "403" in lower:
            status = 403
        elif "unauthenticated" in lower or "401" in lower or "adc" in lower:
            status = 401
        elif "404" in lower:
            status = 404
        raise HTTPException(status_code=status, detail=msg)

    return {**result, "model": model}
