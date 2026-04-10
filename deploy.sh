#!/bin/bash

# Deployment script for Google Cloud Run
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

set -e

PROJECT_ID=${1:-${GCP_PROJECT_ID}}
REGION=${2:-us-central1}
SERVICE_NAME="workspace-admin"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID is required"
  echo "Usage: ./deploy.sh [PROJECT_ID] [REGION]"
  exit 1
fi

echo "Deploying to GCP..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"

# Set the project
gcloud config set project $PROJECT_ID

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_NAME:latest .

# Push to Container Registry
echo "Pushing image to Container Registry..."
docker push $IMAGE_NAME:latest

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME:latest \
  --platform managed \
  --region $REGION \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,PORT=5000" \
  --set-secrets "GCP_PROJECT_ID=gcp-config/project-id,SERVICE_ACCOUNT_SECRET_NAME=service-account-key,GOOGLE_CLIENT_ID=oauth-config/client-id,GOOGLE_CLIENT_SECRET=oauth-config/client-secret,GOOGLE_REDIRECT_URI=oauth-config/redirect-uri,JWT_SECRET=app-secrets/jwt-secret,WORKSPACE_DOMAIN=app-secrets/workspace-domain,CORS_ORIGIN=app-secrets/cors-origin,GWS_ALLOWED_DOMAINS=app-secrets/allowed-domains"

echo "Deployment complete!"
echo "Service URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')"
