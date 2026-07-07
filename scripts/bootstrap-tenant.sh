#!/usr/bin/env bash
# Cloud Shell one-command new-tenant bootstrap wizard.
#
# Usage:
#   bash scripts/bootstrap-tenant.sh --domain yourcompany.com --project your-gcp-project --admin you@yourcompany.com
#
# Options:
#   --create-project       Create a new GCP project (requires --project as new ID)
#   --billing-account ID   Link billing (required for new projects)
#   --organization ID      Org for new project
#   --folder ID            Folder for new project
#   --region REGION        Default us-central1
#   --skip-cloudshell      Skip Cloud Shell deploy (GitHub only)
#   --skip-github          Skip GitHub secrets setup
#   --non-interactive      Fail instead of prompting (requires all values via flags/env)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"
# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/lib/gcp-provision.sh"
# shellcheck source=scripts/lib/gws-guide.sh
source "${SCRIPT_DIR}/lib/gws-guide.sh"
# shellcheck source=scripts/lib/verify-setup.sh
source "${SCRIPT_DIR}/lib/verify-setup.sh"
# shellcheck source=scripts/lib/github-setup.sh
source "${SCRIPT_DIR}/lib/github-setup.sh"

PROJECT_ID=""
WORKSPACE_DOMAIN=""
ADMIN_EMAIL=""
REGION="$DEFAULT_REGION"
CREATE_PROJECT=false
BILLING_ACCOUNT=""
ORG_ID=""
FOLDER_ID=""
SKIP_CLOUDSHELL=false
SKIP_GITHUB=false
NON_INTERACTIVE=false
GITHUB_REPO=""

usage() {
  cat <<EOF
Cloud Shell bootstrap wizard for Google Workspace Admin Assist.

Usage:
  bash scripts/bootstrap-tenant.sh --domain DOMAIN --project PROJECT_ID --admin ADMIN_EMAIL [options]

Required:
  --domain DOMAIN        Primary Workspace domain (e.g. yourcompany.com)
  --project PROJECT_ID   GCP project ID (existing or new with --create-project)
  --admin EMAIL          Workspace super admin email for DWD verification

Options:
  --create-project       Create the GCP project before provisioning
  --billing-account ID   Billing account to link (required for new projects)
  --organization ID      GCP organization for new project
  --folder ID            GCP folder for new project
  --region REGION        Cloud Run region (default: ${DEFAULT_REGION})
  --github-repo OWNER/REPO  GitHub repo for gh secret set (default: auto-detect)
  --skip-cloudshell      Skip immediate Cloud Shell deploy
  --skip-github          Skip GitHub Actions secrets setup
  --non-interactive      No prompts (requires --billing-account for new projects)
  -h, --help             Show this help

Example:
  git clone <YOUR_REPO_URL> && cd GWS_AdminAssist && \\
    bash scripts/bootstrap-tenant.sh --domain yourcompany.com --project your-gcp-project --admin you@yourcompany.com
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) WORKSPACE_DOMAIN="$2"; shift 2 ;;
    --project) PROJECT_ID="$2"; shift 2 ;;
    --admin) ADMIN_EMAIL="$2"; shift 2 ;;
    --create-project) CREATE_PROJECT=true; shift ;;
    --billing-account) BILLING_ACCOUNT="$2"; shift 2 ;;
    --organization) ORG_ID="$2"; shift 2 ;;
    --folder) FOLDER_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO="$2"; shift 2 ;;
    --skip-cloudshell) SKIP_CLOUDSHELL=true; shift ;;
    --skip-github) SKIP_GITHUB=true; shift ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || die "Missing --project"
[[ -n "$WORKSPACE_DOMAIN" ]] || die "Missing --domain"
[[ -n "$ADMIN_EMAIL" ]] || die "Missing --admin"

require_cmd gcloud
require_cmd openssl
require_cmd curl

echo ""
echo "=============================================="
echo "  Workspace Admin Assist — Bootstrap Wizard"
echo "=============================================="
echo "  Project:  ${PROJECT_ID}"
echo "  Domain:   ${WORKSPACE_DOMAIN}"
echo "  Admin:    ${ADMIN_EMAIL}"
echo "  Region:   ${REGION}"
echo "=============================================="
echo ""

# Phase 0 — Preflight
log "Phase 0: Preflight"
if ! gcloud auth print-access-token &>/dev/null; then
  die "gcloud not authenticated. Run: gcloud auth login"
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
log "Active gcloud account: ${ACTIVE_ACCOUNT}"

if [[ "$ADMIN_EMAIL" != *"@$WORKSPACE_DOMAIN"* && "$ADMIN_EMAIL" != *"@$WORKSPACE_DOMAIN" ]]; then
  warn "Admin email domain may not match --domain (${WORKSPACE_DOMAIN})"
fi

provision_project "$PROJECT_ID" "$CREATE_PROJECT" "$BILLING_ACCOUNT" "$ORG_ID" "$FOLDER_ID"

TMP_DIR="${REPO_ROOT}/.bootstrap-tmp-$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

RUNTIME_KEY="${TMP_DIR}/workspace-admin-sa-key.json"
DEPLOY_KEY="${TMP_DIR}/github-deploy-sa-key.json"

# Phase 1 — GCP provision
log "Phase 1: GCP provision (APIs, service accounts, secrets, Artifact Registry)"
provision_apis "$PROJECT_ID"
provision_runtime_sa "$PROJECT_ID"
provision_deploy_sa "$PROJECT_ID"

verify_sa_key_policy "$PROJECT_ID" "$RUNTIME_SA" || true

create_sa_key "$PROJECT_ID" "$RUNTIME_SA" "$RUNTIME_KEY"
create_sa_key "$PROJECT_ID" "$DEPLOY_SA" "$DEPLOY_KEY"

provision_secrets "$PROJECT_ID" "" "" "$WORKSPACE_DOMAIN" "$WORKSPACE_DOMAIN" "$RUNTIME_KEY"
provision_artifact_registry "$PROJECT_ID" "$REGION"

SA_CLIENT_ID="$(get_sa_client_id "$RUNTIME_KEY")"
log "Service account DWD client_id: ${SA_CLIENT_ID}"

# Phase 2 — OAuth (guided)
log "Phase 2: OAuth setup (GCP Console — guided)"
guide_oauth_setup "$PROJECT_ID"

if [[ "$NON_INTERACTIVE" == "true" ]]; then
  [[ -n "${CLIENT_ID:-}" && -n "${CLIENT_SECRET:-}" ]] || die "Set CLIENT_ID and CLIENT_SECRET env vars in non-interactive mode"
else
  mapfile -t OAUTH_CREDS < <(prompt_oauth_credentials)
  CLIENT_ID="${OAUTH_CREDS[0]}"
  CLIENT_SECRET="${OAUTH_CREDS[1]}"
fi

provision_secrets "$PROJECT_ID" "$CLIENT_ID" "$CLIENT_SECRET" "$WORKSPACE_DOMAIN" "$WORKSPACE_DOMAIN" "$RUNTIME_KEY"
verify_secrets "$PROJECT_ID"

# Phase 3 — GWS DWD (guided + validated)
log "Phase 3: Domain-wide delegation (Workspace Admin — guided)"
guide_dwd_setup "$SA_CLIENT_ID"

DWD_OK=false
for attempt in 1 2 3; do
  if verify_dwd "$RUNTIME_KEY" "$ADMIN_EMAIL" 2>/dev/null; then
    DWD_OK=true
    break
  fi
  if [[ "$attempt" -lt 3 ]]; then
    warn "DWD verification failed (attempt ${attempt}/3). Waiting 30s for propagation..."
    sleep 30
  fi
done

if [[ "$DWD_OK" != "true" ]]; then
  verify_dwd "$RUNTIME_KEY" "$ADMIN_EMAIL" || die "DWD verification failed after 3 attempts"
fi

# Phase 4 — First deploy
SERVICE_URL=""
REDIRECT_URI=""

if [[ "$SKIP_CLOUDSHELL" != "true" ]]; then
  log "Phase 4a: Cloud Shell deploy (Cloud Build)"
  bash "${SCRIPT_DIR}/deploy-cloudshell.sh" "$PROJECT_ID" "$REGION"
  SERVICE_URL="$(gcloud run services describe "$CLOUD_RUN_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
  REDIRECT_URI="${SERVICE_URL}/api/auth/callback"
  guide_oauth_redirect_after_deploy "$PROJECT_ID" "$REDIRECT_URI"
  verify_health "$SERVICE_URL"
else
  log "Phase 4a: Skipped Cloud Shell deploy (--skip-cloudshell)"
fi

if [[ "$SKIP_GITHUB" != "true" ]]; then
  log "Phase 4b: GitHub Actions setup"
  if [[ -z "$GITHUB_REPO" ]] && command -v gh >/dev/null 2>&1; then
    GITHUB_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  fi
  setup_github_secrets "$PROJECT_ID" "$DEPLOY_KEY" "$GITHUB_REPO"
else
  log "Phase 4b: Skipped GitHub setup (--skip-github)"
fi

# Phase 5 — Summary
echo ""
echo "=============================================="
echo "  Bootstrap complete"
echo "=============================================="
if [[ -n "$SERVICE_URL" ]]; then
  echo "  Service URL:  ${SERVICE_URL}"
  echo "  Login:        ${SERVICE_URL}"
  echo "  Health:       ${SERVICE_URL}/health"
  echo "  Redirect URI: ${REDIRECT_URI}"
else
  echo "  Deploy via GitHub Actions or: bash scripts/deploy-cloudshell.sh ${PROJECT_ID} ${REGION}"
fi
echo ""
echo "  DWD client_id: ${SA_CLIENT_ID}"
echo "  Workspace domain: ${WORKSPACE_DOMAIN}"
echo ""
echo "  Role expectations:"
echo "    Super admins  — full mutations"
echo "    Delegated admins — view only"
echo ""
echo "  Ongoing deploys: push to main or Actions → Deploy to Cloud Run"
echo "=============================================="
