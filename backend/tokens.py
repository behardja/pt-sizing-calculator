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
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if text:
        parts.append({"text": text})
    if image_bytes is not None:
        if not image_mime:
            raise TokenCountError("image_mime required when image_bytes provided")
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


def count_tokens(
    *,
    text: str | None = None,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
    model: str = DEFAULT_MODEL,
) -> int:
    """Call countTokens for one sample and return total token count."""
    body = {
        "contents": [
            {
                "role": "USER",
                "parts": _build_parts(
                    text=text, image_bytes=image_bytes, image_mime=image_mime
                ),
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
    return int(data.get("totalTokens", 0))
