#!/usr/bin/env bash
# Cloud Shell one-command new-tenant bootstrap wizard.
#
# Zero-flag usage (recommended) — the wizard prompts for everything with
# auto-detected defaults (your account, domain, billing, a new project):
#   bash scripts/bootstrap-tenant.sh
#
# Or pre-fill any/all values with flags to skip the matching prompts:
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

Usage (zero-flag, recommended — prompts for everything with smart defaults):
  bash scripts/bootstrap-tenant.sh

Usage (pre-filled — any flag skips its prompt):
  bash scripts/bootstrap-tenant.sh --domain DOMAIN --project PROJECT_ID --admin ADMIN_EMAIL [options]

Prompted-or-flags (interactive mode fills these in for you):
  --domain DOMAIN        Primary Workspace domain (default: from admin email)
  --project PROJECT_ID   GCP project ID (interactive: create new or pick existing)
  --admin EMAIL          Workspace super admin email (default: active gcloud account)

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

Example (one command, no editing required):
  git clone <YOUR_REPO_URL> && cd GWS_AdminAssist && bash scripts/bootstrap-tenant.sh
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

require_cmd gcloud
require_cmd openssl
require_cmd curl

# Phase 0 — Preflight (auth needed before we can auto-detect anything)
if ! gcloud auth print-access-token &>/dev/null; then
  die "gcloud not authenticated. Run: gcloud auth login"
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"

# --- Resolve required inputs -------------------------------------------------
# In interactive mode (the default), prompt for anything not passed as a flag,
# auto-detecting sensible defaults so a plain `bash scripts/bootstrap-tenant.sh`
# with zero flags just works. --non-interactive requires all values up front.
if [[ "$NON_INTERACTIVE" == "true" ]]; then
  [[ -n "$PROJECT_ID" ]] || die "Missing --project (required with --non-interactive)"
  [[ -n "$WORKSPACE_DOMAIN" ]] || die "Missing --domain (required with --non-interactive)"
  [[ -n "$ADMIN_EMAIL" ]] || die "Missing --admin (required with --non-interactive)"
else
  echo ""
  echo "=============================================="
  echo "  Workspace Admin Assist — Setup Wizard"
  echo "=============================================="
  echo "  Answer a few questions. Press Enter to accept each [default]."
  echo "  Signed in as: ${ACTIVE_ACCOUNT}"
  echo "=============================================="
  echo ""

  if [[ -z "$ADMIN_EMAIL" ]]; then
    ADMIN_EMAIL="$(prompt_default "Workspace super-admin email" "$ACTIVE_ACCOUNT")"
  fi

  if [[ -z "$WORKSPACE_DOMAIN" ]]; then
    WORKSPACE_DOMAIN="$(prompt_default "Primary Workspace domain" "${ADMIN_EMAIL##*@}")"
  fi

  if [[ -z "$PROJECT_ID" ]]; then
    echo ""
    echo "GCP project:"
    echo "  1) Create a NEW project  (recommended for first-time setup)"
    echo "  2) Use an EXISTING project"
    PROJECT_CHOICE="$(prompt_default "Choose 1 or 2" "1")"
    if [[ "$PROJECT_CHOICE" == "2" ]]; then
      echo ""
      echo "Your projects:"
      gcloud projects list --format='table(projectId,name)' 2>/dev/null || true
      echo ""
      PROJECT_ID="$(prompt_default "Existing project ID" "")"
      [[ -n "$PROJECT_ID" ]] || die "Project ID is required"
    else
      RAND="${RANDOM}${RANDOM}"
      PROJECT_ID="$(prompt_default "New project ID (lowercase, 6-30 chars, globally unique)" "gws-admin-${RAND:0:6}")"
      CREATE_PROJECT=true
    fi
  fi

  # Billing is required to create a project / deploy to Cloud Run.
  if [[ "$CREATE_PROJECT" == "true" && -z "$BILLING_ACCOUNT" ]]; then
    mapfile -t OPEN_BILLING < <(gcloud billing accounts list --filter='open=true' --format='value(name)' 2>/dev/null | sed 's#billingAccounts/##')
    if [[ "${#OPEN_BILLING[@]}" -eq 1 ]]; then
      BILLING_ACCOUNT="${OPEN_BILLING[0]}"
      log "Using your billing account: ${BILLING_ACCOUNT}"
    elif [[ "${#OPEN_BILLING[@]}" -gt 1 ]]; then
      echo ""
      echo "Open billing accounts:"
      gcloud billing accounts list --filter='open=true' --format='table(name,displayName)' 2>/dev/null || true
      echo ""
      BILLING_ACCOUNT="$(prompt_default "Billing account ID" "${OPEN_BILLING[0]}")"
    else
      warn "No open billing account found. Create one: https://console.cloud.google.com/billing"
      BILLING_ACCOUNT="$(prompt_default "Billing account ID (leave blank to skip)" "")"
    fi
  fi
fi

[[ -n "$PROJECT_ID" ]] || die "Missing project"
[[ -n "$WORKSPACE_DOMAIN" ]] || die "Missing domain"
[[ -n "$ADMIN_EMAIL" ]] || die "Missing admin email"

if [[ "$ADMIN_EMAIL" != *"@$WORKSPACE_DOMAIN" ]]; then
  warn "Admin email (${ADMIN_EMAIL}) domain does not match ${WORKSPACE_DOMAIN}"
fi

echo ""
echo "=============================================="
echo "  Ready to bootstrap"
echo "=============================================="
echo "  Project:  ${PROJECT_ID}$([[ "$CREATE_PROJECT" == "true" ]] && echo "  (will be created)")"
echo "  Domain:   ${WORKSPACE_DOMAIN}"
echo "  Admin:    ${ADMIN_EMAIL}"
echo "  Region:   ${REGION}"
echo "=============================================="
echo ""

if [[ "$NON_INTERACTIVE" != "true" ]]; then
  confirm "Proceed with these settings?" "y" || die "Aborted by user"
  echo ""
fi

log "Active gcloud account: ${ACTIVE_ACCOUNT}"

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
