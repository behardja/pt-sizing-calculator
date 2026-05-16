output "service_account_email" {
  description = "Email of the SA the app should run as."
  value       = google_service_account.app.email
}

output "enabled_apis" {
  description = "APIs enabled on the host project."
  value       = [for a in google_project_service.apis : a.service]
}

output "monitoring_projects_granted" {
  description = "Projects where the SA was granted roles/monitoring.viewer."
  value       = [for m in google_project_iam_member.monitoring_viewer : m.project]
}

output "impersonation_command" {
  description = "Run this once locally to make ADC act as the new SA."
  value       = "gcloud auth application-default login --impersonate-service-account=${google_service_account.app.email}"
}

output "next_steps" {
  description = "What to do after apply."
  value       = <<-EOT

    ┌── PT Sizing Calculator — scaffolding ready ──────────────────────────
    │ Service account:  ${google_service_account.app.email}
    │
    │ 1. Point your local ADC at the new SA:
    │      gcloud auth application-default login \
    │        --impersonate-service-account=${google_service_account.app.email}
    │
    │ 2. (Optional) export for the app:
    │      export GOOGLE_CLOUD_PROJECT=${var.host_project_id}
    │
    │ 3. Run the app from the repo root:
    │      python server.py
    │
    │ To query an additional customer project, add its ID to
    │ monitoring_project_ids in terraform.tfvars and re-apply.
    └──────────────────────────────────────────────────────────────────────
  EOT
}
