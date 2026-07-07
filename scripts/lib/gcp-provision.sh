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
  if ! gcloud iam service-accounts keys create "$out_path" \
    --iam-account="$sa_email" --project="$project_id" --quiet 2>/dev/null; then
    die "Could not create SA key (org policy may block iam.disableServiceAccountKeyCreation). See docs/GITHUB_ACTIONS.md for Workload Identity Federation."
  fi
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

  if [[ -n "$sa_key_path" && -f "$sa_key_path" ]]; then
    log "Uploading service account key to Secret Manager..."
    gcloud secrets create service-account-key --data-file="$sa_key_path" 2>/dev/null || \
      gcloud secrets versions add service-account-key --data-file="$sa_key_path"
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

get_sa_client_id() {
  local key_path="$1"
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['client_id'])" "$key_path" 2>/dev/null || \
    node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).client_id)" "$key_path"
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
