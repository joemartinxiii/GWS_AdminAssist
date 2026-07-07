#!/bin/bash
# setup-secrets.sh - Secret Manager setup for Cloud Run
# Usage: ./setup-secrets.sh [PROJECT_ID]
# For full greenfield setup use: bash scripts/bootstrap-tenant.sh
#
# Required env vars (or will prompt):
#   PROJECT_ID, CLIENT_ID, CLIENT_SECRET, JWT_SECRET, WORKSPACE_DOMAIN, SA_KEY_PATH
# Optional: REDIRECT_URI, ALLOWED_DOMAINS, GCP_PROJECT_ID

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
SA_KEY_PATH="${SA_KEY_PATH:-}"

if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(openssl rand -base64 32)
  echo "Generated JWT_SECRET (stored in Secret Manager)"
fi

if [ -z "$WORKSPACE_DOMAIN" ]; then
  read -p "Enter Workspace Domain (e.g. yourcompany.com): " WORKSPACE_DOMAIN
fi

ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-$WORKSPACE_DOMAIN}"

if [ -z "$SA_KEY_PATH" ]; then
  read -p "Enter path to service account key JSON (sa-key.json): " SA_KEY_PATH
fi

SA_KEY_PATH="${SA_KEY_PATH#\'}"
SA_KEY_PATH="${SA_KEY_PATH%\'}"
SA_KEY_PATH="${SA_KEY_PATH#\"}"
SA_KEY_PATH="${SA_KEY_PATH%\"}"

[ -f "$SA_KEY_PATH" ] || die "SA key file not found: $SA_KEY_PATH"

provision_secrets "$PROJECT_ID" "$CLIENT_ID" "$CLIENT_SECRET" "$WORKSPACE_DOMAIN" \
  "$ALLOWED_DOMAINS" "$SA_KEY_PATH" "$JWT_SECRET" "$REDIRECT_URI"

echo ""
echo "Secrets setup complete for project $PROJECT_ID"
echo "IAM bindings applied automatically."
echo ""
echo "Next: bash scripts/deploy-cloudshell.sh $PROJECT_ID"
echo "  or push to main for GitHub Actions deploy."
echo "See docs/DEPLOY.md for full flow."
