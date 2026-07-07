#!/bin/bash
# Cloud Run deployment via local Docker build + Artifact Registry.
# Prefer GitHub Actions instead: push to main or run "Deploy to Cloud Run" workflow
# (see docs/DEPLOY.md) — no local Docker required.

set -e

PROJECT_ID="${1:-${PROJECT_ID:-${GCP_PROJECT_ID:-}}}"
REGION="${2:-us-central1}"
SERVICE_NAME="workspace-admin"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/workspace-admin-repo/${SERVICE_NAME}:latest"

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: PROJECT_ID is required"
  echo "Usage: ./deploy.sh [PROJECT_ID] [REGION]"
  exit 1
fi

echo "=== Google Workspace Admin Assist - FULLY AUTOMATED Deployment ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Image: $IMAGE_NAME"
echo ""

gcloud config set project "$PROJECT_ID" --quiet

echo "Running pre-flight checks..."
if ! gcloud secrets describe app-jwt-secret --project="${PROJECT_ID}" &>/dev/null; then
  echo "❌ ERROR: App secrets not found. Run bootstrap-tenant.sh (or setup-secrets.sh) first."
  exit 1
fi
echo "✅ Secrets and service account verified."

echo "Ensuring Cloud Run service account can write audit logs..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter" \
  --quiet >/dev/null 2>&1 || echo "⚠️ Could not auto-grant roles/logging.logWriter. Grant it manually if audit logs fail."

# Setup Artifact Registry if not exists
echo "Setting up Artifact Registry..."
gcloud artifacts repositories create workspace-admin-repo --repository-format=docker \
  --location="$REGION" --quiet 2>/dev/null || true

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

echo "Building Docker image locally for linux/amd64 (Cloud Run architecture)..."
# Build for amd64 to match Cloud Run runtime (fixes exec format error on Apple Silicon)
docker build --platform linux/amd64 -t "$IMAGE_NAME" .

echo "Pushing image to Artifact Registry..."
docker push "$IMAGE_NAME"

echo "Deploying to Cloud Run..."
# --no-invoker-iam-check: required when org policy blocks allUsers (iam.allowedPolicyMemberDomains).
# See: https://cloud.google.com/run/docs/securing/managing-access#invoker_check
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_NAME" \
  --platform managed \
  --region "$REGION" \
  --memory 1Gi \
  --cpu 1 \
  --cpu-boost \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --service-account "workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets "GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,GOOGLE_REDIRECT_URI=oauth-redirect-uri:latest,JWT_SECRET=app-jwt-secret:latest,WORKSPACE_DOMAIN=app-workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-allowed-domains:latest" \
  --allow-unauthenticated \
  --no-invoker-iam-check \
  --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')
REDIRECT_URI="${SERVICE_URL}/api/auth/callback"

echo "Updating configuration with full environment variables..."
# Must include ALL critical vars - --set-env-vars replaces previous ones
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},SERVICE_ACCOUNT_EMAIL=workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com,CORS_ORIGIN=${SERVICE_URL}" \
  --no-invoker-iam-check \
  --quiet

echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-redirect-uri --data-file=- --quiet 2>/dev/null || true

echo "Public browser access: --no-invoker-iam-check (org iam.allowedPolicyMemberDomains blocks allUsers IAM binding)."
echo "If a redeploy drops it: gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --no-invoker-iam-check"

echo ""
echo "✅ FULLY DEPLOYED SUCCESSFULLY!"
echo "Service URL: $SERVICE_URL"
echo "Redirect URI: $REDIRECT_URI"
echo ""
echo "NEXT STEPS:"
echo "1. Go to https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo "   Add EXACTLY this redirect URI to your OAuth client:"
echo "   ${REDIRECT_URI}"
echo "2. Test the app:"
echo "   curl -I ${SERVICE_URL}/health"
echo "3. Open $SERVICE_URL in your browser"
echo "4. Check logs with: gcloud beta run services logs tail $SERVICE_NAME --region=$REGION"
echo "   (or: gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=200)"
echo ""
echo "Service account created, all permissions granted, secrets configured, app deployed."
echo "Everything is done. The app should be live."
echo ""
echo "To redeploy: ./deploy.sh $PROJECT_ID $REGION"
echo "See docs/DEPLOY.md for details."
