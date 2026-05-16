# Terraform: GCP scaffolding for pt-sizing-calculator

This module **only provisions the GCP-side prerequisites** (API enablement,
service account, IAM bindings). The app itself still runs locally — point your
ADC at the SA after apply.

## What it creates

- **APIs enabled** on the host project: `aiplatform.googleapis.com`,
  `monitoring.googleapis.com`, `iamcredentials.googleapis.com`,
  `cloudresourcemanager.googleapis.com`
- **Service account** `pt-sizing-app@<host_project>.iam.gserviceaccount.com`
  (name configurable)
- **IAM bindings:**
  - `roles/aiplatform.user` → SA on the host project (Vertex calls)
  - `roles/monitoring.viewer` → SA on each project in `monitoring_project_ids`
    (defaults to just the host project)
  - `roles/iam.serviceAccountTokenCreator` on the SA itself → each entry in
    `impersonators` (so they can `--impersonate-service-account`)

No compute, no buckets, no networking. State is local — fine for an internal
tool maintained by one or two people.

## Prerequisites

- Terraform ≥ 1.5
- `gcloud` authenticated with a principal that has, on the host project:
  - `roles/serviceusage.serviceUsageAdmin` (enable APIs)
  - `roles/iam.serviceAccountAdmin` (create the SA)
  - `roles/resourcemanager.projectIamAdmin` (grant project-level roles)
  - Same `projectIamAdmin` on each project in `monitoring_project_ids`

`roles/owner` covers all of the above if you don't want to be granular.

## Usage

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — at minimum set host_project_id.

terraform init
terraform plan
terraform apply
```

Read the `next_steps` output for the impersonation command, then run the app
per the [main README](../README.md).

## Adding a new customer project

Append to `monitoring_project_ids` in `terraform.tfvars`, then
`terraform apply`. The SA gets `monitoring.viewer` on the new project; no app
restart needed.

## Tear-down

```bash
terraform destroy
```

This removes the SA + the IAM bindings it created. It does **not** disable
the APIs (`disable_on_destroy = false` is set deliberately — disabling APIs
can break other workloads on the project).
