variable "host_project_id" {
  description = "GCP project that owns the service account, billed for Vertex calls. Required."
  type        = string
}

variable "region" {
  description = "Default region for the google provider. Not used for Vertex (global endpoint) but required by the provider."
  type        = string
  default     = "us-central1"
}

variable "service_account_name" {
  description = "account_id for the app's service account (the part before @<project>.iam.gserviceaccount.com). Lowercase, 6–30 chars, may include digits and dashes."
  type        = string
  default     = "pt-sizing-app"

  validation {
    condition     = can(regex("^[a-z]([-a-z0-9]{4,28})[a-z0-9]$", var.service_account_name))
    error_message = "service_account_name must be 6–30 chars, lowercase, start with a letter, end alphanumeric."
  }
}

variable "monitoring_project_ids" {
  description = "Projects whose Cloud Monitoring data the app needs to query (each gets roles/monitoring.viewer for the SA). If empty, defaults to [host_project_id]."
  type        = list(string)
  default     = []
}

variable "impersonators" {
  description = "Principals allowed to impersonate the app SA via roles/iam.serviceAccountTokenCreator. Each entry must be a fully-qualified IAM member, e.g. 'user:alice@example.com' or 'group:sizing-team@example.com'."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for m in var.impersonators :
      can(regex("^(user|group|serviceAccount|domain):", m))
    ])
    error_message = "Each impersonator must be prefixed with user:, group:, serviceAccount:, or domain:."
  }
}
