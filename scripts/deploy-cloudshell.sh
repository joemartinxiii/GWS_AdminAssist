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

if ! gcloud secrets describe service-account-key --project="$PROJECT_ID" &>/dev/null; then
  die "Secret 'service-account-key' not found. Run bootstrap-tenant.sh first."
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
  --service-account "${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_SECRET_NAME=service-account-key" \
  --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  --allow-unauthenticated \
  --no-invoker-iam-check \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
REDIRECT_URI="${SERVICE_URL}/api/auth/callback"

gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_SECRET_NAME=service-account-key,CORS_ORIGIN=${SERVICE_URL}" \
  --no-invoker-iam-check \
  --quiet

echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=- --quiet 2>/dev/null || true

echo ""
echo "Deployed successfully."
echo "Service URL:   ${SERVICE_URL}"
echo "Redirect URI:  ${REDIRECT_URI}"
echo ""
echo "Add the redirect URI to your OAuth Web client in GCP Console if not already done."
