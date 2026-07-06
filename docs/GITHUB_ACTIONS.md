# GitHub Actions — Deploy to Cloud Run

**This is the recommended way to deploy.** Push to `main` or run the workflow manually — Docker runs on GitHub’s runner, not your laptop.

Local `./deploy.sh` is optional and requires Docker Desktop.

## One-time setup (~10 minutes)

### 1. Create a deploy service account (GCP)

Use a dedicated account for CI, not your personal user:

```bash
export PROJECT_ID=admin-assist-492920   # your GCP project ID

gcloud iam service-accounts create github-deploy-sa \
  --display-name="GitHub Actions deploy" \
  --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud iam service-accounts keys create github-deploy-key.json \
  --iam-account="github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

**Never commit `github-deploy-key.json`.** Delete the local file after adding it to GitHub Secrets.

If your org blocks SA key creation, use [Workload Identity Federation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation) instead of `GCP_SA_KEY`.

### 2. Add GitHub repository secrets

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|--------|
| `GCP_PROJECT_ID` | e.g. `admin-assist-492920` |
| `GCP_SA_KEY` | Full contents of `github-deploy-key.json` |

### 3. Prerequisites (same as local deploy)

Before the first CI deploy succeeds, you must already have run locally once:

- `./setup-secrets.sh` — OAuth, JWT, workspace domain, service account key in Secret Manager
- Domain-wide delegation configured in Google Workspace Admin
- OAuth Web client redirect URI (updated automatically post-deploy; register in Console if URL changes)

The Cloud Run runtime still uses **`workspace-admin-sa`** (not `github-deploy-sa`). CI only needs permission to deploy and update secrets/env.

## How it works

On push to `main` or manual **Run workflow**:

1. `npm ci` → lint, type-check, security tests
2. Docker build (`linux/amd64`) → Artifact Registry `workspace-admin-repo`
3. `gcloud run deploy workspace-admin` with `--no-invoker-iam-check` (matches `deploy.sh`)
4. Updates `CORS_ORIGIN` and `oauth-redirect-uri` secret

## Manual deploy (optional — requires local Docker)

Only if you cannot use GitHub Actions:

```bash
./deploy.sh admin-assist-492920 us-central1
```

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `GCP_PROJECT_ID` / `GCP_SA_KEY` missing | Add secrets in GitHub repo settings |
| Permission denied on deploy | Grant `roles/run.admin` and `roles/iam.serviceAccountUser` to `github-deploy-sa` |
| Docker push denied | Grant `roles/artifactregistry.writer`; ensure `artifactregistry.googleapis.com` is enabled |
| OAuth login fails after deploy | Add printed redirect URI to OAuth Web client in Cloud Console |
| Workflow fails on lint/tests | Fix locally, commit, push again |

View runs: **GitHub → Actions → Deploy to Cloud Run**.

## Live staging tests (manual)

Workflow: **Test Staging (Live Read-Only)** — trigger via **Actions → Test Staging → Run workflow**.

Required repository secrets (in addition to deploy secrets):

| Secret | Purpose |
|--------|---------|
| `TEST_SUPER_ADMIN_EMAIL` | Workspace super admin for live API tests |
| `TEST_JWT_SECRET` | Same JWT secret as Cloud Run (`app-jwt-secret`) |
| `TEST_WORKSPACE_DOMAIN` | Primary domain |
| `TEST_GWS_ALLOWED_DOMAINS` | Optional; defaults to workspace domain |
| `TEST_GCP_SA_KEY` | Service account JSON (DWD) for live Google API calls |
| `TEST_GOOGLE_CLIENT_ID` / `TEST_GOOGLE_CLIENT_SECRET` | OAuth web client (backend startup) |

Runs read-only live API tests (`npm run test:live:read`) and E2E UI smoke (`npm run test:e2e:read`). Does not deploy or run mutating tests.

