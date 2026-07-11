#!/usr/bin/env bash
# Cloud Run deployment via local Docker build + Artifact Registry.
# Prefer GitHub Actions or Cloud Shell (see docs/DEPLOY.md).
# Uses the same post-image deploy steps as every other path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/scripts/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/scripts/lib/scopes.sh"
# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/scripts/lib/gcp-provision.sh"

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-${REGION:-$DEFAULT_REGION}}"
SERVICE_NAME="$CLOUD_RUN_SERVICE"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE_NAME}"

if [[ -z "$PROJECT_ID" ]]; then
  die "Usage: ./deploy.sh [PROJECT_ID] [REGION]"
fi

echo "=== Google Workspace Admin Assist — local Docker deploy ==="
echo "Project: $PROJECT_ID  Region: $REGION"
echo ""

gcloud config set project "$PROJECT_ID" --quiet

if ! gcloud secrets describe app-jwt-secret --project="${PROJECT_ID}" &>/dev/null; then
  die "App secrets not found. Run bootstrap-tenant.sh first."
fi

require_cmd docker

provision_apis "$PROJECT_ID"
provision_artifact_registry "$PROJECT_ID" "$REGION"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo latest)"
DEPLOY_IMAGE="${IMAGE_BASE}:${GIT_SHA}"

log "Building Docker image for linux/amd64 (Cloud Run architecture)..."
docker build --platform linux/amd64 -t "$DEPLOY_IMAGE" -t "${IMAGE_BASE}:latest" .

log "Pushing image to Artifact Registry..."
docker push "$DEPLOY_IMAGE"
docker push "${IMAGE_BASE}:latest"

bash "${SCRIPT_DIR}/scripts/deploy-from-image.sh" "$PROJECT_ID" "$REGION" "$DEPLOY_IMAGE"
