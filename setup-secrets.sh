#!/bin/bash
# setup-secrets.sh - Secret Manager setup for Cloud Run
# Usage: ./setup-secrets.sh [PROJECT_ID]
# For full greenfield setup use: bash scripts/bootstrap-tenant.sh
#
# Required env vars (or will prompt):
#   PROJECT_ID, CLIENT_ID, CLIENT_SECRET, JWT_SECRET, WORKSPACE_DOMAIN
# Optional: REDIRECT_URI, ALLOWED_DOMAINS, GCP_PROJECT_ID
#
# Auth is keyless — no service-account key is uploaded. Ensure the runtime SA
# has roles/iam.serviceAccountTokenCreator on itself (bootstrap-tenant.sh does
# this) so it can sign its own domain-wide-delegation tokens.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/scripts/lib/common.sh"
# shellcheck source=scripts/lib/gcp-provision.sh
source "${SCRIPT_DIR}/scripts/lib/gcp-provision.sh"

echo "=== Google Workspace Admin Assist - Secrets Setup ==="
echo "(For new tenants, prefer: bash scripts/bootstrap-tenant.sh)"
echo ""

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
if [ -z "$PROJECT_ID" ]; then
  read -p "Enter GCP PROJECT_ID: " PROJECT_ID
fi

[ -n "$PROJECT_ID" ] || die "PROJECT_ID is required"

gcloud config set project "$PROJECT_ID" --quiet

CLIENT_ID="${CLIENT_ID:-}"
if [ -z "$CLIENT_ID" ]; then
  read -p "Enter OAuth Client ID: " CLIENT_ID
fi

CLIENT_SECRET="${CLIENT_SECRET:-}"
if [ -z "$CLIENT_SECRET" ]; then
  read -s -p "Enter OAuth Client Secret: " CLIENT_SECRET
  echo
fi

REDIRECT_URI="${REDIRECT_URI:-https://PLACEHOLDER.run.app/api/auth/callback}"
JWT_SECRET="${JWT_SECRET:-}"
WORKSPACE_DOMAIN="${WORKSPACE_DOMAIN:-}"
ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-}"

if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(openssl rand -base64 32)
  echo "Generated JWT_SECRET (stored in Secret Manager)"
fi

if [ -z "$WORKSPACE_DOMAIN" ]; then
  read -p "Enter primary Workspace domain (e.g. yourcompany.com): " WORKSPACE_DOMAIN
fi

if [ -z "$ALLOWED_DOMAINS" ]; then
  read -p "Other allowed domains (comma-separated, optional; primary always included): " ALLOWED_EXTRA
  ALLOWED_DOMAINS="$WORKSPACE_DOMAIN"
  if [ -n "${ALLOWED_EXTRA:-}" ]; then
    ALLOWED_DOMAINS="${ALLOWED_DOMAINS},${ALLOWED_EXTRA}"
  fi
fi
# Normalize lowercase, no spaces
ALLOWED_DOMAINS="$(echo "$ALLOWED_DOMAINS" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"

provision_secrets "$PROJECT_ID" "$CLIENT_ID" "$CLIENT_SECRET" "$WORKSPACE_DOMAIN" \
  "$ALLOWED_DOMAINS" "" "$JWT_SECRET" "$REDIRECT_URI"

echo ""
echo "Secrets setup complete for project $PROJECT_ID"
echo "IAM bindings applied automatically."
echo ""
echo "Next: bash scripts/deploy-cloudshell.sh $PROJECT_ID"
echo "  or push to main for GitHub Actions deploy."
echo "See docs/DEPLOY.md for full flow."
