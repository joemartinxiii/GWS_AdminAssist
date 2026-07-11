#!/usr/bin/env bash
# Shared Cloud Run deploy steps used by every deploy path.
# Call after the container image already exists in Artifact Registry.
#
# Required env (or args via deploy_cloud_run):
#   PROJECT_ID, REGION, DEPLOY_IMAGE (fully qualified image ref with tag)
# Optional env:
#   SCAN_BUCKET, SCAN_USER_CONCURRENCY, SIGNATURE_TEMPLATE_BUCKET, DWD_ADMIN_EMAIL
#   SKIP_HEALTH=1  — skip post-deploy /health (not recommended)
#   SKIP_DWD_HINT=1 — skip printing DWD scopes

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${LIB_DIR}/scopes.sh"

# Deploy (or update) the web service, rebind OAuth redirect, configure scan job,
# optional signature bucket, health-check, and DWD scope reminder.
deploy_cloud_run() {
  local project_id="${1:-}"
  local region="${2:-}"
  local deploy_image="${3:-}"

  [[ -n "$project_id" ]] || die "deploy_cloud_run: PROJECT_ID required"
  [[ -n "$region" ]] || die "deploy_cloud_run: REGION required"
  [[ -n "$deploy_image" ]] || die "deploy_cloud_run: image required"

  local service_name="${CLOUD_RUN_SERVICE}"
  local scan_job="${CLOUD_RUN_SCAN_JOB}"
  local runtime_sa="${RUNTIME_SA}@${project_id}.iam.gserviceaccount.com"
  local scan_bucket="${SCAN_BUCKET:-${project_id}-workspace-admin-scans}"
  local scan_concurrency="${SCAN_USER_CONCURRENCY:-15}"

  log "Deploying ${service_name} from ${deploy_image}..."
  gcloud run deploy "$service_name" \
    --image "$deploy_image" \
    --platform managed \
    --region "$region" \
    --project "$project_id" \
    --memory 1Gi \
    --cpu 1 \
    --cpu-boost \
    --min-instances 0 \
    --max-instances 2 \
    --timeout 300 \
    --service-account "${runtime_sa}" \
    --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${project_id},SERVICE_ACCOUNT_EMAIL=${runtime_sa},SCAN_BUCKET=${scan_bucket},SCAN_JOB_NAME=${scan_job},SCAN_REGION=${region}" \
    --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
    --allow-unauthenticated \
    --no-invoker-iam-check \
    --quiet

  local service_url redirect_uri redirect_ver
  service_url="$(gcloud run services describe "$service_name" --region "$region" --project "$project_id" --format='value(status.url)')"
  redirect_uri="${service_url}/api/auth/callback"

  # Persist the real redirect URI, then roll a revision that *pins* that version.
  # Re-referencing ":latest" alone can be a no-op and leave the running revision
  # stuck on PLACEHOLDER after the first deploy.
  log "Updating OAuth redirect URI + CORS..."
  echo -n "$redirect_uri" | gcloud secrets versions add oauth-redirect-uri --project="$project_id" --data-file=- --quiet
  redirect_ver="$(gcloud secrets versions list oauth-redirect-uri --project="$project_id" --filter='state:enabled' --sort-by=~createTime --format='value(name)' --limit=1)"

  gcloud run services update "$service_name" \
    --region "$region" --project "$project_id" \
    --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${project_id},SERVICE_ACCOUNT_EMAIL=${runtime_sa},CORS_ORIGIN=${service_url},SCAN_BUCKET=${scan_bucket},SCAN_JOB_NAME=${scan_job},SCAN_REGION=${region}" \
    --update-secrets "GOOGLE_REDIRECT_URI=oauth-redirect-uri:${redirect_ver}" \
    --no-invoker-iam-check \
    --quiet

  # Optional: accounts that cannot be permanently deleted (comma-separated emails).
  # Use ^|^ delimiter so commas inside the value do not break --update-env-vars.
  if [[ -n "${GWS_PROTECTED_USERS:-}" ]]; then
    gcloud run services update "$service_name" \
      --region "$region" --project "$project_id" \
      --update-env-vars "^|^GWS_PROTECTED_USERS=${GWS_PROTECTED_USERS}" \
      --no-invoker-iam-check --quiet
  fi
  # --- External-sharing scan + Security Audit durability (same GCS bucket) ---
  # security-audit/latest.json and security-audit/waivers.json live under SCAN_BUCKET.
  log "Configuring scan/audit bucket + Cloud Run Job..."
  gcloud storage buckets describe "gs://${scan_bucket}" --project="$project_id" &>/dev/null \
    || gcloud storage buckets create "gs://${scan_bucket}" --project="$project_id" --location="$region" --uniform-bucket-level-access --quiet \
    || warn "Could not create gs://${scan_bucket} (may need storage.admin / already exists)"

  gcloud storage buckets add-iam-policy-binding "gs://${scan_bucket}" \
    --member="serviceAccount:${runtime_sa}" \
    --role="roles/storage.objectAdmin" --project="$project_id" --quiet >/dev/null 2>&1 || \
    warn "Could not grant objectAdmin on gs://${scan_bucket}"

  gcloud projects add-iam-policy-binding "$project_id" \
    --member="serviceAccount:${runtime_sa}" \
    --role="roles/run.developer" --quiet >/dev/null 2>&1 || \
    warn "Could not grant roles/run.developer to ${runtime_sa}"

  # Ensure runtime can write audit logs (idempotent).
  gcloud projects add-iam-policy-binding "$project_id" \
    --member="serviceAccount:${runtime_sa}" \
    --role="roles/logging.logWriter" --quiet >/dev/null 2>&1 || true

  gcloud run jobs deploy "$scan_job" \
    --image "$deploy_image" \
    --region "$region" \
    --project "$project_id" \
    --service-account "${runtime_sa}" \
    --command node \
    --args backend/dist/jobs/externalScan.js \
    --max-retries 1 \
    --task-timeout 3600 \
    --memory 1Gi \
    --cpu 1 \
    --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${project_id},SERVICE_ACCOUNT_EMAIL=${runtime_sa},SCAN_BUCKET=${scan_bucket},SCAN_USER_CONCURRENCY=${scan_concurrency}" \
    --set-secrets "WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
    --quiet || warn "Could not deploy Cloud Run Job ${scan_job}; external-sharing scans will be unavailable until it exists."

  # Optional durable org signature template storage.
  if [[ -n "${SIGNATURE_TEMPLATE_BUCKET:-}" ]]; then
    log "Configuring durable signature-template storage in gs://${SIGNATURE_TEMPLATE_BUCKET}..."
    gcloud storage buckets describe "gs://${SIGNATURE_TEMPLATE_BUCKET}" --project="$project_id" &>/dev/null \
      || gcloud storage buckets create "gs://${SIGNATURE_TEMPLATE_BUCKET}" --project="$project_id" --location="$region" --uniform-bucket-level-access --quiet
    gcloud storage buckets add-iam-policy-binding "gs://${SIGNATURE_TEMPLATE_BUCKET}" \
      --member="serviceAccount:${runtime_sa}" \
      --role="roles/storage.objectAdmin" --project="$project_id" --quiet
    gcloud run services update "$service_name" --region "$region" --project "$project_id" \
      --update-env-vars "SIGNATURE_TEMPLATE_BUCKET=${SIGNATURE_TEMPLATE_BUCKET}" \
      --no-invoker-iam-check --quiet
  fi

  # Export for callers
  DEPLOY_SERVICE_URL="$service_url"
  DEPLOY_REDIRECT_URI="$redirect_uri"
  export DEPLOY_SERVICE_URL DEPLOY_REDIRECT_URI

  if [[ "${SKIP_HEALTH:-0}" != "1" ]]; then
    log "Running post-deploy health check..."
    local health_ok=false attempt
    for attempt in 1 2 3 4 5 6; do
      if curl -fsS --max-time 15 "${service_url}/health" | grep -q '"status":"ok"'; then
        health_ok=true
        break
      fi
      log "  health not ready (attempt ${attempt}/6), retrying in 5s..."
      sleep 5
    done
    if [[ "$health_ok" == true ]]; then
      echo "Deployed successfully — /health responded OK."
    else
      warn "Deployed, but /health did not respond OK after retries. Check logs:"
      echo "  gcloud run services logs read ${service_name} --region ${region} --project ${project_id} --limit=50"
    fi
  fi

  echo ""
  echo "Service URL:   ${service_url}"
  echo "Redirect URI:  ${redirect_uri}"
  echo ""
  echo "Register the redirect URI on your OAuth Web client if not already done."
  echo "  (GCP Console → APIs & Services → Credentials → OAuth 2.0 Client)"
  echo ""

  if [[ "${SKIP_DWD_HINT:-0}" != "1" ]]; then
    # shellcheck source=scripts/lib/gcp-provision.sh
    source "${LIB_DIR}/gcp-provision.sh"
    check_dwd_scopes "$project_id" || true
  fi
}
