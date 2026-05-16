"""Proxy to Vertex AI / Agent Platform countTokens REST API.

Endpoint (regional):
    POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/
         locations/{LOCATION}/publishers/google/models/{MODEL}:countTokens

Endpoint (global — Gemini 3.1 Flash Image is served here):
    POST https://aiplatform.googleapis.com/v1/projects/{PROJECT}/
         locations/global/publishers/google/models/{MODEL}:countTokens

Auth: ADC (Application Default Credentials). The same identity used by
Cloud Monitoring must have aiplatform.endpoints.predict (or the broader
roles/aiplatform.user) on PROJECT.

Project / location resolution (in priority order):
  1. GOOGLE_CLOUD_PROJECT  / GOOGLE_CLOUD_LOCATION  env vars
  2. ADC default project   / fallback location ("global")

Docs:
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/get-token-count
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image
"""

from __future__ import annotations

import base64
import os
from typing import Any

import google.auth
import google.auth.transport.requests
import httpx


DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
# Gemini 3.1 Flash Image is served from the global endpoint, not a regional one.
DEFAULT_LOCATION = "global"
_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class TokenCountError(RuntimeError):
    pass


# ── Credential / config resolution ──────────────────────────────────────────

_creds = None  # cached google.auth credentials (token auto-refreshed below)


def _get_credentials():
    """Return cached ADC credentials, fetching on first use."""
    global _creds
    if _creds is None:
        try:
            creds, _ = google.auth.default(scopes=[_SCOPE])
        except Exception as e:
            raise TokenCountError(
                "ADC not configured. Run `gcloud auth application-default login` "
                f"or set GOOGLE_APPLICATION_CREDENTIALS. Original: {e}"
            )
        _creds = creds
    return _creds


def _bearer_token() -> str:
    """Return a fresh OAuth2 access token from ADC."""
    creds = _get_credentials()
    if not creds.valid:
        creds.refresh(google.auth.transport.requests.Request())
    if not creds.token:
        raise TokenCountError("ADC returned no access token after refresh.")
    return creds.token


def _project_id() -> str:
    """Resolve the GCP project: env var first, then ADC default."""
    env = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if env:
        return env
    try:
        _, project = google.auth.default(scopes=[_SCOPE])
    except Exception as e:
        raise TokenCountError(f"Could not resolve project from ADC: {e}")
    if not project:
        raise TokenCountError(
            "No GCP project. Set GOOGLE_CLOUD_PROJECT or configure ADC with "
            "a default project (e.g. `gcloud config set project ...`)."
        )
    return project


def _location() -> str:
    return os.environ.get("GOOGLE_CLOUD_LOCATION") or DEFAULT_LOCATION


# ── Request shaping ─────────────────────────────────────────────────────────


def _build_parts(
    *,
    text: str | None = None,
    images: list[tuple[bytes, str]] | None = None,
) -> list[dict[str, Any]]:
    """Build a contents.parts list. `images` is [(bytes, mime), ...]."""
    parts: list[dict[str, Any]] = []
    if text:
        parts.append({"text": text})
    for image_bytes, image_mime in images or []:
        if not image_mime:
            raise TokenCountError("image_mime required for every image")
        parts.append(
            {
                "inline_data": {
                    "mime_type": image_mime,
                    "data": base64.b64encode(image_bytes).decode(),
                }
            }
        )
    if not parts:
        raise TokenCountError("countTokens called with empty content")
    return parts


def _endpoint(model: str) -> str:
    location = _location()
    project = _project_id()
    # The global endpoint has no region prefix in the host.
    host = (
        "aiplatform.googleapis.com"
        if location == "global"
        else f"{location}-aiplatform.googleapis.com"
    )
    return (
        f"https://{host}/v1"
        f"/projects/{project}/locations/{location}"
        f"/publishers/google/models/{model}:countTokens"
    )


# ── Public API ──────────────────────────────────────────────────────────────


def _sanitize_body_for_display(body: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the request body with inline image bytes elided.

    Vertex inline_data.data is a base64 blob that can be megabytes long —
    useless and slow to render in the UI. Replace it with a placeholder that
    notes the byte count.
    """
    import copy
    out = copy.deepcopy(body)
    for content in out.get("contents", []):
        for part in content.get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if isinstance(inline, dict) and inline.get("data"):
                b64 = inline["data"]
                # base64 → ~3/4 of length is original bytes
                approx_bytes = (len(b64) * 3) // 4
                inline["data"] = f"<base64 elided · ~{approx_bytes:,} bytes>"
    return out


def _split_modality_counts(details: list[dict[str, Any]]) -> dict[str, int]:
    """Roll up a *TokensDetails list into {TEXT: n, IMAGE: n, ...}."""
    out: dict[str, int] = {}
    for d in details or []:
        modality = (d.get("modality") or "").upper()
        if not modality:
            continue
        out[modality] = out.get(modality, 0) + int(d.get("tokenCount", 0))
    return out


def _count_once(
    *,
    text: str | None,
    images: list[tuple[bytes, str]] | None,
    model: str,
) -> dict[str, Any]:
    """One countTokens call. Returns {total, by_modality}. `by_modality` may
    be empty if Vertex didn't include `promptTokensDetails` in the response."""
    body = {
        "contents": [
            {
                "role": "USER",
                "parts": _build_parts(text=text, images=images),
            }
        ]
    }
    url = _endpoint(model)
    resp = httpx.post(
        url,
        headers={
            "Authorization": f"Bearer {_bearer_token()}",
            "Content-Type": "application/json; charset=utf-8",
        },
        json=body,
        timeout=30,
    )
    if resp.status_code != 200:
        raise TokenCountError(
            f"countTokens failed ({resp.status_code}): {resp.text[:300]}"
        )
    data = resp.json()
    return {
        "total": int(data.get("totalTokens", 0)),
        "by_modality": _split_modality_counts(data.get("promptTokensDetails") or []),
        "request": {"url": url, "body": _sanitize_body_for_display(body)},
    }


def count_tokens(
    *,
    text: str | None = None,
    images: list[tuple[bytes, str]] | None = None,
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Count tokens with a guaranteed per-modality breakdown.

    Accepts any number of inline images (each a (bytes, mime) tuple).

    Vertex's countTokens may or may not include `promptTokensDetails` depending
    on the model. We try one combined call first; if the breakdown is missing
    AND both text + images were provided, we fall back to two separate calls so
    we can still attribute counts to the right modality.

    Returns:
        {
          "total": int,
          "by_modality": {"TEXT": int, "IMAGE": int},   # always populated
        }
    """
    images = images or []
    has_images = len(images) > 0

    first = _count_once(text=text, images=images, model=model)
    by_modality = first["by_modality"]
    request = first["request"]

    # Happy path: the model gave us a breakdown.
    if by_modality:
        by_modality.setdefault("TEXT", 0)
        by_modality.setdefault("IMAGE", 0)
        return {"total": first["total"], "by_modality": by_modality, "request": request}

    # No breakdown returned. Attribute single-modality calls fully.
    total = first["total"]
    if text and not has_images:
        return {"total": total, "by_modality": {"TEXT": total, "IMAGE": 0}, "request": request}
    if has_images and not text:
        return {"total": total, "by_modality": {"TEXT": 0, "IMAGE": total}, "request": request}

    # Both modalities sent + no breakdown — re-count each modality alone to
    # get an accurate split.
    if text and has_images:
        text_only = _count_once(text=text, images=None, model=model)
        image_only = _count_once(text=None, images=images, model=model)
        return {
            "total": text_only["total"] + image_only["total"],
            "by_modality": {
                "TEXT": text_only["total"],
                "IMAGE": image_only["total"],
            },
            # Show the primary combined call. Note that the fallback path made
            # two extra calls (text-only + image-only) to split modality.
            "request": request,
            "fallback_used": True,
        }

    return {"total": total, "by_modality": {"TEXT": 0, "IMAGE": 0}, "request": request}
