# Google Workspace Admin Assist — Deployment

**Simple Cloud Run Deployment (<30 minutes for help desk)**

The deployment is now **one-command simple**. No more asking for redirect URIs or CORS origins before you have the Cloud Run URL. Scripts use **placeholders first**, then automatically update secrets with the real URL after the first deploy. Uses **Artifact Registry** (modern, not legacy gcr.io), robust error checking, and clear output.

Cloud Run injects `PORT=8080`. The app validates required env vars/secrets before starting (`backend/src/utils/env.validation.ts`). Frontend is statically served from the backend in production (`backend/src/index.ts:117`).

## Prerequisites (prepare once, ~10 mins)

See **[SECURITY.md](SECURITY.md)** (updated) for full SA creation, domain-wide delegation, OAuth consent screen, and scopes.

1. `gcloud auth login && gcloud config set project YOUR_PROJECT_ID`
2. Enable APIs (copy-paste):
   ```bash
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com admin.googleapis.com drive.googleapis.com gmail.googleapis.com \
     calendar-json.googleapis.com
   ```
3. **Service account** `workspace-admin-sa@${PROJECT_ID}.iam.gserviceaccount.com`:
   - Roles: `roles/secretmanager.secretAccessor`, `roles/run.invoker` (plus Workspace scopes via domain-wide delegation)
   - Download JSON key to `./sa-key.json`
4. **OAuth 2.0 Web Client** (GCP Console > Credentials):
   - Note your Client ID + Secret
   - Add localhost redirects now; production `/api/auth/callback` added automatically after first deploy
5. Prepare values:
   - Strong `JWT_SECRET` (e.g. `openssl rand -base64 32`)
   - `WORKSPACE_DOMAIN=yourcompany.com`
   - Optional: `GWS_ALLOWED_DOMAINS=yourcompany.com,subsidiary.com`

## 1. Setup Secrets (non-interactive preferred)

```bash
# Set env vars for fully non-interactive (recommended for help desk). Script falls back to prompts only for missing values.
export PROJECT_ID=your-project-id
export CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
export CLIENT_SECRET=your-client-secret
export JWT_SECRET=your-32-char-random-secret-here
export WORKSPACE_DOMAIN=yourcompany.com
export SA_KEY_PATH=./sa-key.json
# Optional: export REDIRECT_URI="https://workspace-admin-XXXX.a.run.app/api/auth/callback"

chmod +x setup-secrets.sh
./setup-secrets.sh
```

**What it does** (updated `setup-secrets.sh`):
- Creates/updates **one Secret Manager secret per value**: `oauth-client-id`, `oauth-client-secret`, `oauth-redirect-uri`, `app-jwt-secret`, `app-workspace-domain`, `app-allowed-domains`, `service-account-key`.
- Uses **placeholder** for redirect URI/CORS if not provided (`https://*.run.app/api/auth/callback`).
- Loads SA key JSON directly.
- Prints **exact** IAM grant commands for `workspace-admin-sa` (run them once).
- Supports migration from old combined secrets automatically.
- `GCP_PROJECT_ID` and `SERVICE_ACCOUNT_SECRET_NAME` are handled in deploy (not secrets).

## 2. Deploy (single command)

```bash
chmod +x deploy.sh
./deploy.sh $PROJECT_ID us-central1
```

**What the updated `deploy.sh` does**:
- Validates prerequisites and secrets exist.
- Builds using `Dockerfile` (multi-stage workspace build: frontend Vite + backend TypeScript → production Node image).
- Pushes to **Artifact Registry** (`us-central1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/workspace-admin`).
- Deploys to Cloud Run service `workspace-admin` with optimal settings (`--min-instances=0`, 1 vCPU/1Gi, timeout 300s, cpu-boost).
- Wires all `--set-secrets` and `--set-env-vars` (no `PORT`).
- **Automatically**:
  - Detects existing service URL or fetches new one.
  - Updates `CORS_ORIGIN` and adds new version to `oauth-redirect-uri` secret with real production URL.
  - Handles first-deploy vs redeploy gracefully.
- Prints final URL, verification commands, and any follow-up IAM steps.

**Example successful output**:
```
✅ Secrets validated. Building with Dockerfile...
✅ Pushed to Artifact Registry.
✅ Deployed to Cloud Run.
Service URL: https://workspace-admin-abc123.a.run.app
✅ Updated CORS_ORIGIN and redirect URI secret versions.
Next steps: Verify OAuth console, test /health, run login flow.
```

## Verify & Test

```bash
URL=$(gcloud run services describe workspace-admin --region us-central1 --format='value(status.url)')
echo "URL: $URL"
curl -I $URL/health
# Should show "Environment validation passed" in logs
```

- Open the URL in browser.
- Test login (OAuth flow now uses updated redirect).
- Check Cloud Run Logs for any issues.
- Add production callback URL to OAuth client in GCP Console if prompted.

## Post-Deploy / Updates

- Redeploy after code changes or secret updates: just run `./deploy.sh $PROJECT_ID us-central1` again (it preserves URL logic).
- For custom domain: Configure in Cloud Run, update CORS/redirect secrets, redeploy.
- CI/CD: See updated `.github/workflows/deploy.yml` (uses same logic, prefers Workload Identity Federation over long-lived keys).

## Troubleshooting (common issues only)

- **Secret/IAM errors**: Re-run the exact IAM commands printed by `setup-secrets.sh`. Check service account has correct roles.
- **"Failed to listen on PORT=8080" or validation failed**: Inspect Cloud Run Logs (most common: missing secret access or bad SA key JSON). Fix IAM, redeploy.
- **OAuth redirect mismatch**: Ensure exact match in Google Console + secret version. Script updates it automatically on deploy.
- **Build fails**: `npm install` at root (workspace), Docker daemon running. See `Dockerfile`.
- **Public access / 403**: Run the `add-iam-policy-binding` for `allUsers` / `roles/run.invoker` (shown by script; org policies may require it post-deploy).
- **Type conflict on GCP_PROJECT_ID**: `gcloud run services delete workspace-admin --region us-central1 --quiet && ./deploy.sh ...`
- Logs: Always check Cloud Run > Logs tab first. `/health` endpoint includes config status.

**Updated supporting files**: `service.yaml` (declarative alternative to cloud-run.yaml), `Dockerfile` (cleaned comments), GitHub workflow (Artifact Registry + better auth), `SECURITY.md` (streamlined). Scripts now use `set -euo pipefail`, clear logging, and handle the "don't have URL yet" problem via placeholders + post-deploy update.

This meets the goal: hand the repo + this doc to help desk; they run 2-3 commands after preparing values. Based on 2026 Cloud Run best practices (`--source`, Artifact Registry, Secret Manager best practices for versioned injection).

See also [QUICK_START_UI.md](QUICK_START_UI.md) for local/demo and [GWS_HARDENING.md](GWS_HARDENING.md).
