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

log "Deploying ${SERVICE_NAME} to Cloud Run via Cloud Build..."
gcloud config set project "$PROJECT_ID" --quiet

RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud secrets describe app-jwt-secret --project="$PROJECT_ID" &>/dev/null; then
  die "App secrets not found. Run bootstrap-tenant.sh first."
fi

# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/lib/gcp-provision.sh"
provision_artifact_registry "$PROJECT_ID" "$REGION"

log "Building and pushing image (Cloud Build)..."
gcloud builds submit "$REPO_ROOT" \
  --tag "${IMAGE}:latest" \
  --tag "${IMAGE}:$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo latest)" \
  --quiet

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
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA_EMAIL}" \
  --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  --allow-unauthenticated \
  --no-invoker-iam-check \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
REDIRECT_URI="${SERVICE_URL}/api/auth/callback"

gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA_EMAIL},CORS_ORIGIN=${SERVICE_URL}" \
  --no-invoker-iam-check \
  --quiet

echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=- --quiet 2>/dev/null || true

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
