#!/usr/bin/env bash
# Deploy to Cloud Run via Cloud Build (no local Docker). Mirrors .github/workflows/deploy.yml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-${REGION:-$DEFAULT_REGION}}"

if [[ -z "$PROJECT_ID" ]]; then
  die "Usage: bash scripts/deploy-cloudshell.sh [PROJECT_ID] [REGION]"
fi

SERVICE_NAME="$CLOUD_RUN_SERVICE"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE_NAME}"

# External-sharing scan: on-demand Cloud Run Job + GCS bucket for cached reports.
# Bucket defaults to <project>-workspace-admin-scans; override with SCAN_BUCKET.
SCAN_BUCKET="${SCAN_BUCKET:-${PROJECT_ID}-workspace-admin-scans}"
SCAN_USER_CONCURRENCY="${SCAN_USER_CONCURRENCY:-15}"

log "Deploying ${SERVICE_NAME} to Cloud Run via Cloud Build..."
gcloud config set project "$PROJECT_ID" --quiet

RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud secrets describe app-jwt-secret --project="$PROJECT_ID" &>/dev/null; then
  die "App secrets not found. Run bootstrap-tenant.sh first."
fi

# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/lib/gcp-provision.sh"
# Keep the enabled API set in sync on every deploy (idempotent; a no-op when
# already enabled). Ensures new APIs added to scripts/lib/scopes.sh — e.g. the
# Cloud Identity Policy API for the Security Audit — are turned on for existing
# tenants without a manual step.
provision_apis "$PROJECT_ID"
provision_artifact_registry "$PROJECT_ID" "$REGION"
grant_cloudbuild_permissions "$PROJECT_ID"

log "Building and pushing image (Cloud Build)..."
GIT_TAG="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo latest)"
# The Cloud Build SA grant above can take up to ~60s to propagate, so retry the
# first submit rather than failing on a transient 403.
BUILD_OK=false
for attempt in 1 2 3 4; do
  if gcloud builds submit "$REPO_ROOT" \
    --tag "${IMAGE}:latest" \
    --tag "${IMAGE}:${GIT_TAG}" \
    --quiet; then
    BUILD_OK=true
    break
  fi
  if [[ "$attempt" -lt 4 ]]; then
    warn "Build submit failed (attempt ${attempt}/4) — IAM grant may still be propagating. Retrying in 20s..."
    sleep 20
  fi
done
[[ "$BUILD_OK" == true ]] || die "Cloud Build failed after retries. Check: gcloud builds list --project=${PROJECT_ID}"

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo latest)"
DEPLOY_IMAGE="${IMAGE}:${GIT_SHA}"

log "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$DEPLOY_IMAGE" \
  --platform managed \
  --region "$REGION" \
  --memory 1Gi \
  --cpu 1 \
  --cpu-boost \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --service-account "${RUNTIME_SA_EMAIL}" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA_EMAIL},SCAN_BUCKET=${SCAN_BUCKET},SCAN_JOB_NAME=${CLOUD_RUN_SCAN_JOB},SCAN_REGION=${REGION}" \
  --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  --allow-unauthenticated \
  --no-invoker-iam-check \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
REDIRECT_URI="${SERVICE_URL}/api/auth/callback"

# The redirect URI isn't known until the service has a URL, so the first
# revision above was created with the placeholder secret value. Persist the
# real redirect URI, then roll ONE more revision that reads it. Pin the explicit
# version — re-referencing ":latest" can be treated as a no-op and skip the
# rollout, leaving the running revision stuck on the placeholder.
echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=- --quiet
REDIRECT_VER="$(gcloud secrets versions list oauth-redirect-uri --filter='state:enabled' --sort-by=~createTime --format='value(name)' --limit=1)"

gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA_EMAIL},CORS_ORIGIN=${SERVICE_URL},SCAN_BUCKET=${SCAN_BUCKET},SCAN_JOB_NAME=${CLOUD_RUN_SCAN_JOB},SCAN_REGION=${REGION}" \
  --update-secrets "GOOGLE_REDIRECT_URI=oauth-redirect-uri:${REDIRECT_VER}" \
  --no-invoker-iam-check \
  --quiet

# --- External-sharing scan: GCS bucket, IAM, and Cloud Run Job --------------
# The scan enumerates every user via DWD and writes a categorized report to
# GCS. It runs as an on-demand Cloud Run Job (idle cost ~$0; billed only while
# scanning). The web service triggers it via the Cloud Run Admin API, so the
# runtime SA needs run.developer (execute jobs) + objectAdmin on the bucket.
log "Configuring external-sharing scan (bucket + Cloud Run Job)..."
gcloud storage buckets describe "gs://${SCAN_BUCKET}" &>/dev/null \
  || gcloud storage buckets create "gs://${SCAN_BUCKET}" --project="$PROJECT_ID" --location="$REGION" --uniform-bucket-level-access --quiet
gcloud storage buckets add-iam-policy-binding "gs://${SCAN_BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/storage.objectAdmin" --quiet >/dev/null 2>&1 || \
  warn "Could not grant objectAdmin on gs://${SCAN_BUCKET}"

# Allow the web service's runtime SA to execute the scan job.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/run.developer" --quiet >/dev/null 2>&1 || \
  warn "Could not grant roles/run.developer to ${RUNTIME_SA_EMAIL}"

# Create/update the scan job from the SAME image, overriding the entrypoint.
gcloud run jobs deploy "$CLOUD_RUN_SCAN_JOB" \
  --image "$DEPLOY_IMAGE" \
  --region "$REGION" \
  --service-account "${RUNTIME_SA_EMAIL}" \
  --command node \
  --args backend/dist/jobs/externalScan.js \
  --max-retries 1 \
  --task-timeout 3600 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA_EMAIL},SCAN_BUCKET=${SCAN_BUCKET},SCAN_USER_CONCURRENCY=${SCAN_USER_CONCURRENCY}" \
  --set-secrets "WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  --quiet || warn "Could not deploy Cloud Run Job ${CLOUD_RUN_SCAN_JOB}; external-sharing scans will be unavailable until it is created."

# Optional durable storage for the org signature template (survives redeploys).
# Enable by exporting SIGNATURE_TEMPLATE_BUCKET before running this script; the
# runtime SA is granted object admin on it. Without it, templates fall back to
# ephemeral local disk (previous behavior).
if [[ -n "${SIGNATURE_TEMPLATE_BUCKET:-}" ]]; then
  log "Configuring durable signature-template storage in gs://${SIGNATURE_TEMPLATE_BUCKET}..."
  gcloud storage buckets describe "gs://${SIGNATURE_TEMPLATE_BUCKET}" &>/dev/null \
    || gcloud storage buckets create "gs://${SIGNATURE_TEMPLATE_BUCKET}" --project="$PROJECT_ID" --location="$REGION" --uniform-bucket-level-access --quiet
  gcloud storage buckets add-iam-policy-binding "gs://${SIGNATURE_TEMPLATE_BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin" --quiet
  gcloud run services update "$SERVICE_NAME" --region "$REGION" \
    --update-env-vars "SIGNATURE_TEMPLATE_BUCKET=${SIGNATURE_TEMPLATE_BUCKET}" --no-invoker-iam-check --quiet
fi

# Post-deploy smoke check: confirm the service answers /health (allow for cold start).
log "Running post-deploy health check..."
HEALTH_OK=false
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 10 "${SERVICE_URL}/health" | grep -q '"status":"ok"'; then
    HEALTH_OK=true
    break
  fi
  log "  health not ready (attempt ${attempt}/5), retrying in 5s..."
  sleep 5
done

echo ""
if [[ "$HEALTH_OK" == true ]]; then
  echo "Deployed successfully — /health responded OK."
else
  echo "WARNING: Deployed, but /health did not respond OK after retries. Check logs:"
  echo "  gcloud run services logs read ${SERVICE_NAME} --region ${REGION}"
fi
echo "Service URL:   ${SERVICE_URL}"
echo "Redirect URI:  ${REDIRECT_URI}"
echo ""
echo "Add the redirect URI to your OAuth Web client in GCP Console if not already done."

# APIs are enabled automatically above (provision_apis). Domain-wide delegation
# is the only step Google has no CLI/API for, so surface the exact scopes +
# Client ID + console link here (and live-verify when DWD_ADMIN_EMAIL is set).
# Non-fatal: the app degrades gracefully if a scope isn't yet authorized.
check_dwd_scopes "$PROJECT_ID" || true
