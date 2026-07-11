#!/usr/bin/env bash
# Deploy to Cloud Run via Cloud Build (no local Docker). Preferred manual path.
# Mirrors GitHub Actions: build image → scripts/deploy-from-image.sh (shared steps).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"
# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/lib/gcp-provision.sh"

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-${REGION:-$DEFAULT_REGION}}"

if [[ -z "$PROJECT_ID" ]]; then
  die "Usage: bash scripts/deploy-cloudshell.sh [PROJECT_ID] [REGION]"
fi

SERVICE_NAME="$CLOUD_RUN_SERVICE"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE_NAME}"

log "Deploying ${SERVICE_NAME} to Cloud Run via Cloud Build..."
gcloud config set project "$PROJECT_ID" --quiet

if ! gcloud secrets describe app-jwt-secret --project="$PROJECT_ID" &>/dev/null; then
  die "App secrets not found. Run bootstrap-tenant.sh first."
fi

# Keep the enabled API set in sync on every deploy (idempotent).
provision_apis "$PROJECT_ID"
provision_artifact_registry "$PROJECT_ID" "$REGION"
grant_cloudbuild_permissions "$PROJECT_ID"

log "Building and pushing image (Cloud Build)..."
GIT_TAG="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo latest)"
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

bash "${SCRIPT_DIR}/deploy-from-image.sh" "$PROJECT_ID" "$REGION" "$DEPLOY_IMAGE"
