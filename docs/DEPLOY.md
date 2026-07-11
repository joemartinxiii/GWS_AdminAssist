# Deploy to Cloud Run

GWS Admin Assist runs as **one Cloud Run service** (API + built React app). Local development is separate: [LOCAL_DEV.md](./LOCAL_DEV.md).

**Paths**

| When | What to run |
|------|-------------|
| First time | Bootstrap wizard (Cloud Shell) |
| Updates | Push to `main` (GitHub Actions) **or** re-run Cloud Shell deploy |
| No CI / local Docker | `./deploy.sh` (optional) |

All of those share the same post-image steps (`scripts/deploy-from-image.sh`). Deeper reference: [DEPLOY_REFERENCE.md](./DEPLOY_REFERENCE.md). Security model and scopes: [SECURITY.md](../SECURITY.md).

---

## Prerequisites

| You need | Why |
|----------|-----|
| Workspace **Super Admin** | Domain-wide delegation in admin.google.com |
| GCP **Project Owner** (or equivalent) | Provision Cloud Run, secrets, IAM |
| Billing on the GCP project | Cloud Run + Artifact Registry |
| GitHub access (optional) | Auto-deploy on push |

---

## First deploy

Budget about **20–30 minutes**. Most of that is waiting on Cloud Build; the wizard walks you through the few browser steps.

### 1. Run the wizard (Cloud Shell)

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist && cd GWS_AdminAssist && bash scripts/bootstrap-tenant.sh
```

Press **Enter** to accept defaults, or pass flags to skip prompts:

```bash
bash scripts/bootstrap-tenant.sh \
  --domain yourcompany.com \
  --project your-gcp-project \
  --admin you@yourcompany.com
```

### 2. Complete the three guided console steps

The wizard opens the right pages and gives you copy-paste blocks:

1. **OAuth consent screen** — identity scopes only ([SECURITY.md](../SECURITY.md)).
2. **OAuth Web client** — paste Client ID and Client secret back into the wizard.
3. **Domain-wide delegation** — service account numeric Client ID + DWD scopes ([SECURITY.md](../SECURITY.md)).

### 3. After the service is live

The wizard prints your **Service URL** and pauses so you can:

1. Add `https://<service-url>/api/auth/callback` to the OAuth client’s **Authorized redirect URIs**.
2. Open the Service URL and sign in.

That is the full first-time install. Use the [go-live checklist](#go-live-checklist) before handing the app to the team.

---

## Ongoing deploys

### Option A — GitHub Actions (recommended)

One-time (if bootstrap did not already do it):

```bash
bash scripts/setup-github-ci.sh <PROJECT_ID> <GITHUB_OWNER/REPO>
```

Then every push to `main` builds and redeploys. You can also run **Actions → Deploy to Cloud Run → Run workflow**.

Secrets: `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` (Workload Identity Federation — no service-account key). Optional repo variables are listed in [DEPLOY_REFERENCE.md](./DEPLOY_REFERENCE.md#optional-production-settings).

### Option B — Cloud Shell

```bash
cd ~/GWS_AdminAssist && git pull && bash scripts/deploy-cloudshell.sh <PROJECT_ID>
```

Uses Cloud Build (no local Docker). Requires a completed bootstrap. Optional: `DWD_ADMIN_EMAIL=admin@your-domain.com` to verify delegation scopes after deploy.

### Option C — Local Docker

```bash
./deploy.sh <PROJECT_ID> us-central1
```

Same end state as A and B; needs Docker Desktop and `gcloud` auth.

---

## Go-live checklist

| # | Check |
|---|--------|
| 1 | `curl -s "$SERVICE_URL/health"` returns `"status":"ok"` |
| 2 | OAuth redirect URI is exactly `https://…/api/auth/callback` on the Web client |
| 3 | Super admin can sign in |
| 4 | Role badge is correct (Super vs Delegated view-only) |
| 5 | A simple mutation works (e.g. edit a group description) |
| 6 | Drive → External Shares → **Run scan** works |
| 7 | Security Audit → **Run audit** works |
| 8 | Optional: `GWS_PROTECTED_USERS` set for accounts that must never be deleted |
| 9 | Optional: `SIGNATURE_TEMPLATE_BUCKET` if signature templates must survive redeploys |

Logs:

```bash
gcloud run services logs read workspace-admin --region us-central1 --limit 100
```

---

## Optional production settings

Set before deploy (export in shell, or GitHub Actions **Variables**):

| Setting | Purpose |
|---------|---------|
| `GWS_PROTECTED_USERS` | Comma-separated emails that cannot be permanently deleted |
| `SIGNATURE_TEMPLATE_BUCKET` | GCS bucket so org signature templates survive redeploys |
| `DWD_ADMIN_EMAIL` | Super-admin email for post-deploy scope verification |

Full env / Secret Manager map: [DEPLOY_REFERENCE.md](./DEPLOY_REFERENCE.md#secrets-and-environment).

---

## Teardown

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id
# entire project:
bash scripts/teardown-project.sh --project your-gcp-project-id --delete-project
```

Also remove the DWD entry in admin.google.com, the OAuth Web client if unused, and GitHub Actions secrets. Details: [DEPLOY_REFERENCE.md](./DEPLOY_REFERENCE.md#teardown).

---

## If CI fails with “App secrets not found” / Secret Manager

The deploy SA needs **`roles/secretmanager.viewer`** (metadata) plus **`secretVersionAdder`** (redirect URI updates). Grant and re-run:

```bash
bash scripts/setup-github-ci.sh <PROJECT_ID> <GITHUB_OWNER/REPO>
```

Then re-run **Actions → Deploy to Cloud Run**. Details: [DEPLOY_REFERENCE.md#troubleshooting](./DEPLOY_REFERENCE.md#troubleshooting).

---

## More detail

| Topic | Doc |
|-------|-----|
| Wizard flags, secrets map, infra | [DEPLOY_REFERENCE.md](./DEPLOY_REFERENCE.md) |
| OAuth, DWD scopes, security model | [SECURITY.md](../SECURITY.md) |
| Security Audit | [GWS_HARDENING.md](../GWS_HARDENING.md) |
| Live / E2E testing | [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md) |
| All other failures | [DEPLOY_REFERENCE.md#troubleshooting](./DEPLOY_REFERENCE.md#troubleshooting) |
