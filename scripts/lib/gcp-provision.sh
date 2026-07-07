#!/usr/bin/env bash
# GCP provisioning: project, APIs, service accounts, IAM, Secret Manager, Artifact Registry.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${LIB_DIR}/scopes.sh"

provision_project() {
  local project_id="$1"
  local create="${2:-false}"
  local billing_account="${3:-}"
  local org_id="${4:-}"
  local folder_id="${5:-}"

  if [[ "$create" == "true" ]]; then
    log "Creating project ${project_id}..."
    local create_args=(projects create "$project_id" --name="Workspace Admin Assist")
    [[ -n "$org_id" ]] && create_args+=(--organization="$org_id")
    [[ -n "$folder_id" ]] && create_args+=(--folder="$folder_id")
    gcloud "${create_args[@]}" --quiet || die "Failed to create project ${project_id}"
  fi

  gcloud config set project "$project_id" --quiet

  if ! gcloud projects describe "$project_id" &>/dev/null; then
    die "Project ${project_id} does not exist or you lack access"
  fi

  local billing_enabled
  billing_enabled="$(gcloud billing projects describe "$project_id" --format='value(billingEnabled)' 2>/dev/null || echo "False")"

  if [[ "$billing_enabled" != "True" ]]; then
    if [[ -z "$billing_account" ]]; then
      echo ""
      echo "Billing is not enabled on ${project_id}."
      echo "Available billing accounts:"
      gcloud billing accounts list --format='table(name,displayName,open)' 2>/dev/null || true
      echo ""
      read -r -p "Enter billing account ID (e.g. 012345-678901-ABCDEF) or leave blank to skip: " billing_account
    fi
    if [[ -n "$billing_account" ]]; then
      log "Linking billing account ${billing_account}..."
      gcloud billing projects link "$project_id" --billing-account="$billing_account" --quiet
    else
      warn "Billing not linked. Enable billing before deploying to Cloud Run."
    fi
  else
    log "Billing already enabled on ${project_id}"
  fi
}

provision_apis() {
  local project_id="$1"
  log "Enabling APIs..."
  gcloud services enable "${GCP_APIS[@]}" --project="$project_id" --quiet
}

provision_runtime_sa() {
  local project_id="$1"
  local sa_email="${RUNTIME_SA}@${project_id}.iam.gserviceaccount.com"

  log "Creating runtime service account ${RUNTIME_SA}..."
  gcloud iam service-accounts create "$RUNTIME_SA" \
    --display-name="Workspace Admin runtime" \
    --project="$project_id" --quiet 2>/dev/null || true

  gcloud projects add-iam-policy-binding "$project_id" \
    --member="serviceAccount:${sa_email}" \
    --role="roles/logging.logWriter" --quiet >/dev/null 2>&1 || true

  # Keyless domain-wide delegation: the runtime SA signs its own delegation
  # assertions via the IAM Credentials API, which requires tokenCreator on
  # itself. No downloaded key is ever created.
  log "Granting ${RUNTIME_SA} permission to sign its own delegation tokens..."
  gcloud iam service-accounts add-iam-policy-binding "$sa_email" \
    --member="serviceAccount:${sa_email}" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --project="$project_id" --quiet >/dev/null 2>&1 || \
    warn "Could not grant serviceAccountTokenCreator to ${sa_email} (delegation may fail at runtime)"
}

provision_deploy_sa() {
  local project_id="$1"
  local sa_email="${DEPLOY_SA}@${project_id}.iam.gserviceaccount.com"

  log "Creating deploy service account ${DEPLOY_SA}..."
  gcloud iam service-accounts create "$DEPLOY_SA" \
    --display-name="GitHub Actions deploy" \
    --project="$project_id" --quiet 2>/dev/null || true

  for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
    gcloud projects add-iam-policy-binding "$project_id" \
      --member="serviceAccount:${sa_email}" \
      --role="$role" --quiet >/dev/null 2>&1 || true
  done
}

create_sa_key() {
  local project_id="$1"
  local sa_name="$2"
  local out_path="$3"
  local sa_email="${sa_name}@${project_id}.iam.gserviceaccount.com"

  if [[ -f "$out_path" ]]; then
    log "Using existing key at ${out_path}"
    return 0
  fi

  log "Creating key for ${sa_email}..."
  # Org-policy changes (e.g. lifting iam.disableServiceAccountKeyCreation) can
  # take a couple minutes to propagate, so retry rather than failing on the
  # first attempt.
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if gcloud iam service-accounts keys create "$out_path" \
      --iam-account="$sa_email" --project="$project_id" --quiet 2>/dev/null; then
      return 0
    fi
    if [[ "$attempt" -lt 6 ]]; then
      warn "Key creation failed (attempt ${attempt}/6) — org policy may still be propagating. Retrying in 20s..."
      sleep 20
    fi
  done
  die "Could not create SA key after retries (org policy iam.disableServiceAccountKeyCreation may still be enforced or propagating). Re-run in a few minutes, or see docs/DEPLOY.md for Workload Identity Federation."
}

# If iam.disableServiceAccountKeyCreation is enforced (secure-by-default on new
# orgs), the app can't get its runtime DWD key. Offer to disable that policy for
# this project only, then let the caller retry. Returns 0 if keys should now work.
attempt_unblock_sa_keys() {
  local project_id="$1"

  warn "Service-account key creation is blocked by org policy (iam.disableServiceAccountKeyCreation)."
  echo "  This app needs a runtime service-account key for domain-wide delegation."
  echo "  It can be turned off for THIS project only (recommended for your own org)."
  echo ""

  if [[ "${NON_INTERACTIVE:-false}" == "true" ]]; then
    warn "Non-interactive mode: skipping auto-fix."
    echo "  Run: gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project=${project_id}"
    return 1
  fi

  if ! confirm "Disable iam.disableServiceAccountKeyCreation for ${project_id}?" "y"; then
    return 1
  fi

  log "Disabling org policy for ${project_id}..."
  if gcloud resource-manager org-policies disable-enforce \
      iam.disableServiceAccountKeyCreation --project="$project_id" --quiet 2>/dev/null; then
    log "Policy disabled. Waiting 30s for it to propagate..."
    sleep 30
    return 0
  fi

  # Permission denied — the user needs Organization Policy Administrator.
  local org_id
  org_id="$(gcloud projects get-ancestors "$project_id" 2>/dev/null | awk '$2=="organization"{print $1}' | head -1)"
  warn "Couldn't change the org policy — you need the Organization Policy Administrator role."
  echo ""
  echo "  Run these as a Workspace super admin, then re-run this wizard:"
  echo ""
  echo "    gcloud organizations add-iam-policy-binding ${org_id:-<ORG_ID>} \\"
  echo "      --member=\"user:\$(gcloud config get-value account)\" \\"
  echo "      --role=\"roles/orgpolicy.policyAdmin\""
  echo ""
  echo "    gcloud resource-manager org-policies disable-enforce \\"
  echo "      iam.disableServiceAccountKeyCreation --project=${project_id}"
  echo ""
  return 1
}

grant_secret_access() {
  local project_id="$1"
  local sa_email="${RUNTIME_SA}@${project_id}.iam.gserviceaccount.com"

  log "Granting Secret Manager access to ${sa_email}..."
  for secret_name in "${APP_SECRETS[@]}"; do
    gcloud secrets add-iam-policy-binding "$secret_name" \
      --project="$project_id" \
      --member="serviceAccount:${sa_email}" \
      --role="roles/secretmanager.secretAccessor" --quiet >/dev/null 2>&1 || \
      warn "Could not bind ${secret_name} (secret may not exist yet)"
  done
}

provision_secrets() {
  local project_id="$1"
  local client_id="${2:-}"
  local client_secret="${3:-}"
  local workspace_domain="${4:-}"
  local allowed_domains="${5:-}"
  local sa_key_path="${6:-}"
  local jwt_secret="${7:-}"
  local redirect_uri="${8:-https://PLACEHOLDER.run.app/api/auth/callback}"

  gcloud config set project "$project_id" --quiet

  if [[ -z "$jwt_secret" ]]; then
    jwt_secret="$(openssl rand -base64 32)"
    log "Generated JWT secret"
  fi

  [[ -z "$allowed_domains" && -n "$workspace_domain" ]] && allowed_domains="$workspace_domain"

  if [[ -n "$client_id" ]]; then
    secret_upsert oauth-client-id "$client_id"
  fi
  if [[ -n "$client_secret" ]]; then
    secret_upsert oauth-client-secret "$client_secret"
  fi
  secret_upsert oauth-redirect-uri "$redirect_uri"
  secret_upsert app-jwt-secret "$jwt_secret"
  if [[ -n "$workspace_domain" ]]; then
    secret_upsert app-workspace-domain "$workspace_domain"
  fi
  if [[ -n "$allowed_domains" ]]; then
    secret_upsert app-allowed-domains "$allowed_domains"
  fi

  grant_secret_access "$project_id"
}

provision_artifact_registry() {
  local project_id="$1"
  local region="${2:-$DEFAULT_REGION}"

  log "Ensuring Artifact Registry repo ${ARTIFACT_REPO}..."
  gcloud artifacts repositories create "$ARTIFACT_REPO" \
    --repository-format=docker \
    --location="$region" \
    --project="$project_id" --quiet 2>/dev/null || true
}

# `gcloud builds submit` runs the build as the Compute Engine default service
# account. On new projects the org policy iam.automaticIamGrantsForDefaultServiceAccounts
# suppresses the automatic role grant, so that SA can't read the uploaded source
# tarball or push the image. Grant it the Cloud Build builder role explicitly so
# builds work turnkey. Idempotent and best-effort.
grant_cloudbuild_permissions() {
  local project_id="$1"
  local project_number
  project_number="$(gcloud projects describe "$project_id" --format='value(projectNumber)' 2>/dev/null)"
  if [[ -z "$project_number" ]]; then
    warn "Could not resolve project number; skipping Cloud Build SA grant"
    return 0
  fi

  local compute_sa="${project_number}-compute@developer.gserviceaccount.com"
  log "Granting Cloud Build permissions to ${compute_sa}..."
  gcloud projects add-iam-policy-binding "$project_id" \
    --member="serviceAccount:${compute_sa}" \
    --role="roles/cloudbuild.builds.builder" --quiet >/dev/null 2>&1 || \
    warn "Could not grant roles/cloudbuild.builds.builder to ${compute_sa}"
}

# The domain-wide-delegation client ID is the service account's OAuth2 client
# ID (a.k.a. its unique numeric ID). With keyless auth there is no key file to
# read it from, so query the SA directly.
get_sa_oauth_client_id() {
  local project_id="$1"
  local sa_name="$2"
  gcloud iam service-accounts describe \
    "${sa_name}@${project_id}.iam.gserviceaccount.com" \
    --project="$project_id" --format='value(oauth2ClientId)'
}

# Best-effort SA key creation for the (optional) GitHub Actions deploy SA.
# Returns non-zero instead of aborting when org policy blocks key creation.
try_create_sa_key() {
  local project_id="$1"
  local sa_name="$2"
  local out_path="$3"
  local sa_email="${sa_name}@${project_id}.iam.gserviceaccount.com"

  gcloud iam service-accounts keys create "$out_path" \
    --iam-account="$sa_email" --project="$project_id" --quiet 2>/dev/null
}

provision_gcp_full() {
  local project_id="$1"
  local region="${2:-$DEFAULT_REGION}"
  local workspace_domain="$3"
  local tmp_dir="${4:-/tmp/gws-admin-bootstrap-$$}"
  mkdir -p "$tmp_dir"

  local runtime_key="${tmp_dir}/workspace-admin-sa-key.json"
  local deploy_key="${tmp_dir}/github-deploy-sa-key.json"

  provision_apis "$project_id"
  provision_runtime_sa "$project_id"
  provision_deploy_sa "$project_id"
  create_sa_key "$project_id" "$RUNTIME_SA" "$runtime_key"
  create_sa_key "$project_id" "$DEPLOY_SA" "$deploy_key"
  provision_secrets "$project_id" "" "" "$workspace_domain" "$workspace_domain" "$runtime_key"
  provision_artifact_registry "$project_id" "$region"

  echo "$runtime_key"
  echo "$deploy_key"
}
