# pt-sizing-calculator

A guided UI that produces the five inputs Google's
[Vertex Provisioned Throughput estimator](https://console.cloud.google.com/vertex-ai/provisioned-throughput/price-estimate)
needs for **Nano Banana 2** (`gemini-3.1-flash-image-preview`).

Two steps:
- **Step 01 · Sizing inputs** — five cards, one per estimator field. A1/A2
  come from a Cloud Monitoring query (with optional day-of-week + hour-of-day
  filter, defaulted to Mon–Fri 9–17 local). A3/A4/A5 come from Vertex's
  `countTokens` on a representative sample. The A3 card has a second
  **"⚡ Run Model to est. Outputs"** button that calls `generateContent` once
  and back-fills A3+A4+A5 from `usageMetadata`.
- **Step 02 · Summary** — table of the five values with per-row copy buttons
  and a one-click open of the GCP estimator.

## Requirements

### Runtime
- **Python ≥ 3.9** (uses `zoneinfo` stdlib)
- **Node.js ≥ 18** + npm (Vite 5 needs it)
- **gcloud CLI** (for ADC setup, unless you're already on a GCE/Workbench VM)

### Python packages (`backend/requirements.txt`)
- `fastapi ≥ 0.110` — HTTP framework
- `uvicorn[standard] ≥ 0.27` — ASGI server (with watchgod for autoreload)
- `httpx ≥ 0.27` — calls to Vertex `countTokens` / `generateContent`
- `google-cloud-monitoring ≥ 2.19` — MQL client for A1/A2 metrics
- `google-auth ≥ 2.28` — ADC bearer token for Vertex REST calls
- `python-multipart ≥ 0.0.9` — multipart form parsing (image uploads)

### Frontend packages (`frontend/package.json`)
- `react`, `react-dom` ^18.3
- `react-router-dom` ^7.15
- `motion` ^11.11 (animations)
- `vite` ^5.4 + `@vitejs/plugin-react` (dev/build only)

### GCP requirements

The identity behind ADC (your user, a service account, or a Workbench
instance SA) needs:

| Role | Why |
|---|---|
| `roles/monitoring.viewer` — on each project whose A1/A2 you want to query | Read `model_invocation_count` time series |
| `roles/aiplatform.user` — on the project whose model you're calling | Call `countTokens` and `generateContent` for token estimation + the "Run Model" button |

The model is served from the **global** Vertex endpoint. You don't need a
regional setting unless you point at a non-global model.

## Setup

```bash
# 1. Backend deps
pip install -r backend/requirements.txt

# 2. Frontend deps
cd frontend && npm install && cd ..

# 3. ADC (skip if on Workbench / GCE with attached SA)
gcloud auth application-default login
gcloud config set project <your-project>   # used for Vertex calls

# 4. (Optional) override the project Vertex calls hit
export GOOGLE_CLOUD_PROJECT=my-project
export GOOGLE_CLOUD_LOCATION=global        # default; only set to override

# 5. Run
python server.py
```

### Optional: provision GCP scaffolding with Terraform

If you'd rather not click through API enablement + role grants in the console,
`terraform/` provisions all of it (APIs, a dedicated SA, IAM bindings on the
host + any monitoring projects). The app still runs locally — Terraform just
sets up GCP so ADC has the right permissions when you impersonate the SA.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # set host_project_id
terraform init && terraform apply
# Follow the `next_steps` output to point ADC at the new SA, then run the app.
```

See [terraform/README.md](terraform/README.md) for details.

`server.py` boots FastAPI on `:8000` and Vite on `:5173`, prints the local +
external URLs, and tails both processes with colored prefixes. Hit Ctrl-C to
stop both.

### Firewall (if hosted on GCE/Workbench and accessed from a laptop)

```bash
gcloud compute firewall-rules create pt-sizing-dev \
  --rules=tcp:5173 --source-ranges="$(curl -s ifconfig.me)/32"
```

## How it works

```
┌──────────────────────────┐
│  React UI (Vite :5173)   │  proxies /api/* → :8000
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│  FastAPI (uvicorn :8000) │
└────────────┬─────────────┘
             │
    ┌────────┴────────┬───────────────┬─────────────────┐
    ▼                 ▼               ▼                 ▼
 /api/host-       /api/monitoring/  /api/count-      /api/run-and-
 project          query             tokens           count
   │                │                 │                 │
   │              Cloud           Vertex AI         Vertex AI
   │             Monitoring      countTokens     generateContent
   │              (ADC)            (Bearer)         (Bearer)
   ▼
 ADC default
 project
```

- **`/api/monitoring/query`** — Pulls `model_invocation_count` aligned to 5-min
  buckets, filters by day-of-week + hour range (in the browser's local TZ),
  computes both average and peak QPS / pct-over-200K. Single response
  populates both the A1 and A2 cards.
- **`/api/count-tokens`** — Multipart form with optional `image` + `text`.
  Returns raw token count from Vertex `countTokens`.
- **`/api/run-and-count`** — Same input shape, but invokes `generateContent`
  and returns `{input_tokens, output_text_tokens, output_image_tokens}` parsed
  from `usageMetadata.candidatesTokensDetails`. This *is* a billed model call.

Token counts are stored **raw**. The PT Estimator applies burndown rates
(input ×1, output text ×6, output image ×120 for this model) on its end.

## Files

| Path | Purpose |
|---|---|
| `server.py` | Launches uvicorn (`:8000`) + Vite (`:5173`), prints external IP |
| `backend/main.py` | FastAPI routes: `/api/host-project`, `/api/monitoring/query`, `/api/count-tokens`, `/api/run-and-count` |
| `backend/monitoring.py` | MQL queries + `TimeFilter` aggregation (avg + peak) |
| `backend/tokens.py` | Vertex `countTokens` proxy (ADC bearer auth, global endpoint) |
| `backend/generate.py` | Vertex `generateContent` proxy for the "Run Model" button |
| `backend/requirements.txt` | Python deps (see above) |
| `frontend/src/pages/SizingPage.jsx` | Step 01 — five cards + TOC + footer CTA |
| `frontend/src/pages/SummaryPage.jsx` | Step 02 — value table with per-row copy |
| `frontend/src/components/MonitoringFieldCard.jsx` | A1/A2 card with day/hour filter + avg/peak result |
| `frontend/src/components/TokenCard.jsx` | A3/A4/A5 card with image preview + Estimate + optional Run Model |
| `frontend/src/state/SizingContext.jsx` | Shared monitoring + a1…a5 state |
| `frontend/package.json` | Node deps (see above) |

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ADC not configured` on first query | `gcloud auth application-default login` |
| `404 ... was not found or your project does not have access` | Model is served from `global`. Set `GOOGLE_CLOUD_LOCATION=global` (or leave it unset — that's the default). Confirm project has the Vertex API enabled. |
| `permission denied` on monitoring query | ADC identity needs `roles/monitoring.viewer` on the queried project |
| `permission denied` on countTokens / Run Model | ADC identity needs `roles/aiplatform.user` on the project Vertex calls hit |
| `0 buckets matched in window` | The day/hour filter excludes every bucket in the chosen window. Broaden the filter or extend the window. |
| Frontend can't reach `/api/*` | Vite proxies `/api → :8000`; make sure uvicorn is actually up (`server.py` prints `[api] Application startup complete`) |
