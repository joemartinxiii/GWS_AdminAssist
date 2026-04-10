#!/bin/bash

# Script to set up secrets in Secret Manager
# Usage: ./setup-secrets.sh [PROJECT_ID]

set -e

PROJECT_ID=${1:-${GCP_PROJECT_ID}}

if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID is required"
  echo "Usage: ./setup-secrets.sh [PROJECT_ID]"
  exit 1
fi

echo "Setting up secrets for project: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Create secrets (if they don't exist)
echo "Creating secrets..."

# GCP Config
echo -n "$PROJECT_ID" | gcloud secrets create gcp-config --data-file=- 2>/dev/null || \
  echo -n "$PROJECT_ID" | gcloud secrets versions add gcp-config --data-file=-

# OAuth Config
read -p "Enter OAuth Client ID: " CLIENT_ID
read -p "Enter OAuth Client Secret: " CLIENT_SECRET
read -p "Enter OAuth Redirect URI: " REDIRECT_URI

echo -n "$CLIENT_ID" | gcloud secrets create oauth-config --data-file=- 2>/dev/null || \
  echo -n "$CLIENT_ID" | gcloud secrets versions add oauth-config --data-file=-

echo -n "$CLIENT_SECRET" | gcloud secrets versions add oauth-config --data-file=-
echo -n "$REDIRECT_URI" | gcloud secrets versions add oauth-config --data-file=-

# App Secrets
read -p "Enter JWT Secret (generate a strong random string): " JWT_SECRET
read -p "Enter Workspace Domain: " WORKSPACE_DOMAIN
read -p "Enter CORS Origin (your Cloud Run URL, e.g., https://your-app-url.a.run.app): " CORS_ORIGIN
read -p "Enter Allowed Domains (comma-separated, leave empty for single domain): " ALLOWED_DOMAINS

echo -n "$JWT_SECRET" | gcloud secrets create app-secrets --data-file=- 2>/dev/null || \
  echo -n "$JWT_SECRET" | gcloud secrets versions add app-secrets --data-file=-

echo -n "$WORKSPACE_DOMAIN" | gcloud secrets versions add app-secrets --data-file=-
echo -n "$CORS_ORIGIN" | gcloud secrets versions add app-secrets --data-file=-

if [ -n "$ALLOWED_DOMAINS" ]; then
  echo -n "$ALLOWED_DOMAINS" | gcloud secrets versions add app-secrets --data-file=-
else
  echo -n "$WORKSPACE_DOMAIN" | gcloud secrets versions add app-secrets --data-file=-
fi

# Service Account Key
read -p "Enter path to service account key JSON file: " SA_KEY_PATH
if [ -f "$SA_KEY_PATH" ]; then
  gcloud secrets create service-account-key --data-file="$SA_KEY_PATH" 2>/dev/null || \
    gcloud secrets versions add service-account-key --data-file="$SA_KEY_PATH"
else
  echo "Warning: Service account key file not found. Please add it manually:"
  echo "  gcloud secrets create service-account-key --data-file=path/to/key.json"
fi

echo ""
echo "Secrets created successfully!"
echo ""
echo "Next steps:"
echo "1. Grant Secret Manager access to your Cloud Run service account:"
echo "   gcloud secrets add-iam-binding SECRET_NAME \\"
echo "     --member=\"serviceAccount:workspace-admin-sa@$PROJECT_ID.iam.gserviceaccount.com\" \\"
echo "     --role=\"roles/secretmanager.secretAccessor\""
