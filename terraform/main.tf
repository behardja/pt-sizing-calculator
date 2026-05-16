/**
 * pt-sizing-calculator — GCP scaffolding
 *
 * Enables the APIs the app needs, creates a dedicated service account, and
 * grants it the minimum roles to run countTokens, generateContent, and
 * Cloud Monitoring MQL queries. The app itself runs locally — this module
 * does NOT deploy any compute.
 *
 * After `terraform apply`, point your local ADC at the new SA via
 * impersonation (see outputs.tf for the exact command).
 */

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.host_project_id
  region  = var.region
}

locals {
  # APIs the app calls. Enabling is idempotent + cheap.
  required_apis = toset([
    "aiplatform.googleapis.com",       # countTokens / generateContent
    "monitoring.googleapis.com",       # MQL for A1 / A2
    "iamcredentials.googleapis.com",   # required for SA impersonation
    "cloudresourcemanager.googleapis.com",
  ])

  # If the caller didn't supply a separate list of monitoring projects,
  # default to querying the host project itself.
  monitoring_projects = length(var.monitoring_project_ids) > 0 ? var.monitoring_project_ids : [var.host_project_id]
}

# ── API enablement ────────────────────────────────────────────────────────
resource "google_project_service" "apis" {
  for_each                   = local.required_apis
  project                    = var.host_project_id
  service                    = each.key
  disable_dependent_services = false
  disable_on_destroy         = false
}

# ── Service account the app runs as ───────────────────────────────────────
resource "google_service_account" "app" {
  project      = var.host_project_id
  account_id   = var.service_account_name
  display_name = "PT Sizing Calculator"
  description  = "Runs Vertex countTokens/generateContent + Cloud Monitoring MQL for the PT sizing tool."

  depends_on = [google_project_service.apis]
}

# ── Role: Vertex AI user (countTokens + generateContent) ──────────────────
# Granted on the host project — that's where Vertex requests are billed.
resource "google_project_iam_member" "aiplatform_user" {
  project = var.host_project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# ── Role: Monitoring viewer on each data project the app needs to query ──
# Use granular *_iam_member (not *_iam_binding) so we don't stomp other
# bindings on these projects.
resource "google_project_iam_member" "monitoring_viewer" {
  for_each = toset(local.monitoring_projects)
  project  = each.key
  role     = "roles/monitoring.viewer"
  member   = "serviceAccount:${google_service_account.app.email}"
}

# ── Allow the caller(s) to impersonate the SA ────────────────────────────
# Without serviceAccountTokenCreator, `gcloud auth application-default login
# --impersonate-service-account=...` fails. Defaults to the user running
# terraform apply; can be a group ("group:sizing-team@example.com") or list.
resource "google_service_account_iam_member" "impersonators" {
  for_each           = toset(var.impersonators)
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.key
}
