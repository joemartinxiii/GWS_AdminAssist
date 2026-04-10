#!/bin/bash
# setup-secrets.sh - Simplified, non-interactive Secret Manager setup for Cloud Run
# Usage: ./setup-secrets.sh [PROJECT_ID]
# Supports env vars for all values (preferred for help desk). Uses placeholder for redirect URI.
# No longer requires URL before setup. Post-deploy update handled by deploy.sh.
#
# Required env vars (or will prompt):
#   PROJECT_ID, CLIENT_ID, CLIENT_SECRET, JWT_SECRET, WORKSPACE_DOMAIN, SA_KEY_PATH
# Optional: REDIRECT_URI, ALLOWED_DOMAINS, GCP_PROJECT_ID

set -euo pipefail

echo "=== Google Workspace Admin Assist - Secrets Setup ==="

# Get PROJECT_ID from arg, env, or prompt
PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
if [ -z "$PROJECT_ID" ]; then
  read -p "Enter GCP PROJECT_ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: PROJECT_ID is required"
  echo "Usage: ./setup-secrets.sh [PROJECT_ID] or set PROJECT_ID env var"
  exit 1
fi

echo "Setting up secrets for project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" --quiet

# Use env vars if set, else prompt (placeholder for redirect to avoid "don't have it yet")
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
if [ "$REDIRECT_URI" = "https://PLACEHOLDER.run.app/api/auth/callback" ]; then
  echo "Using placeholder redirect URI (deploy.sh will update with real URL after first deploy)."
fi

JWT_SECRET="${JWT_SECRET:-}"
if [ -z "$JWT_SECRET" ]; then
  echo "Generating strong JWT_SECRET..."
  JWT_SECRET=$(openssl rand -base64 32)
  echo "Generated JWT_SECRET: $JWT_SECRET (save this!)"
fi

WORKSPACE_DOMAIN="${WORKSPACE_DOMAIN:-}"
if [ -z "$WORKSPACE_DOMAIN" ]; then
  read -p "Enter Workspace Domain (e.g. yourcompany.com): " WORKSPACE_DOMAIN
fi

ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-$WORKSPACE_DOMAIN}"
SA_KEY_PATH="${SA_KEY_PATH:-}"
if [ -z "$SA_KEY_PATH" ]; then
  read -p "Enter path to service account key JSON (sa-key.json): " SA_KEY_PATH
fi

echo "Creating or updating secrets in Secret Manager..."

# OAuth secrets
echo -n "$CLIENT_ID" | gcloud secrets create oauth-client-id --data-file=- 2>/dev/null || \
  echo -n "$CLIENT_ID" | gcloud secrets versions add oauth-client-id --data-file=-
echo -n "$CLIENT_SECRET" | gcloud secrets create oauth-client-secret --data-file=- 2>/dev/null || \
  echo -n "$CLIENT_SECRET" | gcloud secrets versions add oauth-client-secret --data-file=-
echo -n "$REDIRECT_URI" | gcloud secrets create oauth-redirect-uri --data-file=- 2>/dev/null || \
  echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=-

# App secrets
echo -n "$JWT_SECRET" | gcloud secrets create app-jwt-secret --data-file=- 2>/dev/null || \
  echo -n "$JWT_SECRET" | gcloud secrets versions add app-jwt-secret --data-file=-
echo -n "$WORKSPACE_DOMAIN" | gcloud secrets create app-workspace-domain --data-file=- 2>/dev/null || \
  echo -n "$WORKSPACE_DOMAIN" | gcloud secrets versions add app-workspace-domain --data-file=-
echo -n "$ALLOWED_DOMAINS" | gcloud secrets create app-allowed-domains --data-file=- 2>/dev/null || \
  echo -n "$ALLOWED_DOMAINS" | gcloud secrets versions add app-allowed-domains --data-file=-

# Service account key (JSON)
SA_KEY_PATH="${SA_KEY_PATH#\'}"
SA_KEY_PATH="${SA_KEY_PATH%\'}"
SA_KEY_PATH="${SA_KEY_PATH#\"}"
SA_KEY_PATH="${SA_KEY_PATH%\"}"
if [ -f "$SA_KEY_PATH" ]; then
  echo "Loading service account key from $SA_KEY_PATH..."
  gcloud secrets create service-account-key --data-file="$SA_KEY_PATH" 2>/dev/null || \
    gcloud secrets versions add service-account-key --data-file="$SA_KEY_PATH"
else
  echo "⚠️  Warning: SA key file '$SA_KEY_PATH' not found. Create manually:"
  echo "  gcloud secrets create service-account-key --data-file=path/to/sa-key.json"
fi

echo ""
echo "✅ Secrets setup complete for project $PROJECT_ID!"
echo ""
echo "Next steps:"
echo "1. Run the IAM commands below to grant access to workspace-admin-sa (run once):"
echo ""
for SECRET_NAME in oauth-client-id oauth-client-secret oauth-redirect-uri app-jwt-secret app-workspace-domain app-allowed-domains service-account-key; do
  echo "  gcloud secrets add-iam-policy-binding $SECRET_NAME \\"
  echo "    --member=\"serviceAccount:workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com\" \\"
  echo "    --role=\"roles/secretmanager.secretAccessor\""
  echo ""
done
echo "2. Run ./deploy.sh $PROJECT_ID us-central1 (it will update redirect/CORS with real URL)"
echo "3. After deploy, verify the production redirect URI in OAuth console matches the service URL."
echo ""
echo "Placeholder was used for redirect URI. deploy.sh will add the correct version automatically."
echo "See DEPLOYMENT.md for full flow."
