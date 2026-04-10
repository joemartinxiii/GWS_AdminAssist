#!/bin/bash
# deploy.sh - Simplified, robust Cloud Run deployment
# Usage: ./deploy.sh [PROJECT_ID] [REGION]
# Now uses Artifact Registry + gcloud run deploy with --source for simplicity (uses your Dockerfile).
# Automatically handles first-deploy URL for CORS and oauth-redirect-uri secret updates.
# No more manual gcr.io or complex CORS logic — all automated.

set -euo pipefail

echo "=== Google Workspace Admin Assist - Cloud Run Deploy ==="

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-us-central1}"
SERVICE_NAME="workspace-admin"
REPO="cloud-run-source-deploy"  # Default for --source

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: PROJECT_ID is required"
  echo "Usage: ./deploy.sh [PROJECT_ID] [REGION] or set PROJECT_ID env var"
  echo "Example: PROJECT_ID=my-project ./deploy.sh"
  exit 1
fi

echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
gcloud config set project "$PROJECT_ID" --quiet

# Validate required secrets (from setup-secrets.sh)
REQUIRED_SECRETS=("app-jwt-secret" "app-workspace-domain" "oauth-client-id" "oauth-client-secret" "oauth-redirect-uri" "app-allowed-domains" "service-account-key")
echo "Validating secrets..."
for s in "${REQUIRED_SECRETS[@]}"; do
  if ! gcloud secrets describe "$s" --project="${PROJECT_ID}" &>/dev/null; then
    echo "❌ Error: Secret '$s' not found. Run ./setup-secrets.sh first."
    exit 1
  fi
  echo "  ✅ $s"
done

# Check for SA (basic)
if ! gcloud iam service-accounts describe "workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
  echo "⚠️  Warning: workspace-admin-sa not found. Ensure it exists and has permissions (see SECURITY.md)."
fi

echo "Building and deploying with Dockerfile (multi-stage frontend+backend)..."

# Use gcloud run deploy --source . for simplicity (handles build, push to AR, uses Dockerfile)
# This is the recommended modern approach per Cloud Run docs.
EXTRA_FLAGS=()
if [ "${CLOUD_RUN_PUBLIC:-}" = "1" ]; then
  EXTRA_FLAGS+=(--allow-unauthenticated)
fi

# Deploy (or update). --set-secrets injects into env. deploy.sh sets GCP_PROJECT_ID and SERVICE_ACCOUNT_SECRET_NAME directly.
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --platform managed \
  --region "$REGION" \
  --memory 1Gi \
  --cpu 1 \
  --cpu-boost \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --service-account "workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_SECRET_NAME=service-account-key" \
  --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  "${EXTRA_FLAGS[@]}" \
  --quiet

# Get the service URL (Cloud Run provides it)
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')
echo ""
echo "✅ Deployment successful!"
echo "Service URL: $SERVICE_URL"

# Update CORS_ORIGIN with real URL (Cloud Run update-env-vars)
echo "Updating CORS_ORIGIN with real URL..."
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "CORS_ORIGIN=${SERVICE_URL}" \
  --quiet

# Update oauth-redirect-uri secret with real production URL (add new version)
REAL_REDIRECT_URI="${SERVICE_URL}/api/auth/callback"
echo "Updating oauth-redirect-uri secret with real callback: $REAL_REDIRECT_URI"
echo -n "$REAL_REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=- 

echo ""
echo "✅ Updated CORS_ORIGIN and added new version to oauth-redirect-uri secret."
echo "The placeholder from setup-secrets.sh has been superseded."
echo ""
echo "Next steps:"
echo "1. Verify OAuth client in GCP Console has: $REAL_REDIRECT_URI in Authorized redirect URIs"
echo "2. Test: curl -I ${SERVICE_URL}/health"
echo "3. Open $SERVICE_URL in browser and test login flow"
echo "4. Check Cloud Run Logs for 'Environment validation passed' and 'Server listening'"
echo ""
if [ "${CLOUD_RUN_PUBLIC:-}" != "1" ]; then
  echo "🌍 For public browser access (if not using IAP):"
  echo "   gcloud run services add-iam-policy-binding $SERVICE_NAME --region=$REGION --member=allUsers --role=roles/run.invoker"
  echo ""
fi
echo "Redeploy anytime with: ./deploy.sh $PROJECT_ID $REGION"
echo "See DEPLOYMENT.md for troubleshooting."
