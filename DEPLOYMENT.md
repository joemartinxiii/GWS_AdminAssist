# Deployment Guide

This guide walks you through deploying the Google Workspace Admin UI to Google Cloud Run.

## Prerequisites

- Google Cloud Project with billing enabled
- Google Workspace domain with admin access
- `gcloud` CLI installed and configured
- Docker installed (for local builds)

## Quick Start

### 1. Initial Setup

```bash
# Clone and navigate to project
cd /path/to/project

# Install dependencies
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..
```

### 2. Configure GCP

```bash
# Set your project
export GCP_PROJECT_ID=your-project-id
gcloud config set project $GCP_PROJECT_ID

# Enable required APIs
gcloud services enable \
  admin.googleapis.com \
  drive.googleapis.com \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com
```

### 3. Set Up Secrets

Run the setup script:

```bash
./setup-secrets.sh $GCP_PROJECT_ID
```

Or manually create secrets (see SECURITY.md for details).

### 4. Create Service Account for Cloud Run

```bash
gcloud iam service-accounts create workspace-admin-sa \
  --display-name="Workspace Admin Service Account"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:workspace-admin-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 5. Deploy

#### Option A: Using the deployment script

```bash
./deploy.sh $GCP_PROJECT_ID us-central1
```

#### Option B: Manual deployment

```bash
# Build and push image
docker build -t gcr.io/$GCP_PROJECT_ID/workspace-admin:latest .
docker push gcr.io/$GCP_PROJECT_ID/workspace-admin:latest

# Deploy to Cloud Run
gcloud run deploy workspace-admin \
  --image gcr.io/$GCP_PROJECT_ID/workspace-admin:latest \
  --platform managed \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --service-account workspace-admin-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,PORT=5000" \
  --set-secrets "GCP_PROJECT_ID=gcp-config/project-id:latest,SERVICE_ACCOUNT_SECRET_NAME=service-account-key:latest,GOOGLE_CLIENT_ID=oauth-config/client-id:latest,GOOGLE_CLIENT_SECRET=oauth-config/client-secret:latest,GOOGLE_REDIRECT_URI=oauth-config/redirect-uri:latest,JWT_SECRET=app-secrets/jwt-secret:latest,WORKSPACE_DOMAIN=app-secrets/workspace-domain:latest,GWS_ALLOWED_DOMAINS=app-secrets/allowed-domains:latest"
```

### 6. Update OAuth Redirect URI

After deployment, get your Cloud Run URL:

```bash
gcloud run services describe workspace-admin --region us-central1 --format 'value(status.url)'
```

Update the OAuth redirect URI in:
1. GCP Console > APIs & Services > Credentials
2. Google Workspace Admin Console > Security > API Controls

## Local Development

### Using Docker Compose

```bash
# Create .env at the repo root with backend variables (OAuth, JWT, WORKSPACE_DOMAIN, etc.)
# See SECURITY.md — docker-compose loads env_file: .env

docker-compose up
```

### Manual Development

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

Access:
- Frontend: http://localhost:3000
- Backend API (Docker Compose): http://localhost:5000 — **Note:** `npm run dev` from the repo root runs the backend with default **port 5001** unless `PORT` is set; the Vite dev server proxies `/api` to 5001 (see `frontend/vite.config.mjs`).

## CI/CD with GitHub Actions

1. Add GitHub Secrets:
   - `GCP_PROJECT_ID`: Your GCP project ID
   - `GCP_SA_KEY`: Service account key JSON (for GitHub Actions)

2. Push to `main` branch to trigger deployment

## Cost Optimization

The application is architected for minimal GCP costs while maintaining enterprise-grade performance:

### Cloud Run Configuration
- **Min instances**: 0 (scales to zero when idle - **eliminates idle costs**)
- **Max instances**: 2 (prevents runaway scaling costs)
- **Memory**: 1Gi (optimal for Node.js admin tool)
- **CPU**: 1 vCPU (sufficient compute for API operations)
- **Timeout**: 300s (5 minutes - balances cost vs functionality)

### Free Tier Coverage
The app stays within GCP free tiers for typical usage:
- **Cloud Run**: 400K GB-seconds + 200K vCPU-seconds/month
- **Secret Manager**: 6 active secrets
- **Container Registry**: 5GB storage + 5GB pulls/month
- **Cloud Logging**: 50GB logs/month
- **Cloud Build**: 120 build-minutes/month (for deployments)

### Google Workspace API Costs
All Google Workspace APIs used have generous free tiers:
- **Admin SDK**: 1B requests/month
- **Drive API**: 1B requests/month
- **Gmail API**: 1B requests/month
- **Calendar API**: 1M requests/month

### Expected Monthly Costs by Usage

| Usage Pattern | Monthly Cost | Description |
|----------------|--------------|-------------|
| **Free Tier** | **$0** | < 10K admin sessions/month |
| **Light Usage** | **$1-5** | 1-2 admins, daily operations |
| **Moderate Usage** | **$5-15** | 5-10 admins, regular usage |
| **Heavy Usage** | **$15-50** | 20+ admins, constant operations |

### Cost-Saving Architecture Decisions
- **Single Cloud Run service** (no separate frontend/backend hosting)
- **Zero-scaling** (no idle compute costs)
- **Efficient API pagination** (minimizes API calls)
- **Streaming exports** (handles large datasets without memory bloat)
- **Audit logging to Cloud Logging** (free tier compliant)

### Monitoring Costs
Set up billing alerts in GCP Console to monitor usage and costs, though they should remain minimal for typical admin tool usage.

## Troubleshooting

### Build fails

- Check Docker is running
- Verify all dependencies are in package.json
- Check Dockerfile syntax

### Deployment fails

- Verify service account has correct permissions
- Check secrets exist in Secret Manager
- Verify API quotas haven't been exceeded

### Application errors

- Check Cloud Run logs: `gcloud run services logs read workspace-admin --region us-central1`
- Verify all secrets are correctly configured
- Check OAuth redirect URI matches Cloud Run URL

### Authentication issues

- Verify domain-wide delegation is set up
- Check service account key is valid
- Ensure OAuth consent screen is configured

## Monitoring

View logs:
```bash
gcloud run services logs read workspace-admin --region us-central1 --limit 50
```

View metrics in GCP Console:
- Cloud Run > workspace-admin > Metrics

## Updating

To update the application:

```bash
# Make changes, then:
./deploy.sh $GCP_PROJECT_ID us-central1
```

Or use GitHub Actions (if configured):
```bash
git push origin main
```
