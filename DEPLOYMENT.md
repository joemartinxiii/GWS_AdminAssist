# Google Workspace Admin Assist - Professional Deployment

> **New tenant?** Start with **[docs/NEW_DEPLOY.md](./docs/NEW_DEPLOY.md)** — one Cloud Shell command automates GCP setup, guides GWS DWD, and deploys.

**This should take under 30 minutes for anyone.**

This is how real professional developers deploy React + Node.js apps to Cloud Run in 2026: simple, reliable, with clear steps and local verification before cloud deployment.

## Prerequisites (One-time Setup - 10 minutes)

1. **Login and enable APIs:**
   ```bash
   gcloud auth login
   gcloud config set project admin-assist-492920
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com admin.googleapis.com drive.googleapis.com gmail.googleapis.com \
     calendar-json.googleapis.com chromepolicy.googleapis.com
   ```

2. **Create Service Account** (`workspace-admin-sa`) in IAM & Admin with these roles:
   - Secret Manager Secret Accessor
   - Cloud Run Invoker

3. **Create OAuth 2.0 Web Client** in APIs & Services → Credentials (Web application type)
4. **Setup Domain-wide Delegation** in Google Workspace Admin Console for the service account (use the scopes from SECURITY.md)
5. **Download the service account JSON key** as `sa-key.json` in this folder

## Step 1: Setup Secrets (5 minutes)

```bash
chmod +x setup-secrets.sh
./setup-secrets.sh admin-assist-492920
```

> **Note:** `setup-secrets.sh` applies IAM bindings automatically. For greenfield setup, use `bash scripts/bootstrap-tenant.sh` instead (see [docs/NEW_DEPLOY.md](./docs/NEW_DEPLOY.md)).

## Step 2: Deploy

**Recommended: GitHub Actions (no local Docker)**

Secrets `GCP_PROJECT_ID` and `GCP_SA_KEY` are already configured on this repo. To deploy:

1. Commit and push to `main`, **or**
2. GitHub → **Actions** → **Deploy to Cloud Run** → **Run workflow**

CI builds the Docker image on GitHub’s runner, pushes to Artifact Registry, and deploys Cloud Run — same result as `./deploy.sh`, without Docker on your Mac.

See [docs/GITHUB_ACTIONS.md](./docs/GITHUB_ACTIONS.md) for one-time setup and troubleshooting.

**Alternative: local `./deploy.sh`** (requires Docker Desktop)

```bash
chmod +x deploy.sh
./deploy.sh admin-assist-492920 us-central1
```

## What Happens

The script will:
- Validate your setup
- Build locally first (`npm run build` - more reliable than Cloud Build)
- Deploy to Cloud Run using the simple, professional Dockerfile
- Automatically set CORS_ORIGIN and update the OAuth redirect URI
- Print the service URL and exact next steps

## GitHub Actions (recommended)

Every push to `main` deploys automatically. Manual trigger: **Actions → Deploy to Cloud Run → Run workflow**.

One-time setup: [docs/GITHUB_ACTIONS.md](./docs/GITHUB_ACTIONS.md) (already done for this repo — `GCP_PROJECT_ID` + `GCP_SA_KEY` secrets).

## After Deploy

1. **Add the printed redirect URI** to your OAuth client in Google Cloud Console (exact match required)
2. **Test it:**
   ```bash
   curl -I $(gcloud run services describe workspace-admin --region us-central1 --format='value(status.url)')/health
   ```
3. Open the service URL in your browser and complete the login flow.

## Troubleshooting

**Build fails:**
- Check the Cloud Build link in the output for the exact error
- Common fix: Run the IAM commands from `setup-secrets.sh` again
- Check that your service account key JSON is valid

**OAuth login fails:**
- The redirect URI in Google Cloud Console must exactly match what the deploy script prints

**Permission errors:**
- The `workspace-admin-sa` service account needs the roles listed above and proper domain-wide delegation scopes (see SECURITY.md)

**Still not working?**
Run `./deploy.sh admin-assist-492920 us-central1` and paste the full output. This is now a simple, professional deployment that real dev teams would use.

This replaces the previous complex multi-stage Dockerfile and scattered documentation with a clean, reliable system.
