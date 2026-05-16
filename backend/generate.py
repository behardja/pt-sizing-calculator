"""Proxy to Vertex AI generateContent for end-to-end output estimation.

Used when the user wants a single click that:
  1. Sends a representative input (image and/or text) to the model
  2. Receives an actual generated response (text and/or image)
  3. Reads usageMetadata to get input + per-modality output token counts

This populates a3 (input), a4 (output text), a5 (output image) in one API call.

Endpoint (global):
    POST https://aiplatform.googleapis.com/v1/projects/{P}/locations/global/
         publishers/google/models/{MODEL}:generateContent

Auth: ADC bearer token (same identity as tokens.py / monitoring.py).

NOTE: Unlike countTokens, generateContent IS billed. One call per click.
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from . import tokens as tokens_mod


class GenerateError(RuntimeError):
    pass


def _endpoint(model: str) -> str:
    location = tokens_mod._location()
    project = tokens_mod._project_id()
    host = (
        "aiplatform.googleapis.com"
        if location == "global"
        else f"{location}-aiplatform.googleapis.com"
    )
    return (
        f"https://{host}/v1"
        f"/projects/{project}/locations/{location}"
        f"/publishers/google/models/{model}:generateContent"
    )


def _build_parts(
    *,
    text: str | None,
    image_bytes: bytes | None,
    image_mime: str | None,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if text:
        parts.append({"text": text})
    if image_bytes is not None:
        if not image_mime:
            raise GenerateError("image_mime required when image_bytes provided")
        parts.append(
            {
                "inline_data": {
                    "mime_type": image_mime,
                    "data": base64.b64encode(image_bytes).decode(),
                }
            }
        )
    if not parts:
        raise GenerateError("generateContent called with empty content")
    return parts


def _split_modality_counts(details: list[dict[str, Any]]) -> dict[str, int]:
    """Roll up a *TokensDetails list into {TEXT: n, IMAGE: n, ...}."""
    out: dict[str, int] = {}
    for d in details or []:
        modality = (d.get("modality") or "").upper()
        if not modality:
            continue
        out[modality] = out.get(modality, 0) + int(d.get("tokenCount", 0))
    return out


def run_and_count(
    *,
    text: str | None = None,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
    model: str = tokens_mod.DEFAULT_MODEL,
) -> dict[str, Any]:
    """Run generateContent once and return per-modality token counts.

    Returns:
        {
          "input_tokens": int,            # promptTokenCount (sum across modalities)
          "output_text_tokens": int,      # from candidatesTokensDetails[modality=TEXT]
          "output_image_tokens": int,     # from candidatesTokensDetails[modality=IMAGE]
          "total_output_tokens": int,     # candidatesTokenCount (sanity check)
          "raw_usage": dict,              # passthrough of usageMetadata
        }
    """
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
            "Authorization": f"Bearer {tokens_mod._bearer_token()}",
            "Content-Type": "application/json; charset=utf-8",
        },
        json=body,
        timeout=120,  # image generation can be slow
    )
    if resp.status_code != 200:
        raise GenerateError(
            f"generateContent failed ({resp.status_code}): {resp.text[:400]}"
        )
    data = resp.json()

    usage = data.get("usageMetadata") or {}
    input_tokens = int(usage.get("promptTokenCount", 0))
    total_output = int(usage.get("candidatesTokenCount", 0))

    by_modality = _split_modality_counts(usage.get("candidatesTokensDetails") or [])
    out_text = by_modality.get("TEXT", 0)
    out_image = by_modality.get("IMAGE", 0)

    # If the model returned a single bucket without per-modality breakdown, fall
    # back to inspecting candidate parts to attribute tokens. We assume the
    # response has at most one candidate (default).
    if out_text == 0 and out_image == 0 and total_output > 0:
        candidates = data.get("candidates") or []
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", []) or []
            has_text = any("text" in p and p["text"] for p in parts)
            has_image = any("inlineData" in p or "inline_data" in p for p in parts)
            if has_image and not has_text:
                out_image = total_output
            elif has_text and not has_image:
                out_text = total_output

    return {
        "input_tokens": input_tokens,
        "output_text_tokens": out_text,
        "output_image_tokens": out_image,
        "total_output_tokens": total_output,
        "raw_usage": usage,
    }
