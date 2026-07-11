#!/usr/bin/env bash
# Deploy an already-built Artifact Registry image to Cloud Run.
# Used by GitHub Actions and as the shared body for other deploy entrypoints.
#
# Usage:
#   bash scripts/deploy-from-image.sh <PROJECT_ID> <REGION> <IMAGE_REF>
#
# Example:
#   bash scripts/deploy-from-image.sh my-proj us-central1 \
#     us-central1-docker.pkg.dev/my-proj/workspace-admin-repo/workspace-admin:abc123

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"
# shellcheck source=scripts/lib/deploy-cloud-run.sh
source "${SCRIPT_DIR}/lib/deploy-cloud-run.sh"

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-${REGION:-$DEFAULT_REGION}}"
DEPLOY_IMAGE="${3:-${DEPLOY_IMAGE:-}}"

[[ -n "$PROJECT_ID" ]] || die "Usage: bash scripts/deploy-from-image.sh <PROJECT_ID> <REGION> <IMAGE_REF>"
[[ -n "$DEPLOY_IMAGE" ]] || die "Image ref required (arg 3 or DEPLOY_IMAGE)"

if ! gcloud secrets describe app-jwt-secret --project="$PROJECT_ID" &>/dev/null; then
  die "App secrets not found. Run bootstrap-tenant.sh first."
fi

gcloud config set project "$PROJECT_ID" --quiet

deploy_cloud_run "$PROJECT_ID" "$REGION" "$DEPLOY_IMAGE"
