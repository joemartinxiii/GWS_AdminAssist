#!/usr/bin/env bash
# Full GCP teardown for Workspace Admin Assist — use before a from-scratch bootstrap demo.
#
# Usage:
#   bash scripts/teardown-project.sh --project PROJECT_ID [--region us-central1] [--delete-project]
#
# Does NOT touch Google Workspace (DWD) or OAuth clients — see docs/DEPLOY.md "Teardown / rebuild".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"

PROJECT_ID=""
REGION="$DEFAULT_REGION"
DELETE_PROJECT=false
CONFIRM=""

usage() {
  cat <<EOF
Full teardown of Workspace Admin Assist GCP resources.

Usage:
  bash scripts/teardown-project.sh --project PROJECT_ID [options]

Options:
  --region REGION        Cloud Run / Artifact Registry region (default: ${DEFAULT_REGION})
  --delete-project       Delete the entire GCP project after removing resources
  --yes                  Skip confirmation prompt (destructive)
  -h, --help             Show this help

Removes:
  - Cloud Run service (${CLOUD_RUN_SERVICE})
  - External-sharing scan job (${CLOUD_RUN_SCAN_JOB}) and its report bucket
  - All app Secret Manager secrets
  - Service accounts (${RUNTIME_SA}, ${DEPLOY_SA}) and their keys
  - Artifact Registry repo (${ARTIFACT_REPO})

Manual steps still required (documented in docs/DEPLOY.md):
  - Remove DWD entry in admin.google.com
  - Remove or reset OAuth Web client in GCP Console
  - Clear GitHub Actions secrets (GCP_PROJECT_ID, GCP_WIF_PROVIDER, GCP_DEPLOY_SA;
    and GCP_SA_KEY if you used the key fallback)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --delete-project) DELETE_PROJECT=true; shift ;;
    --yes) CONFIRM="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || die "Missing --project"

require_cmd gcloud

echo ""
echo "=============================================="
echo "  FULL TEARDOWN — ${PROJECT_ID}"
echo "=============================================="
echo "  Region:         ${REGION}"
echo "  Delete project: ${DELETE_PROJECT}"
echo "=============================================="
echo ""

if [[ "$CONFIRM" != "yes" ]]; then
  echo "This will permanently remove Cloud Run, secrets, service accounts, and images."
  read -r -p "Type the project ID to confirm: " typed
  [[ "$typed" == "$PROJECT_ID" ]] || die "Confirmation failed"
fi

gcloud config set project "$PROJECT_ID" --quiet 2>/dev/null || true

log "Deleting Cloud Run service ${CLOUD_RUN_SERVICE}..."
gcloud run services delete "$CLOUD_RUN_SERVICE" --region="$REGION" --quiet 2>/dev/null || \
  warn "Cloud Run service not found (already deleted?)"

log "Deleting external-sharing scan job ${CLOUD_RUN_SCAN_JOB}..."
gcloud run jobs delete "$CLOUD_RUN_SCAN_JOB" --region="$REGION" --quiet 2>/dev/null && echo "  deleted: ${CLOUD_RUN_SCAN_JOB}" || \
  echo "  skip: ${CLOUD_RUN_SCAN_JOB} (not found)"

SCAN_BUCKET="${SCAN_BUCKET:-${PROJECT_ID}-workspace-admin-scans}"
log "Deleting scan report bucket gs://${SCAN_BUCKET}..."
gcloud storage rm --recursive "gs://${SCAN_BUCKET}" --quiet 2>/dev/null && echo "  deleted: gs://${SCAN_BUCKET}" || \
  echo "  skip: gs://${SCAN_BUCKET} (not found)"

log "Deleting Secret Manager secrets..."
for secret_name in "${APP_SECRETS[@]}"; do
  gcloud secrets delete "$secret_name" --quiet 2>/dev/null && echo "  deleted: ${secret_name}" || \
    echo "  skip: ${secret_name} (not found)"
done

log "Deleting service accounts..."
for sa in "$RUNTIME_SA" "$DEPLOY_SA"; do
  sa_email="${sa}@${PROJECT_ID}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$sa_email" &>/dev/null 2>&1; then
    gcloud iam service-accounts delete "$sa_email" --quiet
    echo "  deleted: ${sa_email}"
  else
    echo "  skip: ${sa_email} (not found)"
  fi
done

log "Deleting Artifact Registry repo ${ARTIFACT_REPO}..."
gcloud artifacts repositories delete "$ARTIFACT_REPO" \
  --location="$REGION" --quiet 2>/dev/null && echo "  deleted: ${ARTIFACT_REPO}" || \
  echo "  skip: ${ARTIFACT_REPO} (not found)"

if [[ "$DELETE_PROJECT" == "true" ]]; then
  log "Deleting GCP project ${PROJECT_ID}..."
  gcloud projects delete "$PROJECT_ID" --quiet
  echo ""
  echo "Project ${PROJECT_ID} scheduled for deletion (GCP may take a few minutes)."
else
  echo ""
  echo "GCP app resources removed. Project ${PROJECT_ID} still exists (APIs/billing unchanged)."
fi

echo ""
echo "=============================================="
echo "  Manual cleanup (Workspace + OAuth + GitHub)"
echo "=============================================="
echo ""
echo "1. Google Workspace Admin — remove DWD entry:"
echo "   https://admin.google.com/ac/owl/domainwidedelegation"
echo "   (Delete the API client for the OLD service account client_id)"
echo ""
echo "2. GCP OAuth — remove or archive Web client:"
echo "   https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
echo ""
echo "3. GitHub — remove or update Actions secrets:"
echo "   GCP_PROJECT_ID, GCP_WIF_PROVIDER, GCP_DEPLOY_SA"
echo "   (and GCP_SA_KEY only if you used the key fallback)"
echo "   https://github.com/<owner>/<repo>/settings/secrets/actions"
echo ""
echo "4. Rebuild from scratch:"
echo "   bash scripts/bootstrap-tenant.sh --domain YOUR_DOMAIN --project ${PROJECT_ID} --admin YOU@YOUR_DOMAIN"
echo ""
echo "See docs/DEPLOY.md for the full from-scratch walkthrough."
echo "=============================================="
