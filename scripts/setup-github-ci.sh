#!/usr/bin/env bash
# One-time, keyless GitHub Actions CI setup via Workload Identity Federation (WIF).
#
# Why WIF (not a service-account key): this project is keyless by design because
# the org policy iam.disableServiceAccountKeyCreation blocks SA keys. WIF lets
# GitHub's OIDC token impersonate a deploy SA with no key to create, store, or
# rotate. Run this once (in Cloud Shell or anywhere gcloud is authenticated as a
# project owner); it prints the three GitHub secrets the workflow expects.
#
#   bash scripts/setup-github-ci.sh <PROJECT_ID> <GITHUB_OWNER/REPO> [REGION]
#
# Example:
#   bash scripts/setup-github-ci.sh my-proj joemartinxiii/GWS_AdminAssist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${SCRIPT_DIR}/lib/scopes.sh"

require_cmd gcloud

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
GITHUB_REPO="${2:-${GITHUB_REPO:-}}"
REGION="${3:-${REGION:-$DEFAULT_REGION}}"

[[ -n "$PROJECT_ID" ]] || PROJECT_ID="$(prompt_default "GCP project ID" "$(gcloud config get-value project 2>/dev/null)")"
[[ -n "$GITHUB_REPO" ]] || GITHUB_REPO="$(prompt_default "GitHub repo (owner/name)" "")"
[[ -n "$PROJECT_ID" ]] || die "Project ID is required."
[[ "$GITHUB_REPO" == */* ]] || die "GitHub repo must be in owner/name form (e.g. octocat/app)."

GITHUB_OWNER="${GITHUB_REPO%%/*}"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

log "Project: ${PROJECT_ID}  |  Repo: ${GITHUB_REPO}  |  Region: ${REGION}"
gcloud config set project "$PROJECT_ID" --quiet

# --- APIs -------------------------------------------------------------------
log "Enabling required APIs (IAM Credentials, STS, IAM, Resource Manager)..."
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --quiet

# --- Deploy service account -------------------------------------------------
if gcloud iam service-accounts describe "$DEPLOY_SA_EMAIL" &>/dev/null; then
  log "Deploy SA ${DEPLOY_SA_EMAIL} already exists."
else
  log "Creating deploy SA ${DEPLOY_SA_EMAIL}..."
  gcloud iam service-accounts create "$DEPLOY_SA" \
    --display-name="GitHub Actions deploy (keyless WIF)" --quiet
fi

# Least-privilege deploy roles. Steady-state deploys only need to: push images,
# deploy the Cloud Run service + scan job, and add the redirect-URI secret
# version. The one-time bucket / project-IAM bindings in the workflow are
# guarded with `|| true` (bootstrap already created them), so we deliberately do
# NOT grant storage.admin or projectIamAdmin here.
log "Granting deploy roles to ${DEPLOY_SA}..."
for role in roles/run.admin roles/artifactregistry.writer roles/secretmanager.secretVersionAdder; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" --role="$role" \
    --condition=None --quiet >/dev/null
done

# actAs on the runtime SA so `gcloud run deploy --service-account <runtime>` is
# allowed. Scoped to the runtime SA resource, not the whole project.
if gcloud iam service-accounts describe "$RUNTIME_SA_EMAIL" &>/dev/null; then
  log "Granting actAs on runtime SA ${RUNTIME_SA_EMAIL}..."
  gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser" --quiet >/dev/null
else
  warn "Runtime SA ${RUNTIME_SA_EMAIL} not found — run bootstrap-tenant.sh first, then re-run this script."
fi

# --- Workload Identity pool + GitHub OIDC provider --------------------------
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_FULL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

if gcloud iam workload-identity-pools describe "$POOL_ID" --location=global &>/dev/null; then
  log "WIF pool ${POOL_ID} already exists."
else
  log "Creating WIF pool ${POOL_ID}..."
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global --display-name="GitHub Actions" --quiet
fi

if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
     --location=global --workload-identity-pool="$POOL_ID" &>/dev/null; then
  log "WIF provider ${PROVIDER_ID} already exists (leaving as-is)."
else
  log "Creating GitHub OIDC provider ${PROVIDER_ID} (locked to owner '${GITHUB_OWNER}')..."
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository_owner == '${GITHUB_OWNER}'" \
    --quiet
fi

# Allow only this repo to impersonate the deploy SA.
log "Binding repo ${GITHUB_REPO} → ${DEPLOY_SA} (workloadIdentityUser)..."
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_FULL}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

PROVIDER_RESOURCE="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --location=global --workload-identity-pool="$POOL_ID" --format='value(name)')"

# --- Emit / set GitHub secrets ---------------------------------------------
echo ""
echo "=== GitHub Actions is now keyless. Set these repository secrets ==="
echo ""
echo "  GCP_PROJECT_ID   = ${PROJECT_ID}"
echo "  GCP_WIF_PROVIDER = ${PROVIDER_RESOURCE}"
echo "  GCP_DEPLOY_SA    = ${DEPLOY_SA_EMAIL}"
echo ""

if command -v gh >/dev/null 2>&1 && gh auth status &>/dev/null 2>&1; then
  if confirm "Set these secrets on ${GITHUB_REPO} via gh now?" "y"; then
    gh secret set GCP_PROJECT_ID   --repo "$GITHUB_REPO" --body "$PROJECT_ID"
    gh secret set GCP_WIF_PROVIDER --repo "$GITHUB_REPO" --body "$PROVIDER_RESOURCE"
    gh secret set GCP_DEPLOY_SA    --repo "$GITHUB_REPO" --body "$DEPLOY_SA_EMAIL"
    echo "  OK: secrets set on ${GITHUB_REPO}"
    if confirm "Trigger the Deploy workflow now?" "n"; then
      gh workflow run deploy.yml --repo "$GITHUB_REPO" \
        || gh workflow run "Deploy to Cloud Run" --repo "$GITHUB_REPO"
      echo "  Triggered. Watch: GitHub → Actions → Deploy to Cloud Run"
    fi
  fi
else
  echo "gh CLI not authenticated — set the three secrets by hand:"
  echo "  GitHub → Settings → Secrets and variables → Actions → New repository secret"
fi

echo ""
log "Done. Pushes to main will now deploy with no stored key."
