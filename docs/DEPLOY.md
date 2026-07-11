# Deploy to Cloud Run

Google Workspace Admin Assist runs as a **single Cloud Run service** (Express serves the API and the built React app). This is the **primary and recommended** way to run the app. For local development, see [LOCAL_DEV.md](./LOCAL_DEV.md).

There are two deploy paths:

1. **Bootstrap wizard** (first-time / greenfield) — one command in Cloud Shell provisions everything and deploys.
2. **GitHub Actions** (ongoing) — every push to `main` builds and redeploys.

A local-Docker fallback (`./deploy.sh`) exists but is not required. **All three paths share the same post-image deploy steps** (`scripts/lib/deploy-cloud-run.sh` via `scripts/deploy-from-image.sh`): OAuth redirect pin, CORS, scan/audit bucket + job, health check, and DWD scope reminder.

---

## What you actually do (start to finish)

One command does all the automation. Your only hands-on work is three console tasks the wizard walks you through with clickable links and copy-paste blocks. Total wall-clock time is ~20–30 min, most of it unattended (Cloud Build takes ~5 min).

1. **Run one command** in Cloud Shell (below). Answer a few prompts — press Enter to accept the smart defaults.
2. **OAuth consent screen** *(browser, guided)* — paste the read-only scopes, Save.
3. **Create an OAuth Web client** *(browser, guided)* — paste the placeholder redirect URI, then paste the generated **Client ID** and **Client secret** back into the wizard.
4. **Domain-wide delegation** *(admin.google.com, guided)* — paste the service account's **numeric client ID** and the DWD scopes, Save.
5. **Wait** — the wizard verifies delegation, then builds and deploys to Cloud Run.
6. **Register the real redirect URI** *(browser, guided)* — after deploy, the wizard prints your live Cloud Run URL and pauses; add `https://<your-url>/api/auth/callback` to the OAuth Web client's **Authorized redirect URIs**, Save.

Then open the printed **Service URL** and sign in. That's the whole job.

> **Why step 6 is separate:** the redirect URI must contain the Cloud Run URL, which doesn't exist until the first deploy. The wizard stores it in Secret Manager automatically, but Google requires you to register it on the OAuth client by hand — so the wizard pauses and tells you exactly what to paste.

> **Seeing red text / warnings during the run?** That's expected. See [Expected output & harmless warnings](#expected-output--harmless-warnings) — none of it means the deploy failed.

---

## Prerequisites

| Requirement | Purpose |
|-------------|---------|
| Google Workspace **Super Admin** | Signs in to admin.google.com for domain-wide delegation (DWD) |
| GCP **Project Owner** (or equivalent) | Runs the wizard / provisions resources |
| Billing enabled on the project (or a billing account ID) | Cloud Run + Artifact Registry |
| GitHub repo access (optional) | For CI secrets via the `gh` CLI |

---

## 1. First-time deploy — bootstrap wizard (primary)

The wizard automates GCP provisioning, guides the manual OAuth + DWD console steps with deep links, validates delegation with a live API call, and deploys. Budget ~20–30 min (10–15 min is unavoidable manual console work).

Open Cloud Shell and run this **single command** — no editing required. The wizard prompts for everything with smart defaults (your signed-in account becomes the admin, the domain is derived from it, it offers to create a new project, and it auto-selects your billing account):

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist && cd GWS_AdminAssist && bash scripts/bootstrap-tenant.sh
```

Just press **Enter** to accept each `[default]`, or type a new value. That's it.

**Prefer to pre-fill values and skip the prompts?** Any flag you pass skips its question:

```bash
bash scripts/bootstrap-tenant.sh \
  --domain yourcompany.com \
  --project your-gcp-project \
  --admin you@yourcompany.com
```

Create a brand-new GCP project non-interactively:

```bash
bash scripts/bootstrap-tenant.sh \
  --create-project \
  --billing-account 012345-678901-ABCDEF \
  --domain yourcompany.com \
  --project workspace-admin-prod \
  --admin you@yourcompany.com
```

### What the wizard does vs what you click

| Step | Automated? | Where |
|------|------------|-------|
| Create project | Yes | Offered in the wizard (or `--create-project`) |
| Link billing | Yes | Auto-detects your billing account (or `--billing-account`) |
| Enable APIs | Yes | `gcloud services enable` |
| `workspace-admin-sa` (keyless: tokenCreator on itself, no key) | Yes | IAM |
| `github-deploy-sa` + Workload Identity Federation for CI | Optional | IAM + WIF |
| Secret Manager secrets + IAM bindings | Yes | — |
| Artifact Registry | Yes | — |
| OAuth consent screen + Web client | **No** | GCP Console (wizard opens links + copy-paste scopes) |
| Domain-wide delegation | **No** | admin.google.com (wizard prints the SA `client_id` + scopes) |
| First Cloud Run deploy | Yes | Cloud Build via `deploy-cloudshell.sh` |
| GitHub Actions secrets (WIF) | Optional | `setup-github-ci.sh` / `gh secret set` |
| DWD smoke test + `/health` check | Best-effort | Keyless: mints a delegated token, lists 1 user |

### Wizard options

```
--create-project          Create the GCP project
--billing-account ID      Link billing
--organization ID         Org for a new project
--folder ID               Folder for a new project
--region REGION           Default: us-central1
--skip-cloudshell         Skip the immediate deploy
--skip-github             Skip GitHub CI (WIF) setup
--non-interactive         Requires CLIENT_ID, CLIENT_SECRET, --billing-account via env/flags
--github-repo OWNER/REPO  For WIF + gh secret set
```

### Manual console steps (the wizard guides these)

1. **OAuth consent screen** — add the read-only consent scopes (copy-paste block in [SECURITY.md](../SECURITY.md)).
2. **OAuth 2.0 Web client** — create it with the placeholder redirect URI. **After the first deploy** the wizard pauses and has you add the real `https://<cloud-run-url>/api/auth/callback` to the client's Authorized redirect URIs. (The wizard writes this URI into Secret Manager for the app automatically, but Google requires you to register it on the OAuth client manually.)
3. **Domain-wide delegation** — in admin.google.com → Security → API controls, add the service account's numeric `client_id` with the DWD scopes (copy-paste block in [SECURITY.md](../SECURITY.md)).

> **Scopes are single-source.** DWD + OAuth-consent scope strings live in [`scripts/lib/scopes.sh`](../scripts/lib/scopes.sh) and must match [`backend/src/config/google.config.ts`](../backend/src/config/google.config.ts). Verify with `npm run check:scopes`.

---

## 2. Ongoing deploys

Once the app is live you keep it up to date in one of two ways: a **single manual command** (no CI required) or **GitHub Actions** (auto-deploy on push). Both end in the **same** `deploy-from-image.sh` steps.

### 2a. Manual update from GitHub (single command)

If you don't use CI (or just want to push an update right now), pull the latest code and run the deploy script from Cloud Shell. This builds via Cloud Build (no local Docker) and redeploys the service **and** the scan job:

```bash
cd ~/GWS_AdminAssist && git pull && bash scripts/deploy-cloudshell.sh <PROJECT_ID>
```

First time on a fresh Cloud Shell? Clone first:

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist && cd GWS_AdminAssist && bash scripts/deploy-cloudshell.sh <PROJECT_ID>
```

- Requires the tenant to already be bootstrapped (`scripts/bootstrap-tenant.sh` created the secrets + runtime SA). The script refuses to run otherwise.
- `<PROJECT_ID>` is optional if `gcloud config set project` is already pointed at the right project; a second arg overrides the region (default `us-central1`).
- Re-run it any time you `git pull` new code. It's idempotent.
- **Enables every required API on each run** (`gcloud services enable "${GCP_APIS[@]}"` from [`scripts/lib/scopes.sh`](../scripts/lib/scopes.sh)) — a no-op when they're already on.
- **Pins the OAuth redirect URI secret version** and updates CORS, scan job, and health-checks `/health`.
- **Surfaces the DWD scopes** at the end of every deploy. Add `DWD_ADMIN_EMAIL=<super-admin@domain>` to also live-verify the full scope set.

### 2b. GitHub Actions (auto-deploy on push) — recommended

After a one-time setup, every push to `main` builds on GitHub's runner and redeploys. Manual trigger: **Actions → Deploy to Cloud Run → Run workflow**.

#### One-time CI setup (keyless, via Workload Identity Federation)

This project is **keyless by default** — runtime DWD uses no SA key, and CI uses **Workload Identity Federation (WIF)** so GitHub's OIDC token impersonates a deploy SA with no key to create, store, or rotate.

One command provisions the deploy SA, the WIF pool + GitHub provider (locked to your repo owner), the IAM bindings, and prints (or sets) the three GitHub secrets:

```bash
bash scripts/setup-github-ci.sh <PROJECT_ID> <GITHUB_OWNER/REPO>
# e.g. bash scripts/setup-github-ci.sh my-proj joemartinxiii/GWS_AdminAssist
```

If the `gh` CLI is authenticated it offers to set the secrets and trigger the workflow for you; otherwise add them under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | your GCP project ID |
| `GCP_WIF_PROVIDER` | `projects/<num>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOY_SA` | `github-deploy-sa@<project>.iam.gserviceaccount.com` |

**Optional repository variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Purpose |
|----------|---------|
| `GWS_PROTECTED_USERS` | Comma-separated emails that cannot be permanently deleted (e.g. primary admin + backup) |
| `SIGNATURE_TEMPLATE_BUCKET` | GCS bucket for durable org email signature templates |
| `DWD_ADMIN_EMAIL` | Super-admin email used to live-verify DWD scopes after deploy |

> **Fork whose org allows SA keys?** The workflow also supports a key fallback: skip `GCP_WIF_PROVIDER` and instead set `GCP_SA_KEY` to a deploy-SA key JSON (plus `GCP_PROJECT_ID`). Prefer WIF.

> CI only needs **deploy** permissions. The Cloud Run **runtime** still uses `workspace-admin-sa`, never the deploy SA.

### What every deploy path does (after the image exists)

1. `gcloud run deploy workspace-admin` with secrets + scan env (`--no-invoker-iam-check`)
2. Writes the real redirect URI to Secret Manager and **pins that version** on the service (avoids stuck `PLACEHOLDER`)
3. Sets `CORS_ORIGIN` to the live service URL
4. Ensures the scan/audit GCS bucket + IAM + Cloud Run Job `workspace-admin-scan`
5. Optional signature-template bucket when `SIGNATURE_TEMPLATE_BUCKET` is set
6. Post-deploy `/health` check
7. Prints DWD scopes + SA Client ID (and verifies if `DWD_ADMIN_EMAIL` is set)

### Local-Docker alternative

If you cannot use CI and want to deploy from your machine (requires Docker Desktop):

```bash
./deploy.sh your-gcp-project-id us-central1
```

Same shared post-image steps as Cloud Shell and GitHub Actions.

---

## Secrets & environment mapping

Runtime configuration comes from Secret Manager, injected by Cloud Run. See [SECURITY.md](../SECURITY.md#environment-variables) for the full list. Key mappings:

- `GOOGLE_CLIENT_ID` ← `oauth-client-id:latest`
- `GOOGLE_CLIENT_SECRET` ← `oauth-client-secret:latest`
- `GOOGLE_REDIRECT_URI` ← `oauth-redirect-uri:<pinned version after each deploy>`
- `JWT_SECRET` ← `app-jwt-secret:latest`
- `WORKSPACE_DOMAIN` ← `app-workspace-domain:latest` (primary domain)
- `GWS_ALLOWED_DOMAINS` ← `app-allowed-domains:latest` (primary + secondary/contractor domains, comma-separated)

**Multi-domain:** bootstrap asks for optional extra domains and merges the admin’s email domain into the allowlist. Update `app-allowed-domains` in Secret Manager if you add a domain later, then redeploy. Domain-wide delegation is **not** repeated per domain.

- `GCP_PROJECT_ID`, `SERVICE_ACCOUNT_EMAIL` set as literal env vars
- `SCAN_BUCKET`, `SCAN_JOB_NAME`, `SCAN_REGION` set as literal env vars (Drive external scan **and** Security Audit last-run/waivers)
- **Keyless domain-wide delegation** — no service-account key is created or stored. Cloud Run runs as the runtime SA, which signs its own delegation tokens via the IAM Credentials API (`signJwt`); the SA holds `roles/iam.serviceAccountTokenCreator` on itself
- **`GWS_PROTECTED_USERS`** *(optional)*: comma-separated emails that cannot be permanently deleted. Empty by default — set this for your primary admin / break-glass accounts. Export before deploy or set the GitHub Actions variable.
- **`SIGNATURE_TEMPLATE_BUCKET`** *(optional)*: GCS bucket for durable org signature templates. Without it, templates use ephemeral local disk and are **lost on redeploy**. Export before deploy or set the GitHub Actions variable.

---

## External-sharing scan (on-demand Cloud Run Job)

The **External Shares** / **Public Links** tabs on the Drive page audit *every* user's My Drive plus all Shared Drives. The deploy provisions:

| Resource | Name | Purpose |
| --- | --- | --- |
| Cloud Run **Job** | `workspace-admin-scan` | Runs `node backend/dist/jobs/externalScan.js` from the **same image**. Triggered on demand by the web app. |
| GCS bucket | `<project>-workspace-admin-scans` | Drive scan reports **and** Security Audit state (`security-audit/latest.json`, `security-audit/waivers.json`). |

**Usage:** Drive → *External Shares* (or *Public Links*) → **Run scan** (super admin only). Results are cached; re-scan as needed.

**Cost:** idle cost is ~$0. Each scan bills only for the minutes it runs.

---

## Security Audit (Cloud Identity Policy API)

The **Security Audit** page (`/audit`) reads org policies from the **Cloud Identity Policy API**. Deploy enables:

- APIs: `cloudidentity.googleapis.com`, `chromepolicy.googleapis.com` (via `GCP_APIS`)
- DWD scope: `https://www.googleapis.com/auth/cloud-identity.policies.readonly` (in the SECURITY.md copy-paste block)
- Durable last-run + waivers in the **same** `SCAN_BUCKET` under `security-audit/`

Run the audit while signed in as a Workspace **super admin**. If the API or scope is missing, affected checks show **Manual** instead of failing the whole page.

> **APIs are never a manual step.** Re-running deploy enables any newly added API from `scopes.sh`.
>
> **DWD is the only always-manual step.** Every deploy prints the scope string + SA Client ID + [admin console link](https://admin.google.com/ac/owl/domainwidedelegation). Verify with:
> ```bash
> DWD_ADMIN_EMAIL=admin@your-domain.com bash scripts/deploy-cloudshell.sh <PROJECT_ID>
> ```

---

## Go-live checklist (hand to a coworker)

After first deploy (or after a major change), walk this list:

| # | Check | How |
|---|--------|-----|
| 1 | `/health` returns OK | `curl -s "$SERVICE_URL/health"` → `"status":"ok"` |
| 2 | OAuth redirect registered | Exact `https://…/api/auth/callback` on the OAuth Web client |
| 3 | Super admin can sign in | Open Service URL → Google → land on app |
| 4 | Role badge correct | Super Admin (green) vs Delegated (orange, view-only) |
| 5 | Mutation works | e.g. edit a non-critical group description or user phone |
| 6 | Drive scan job exists | Drive → External Shares → **Run scan** (or check Cloud Run Jobs) |
| 7 | Security Audit runs | Security Audit → **Run audit** (super admin) |
| 8 | DWD scopes current | Deploy log prints Client ID + scopes; paste if you added any |
| 9 | Protected deletes (optional) | Set `GWS_PROTECTED_USERS` so critical accounts cannot be deleted |
| 10 | Signature templates (optional) | Set `SIGNATURE_TEMPLATE_BUCKET` if templates must survive redeploys |

Logs:

```bash
gcloud run services logs read workspace-admin --region us-central1 --limit 100
```

---

## Verification

```bash
# Health
curl -s "$(gcloud run services describe workspace-admin --region us-central1 --format='value(status.url)')/health"

# DWD (keyless — needs ADC with tokenCreator on the runtime SA)
npx tsx scripts/verify-dwd.ts workspace-admin-sa@PROJECT.iam.gserviceaccount.com you@yourcompany.com

# Read-only live tests (optional; requires .env.test — see STAGING_TEST_SETUP.md)
npm run bootstrap:test
npm run test:live:read
```

After deploy, add the printed redirect URI to your OAuth Web client if the URL changed.

---

## Teardown / rebuild

Remove the app from GCP (Cloud Run service, scan job + bucket, secrets, service accounts, Artifact Registry):

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id
```

Delete the entire GCP project:

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id --delete-project
```

Manual cleanup (not automated): remove the DWD entry for the old SA `client_id` in [admin.google.com → DWD](https://admin.google.com/ac/owl/domainwidedelegation), delete/clear the OAuth Web client in GCP Console, and clear GitHub secrets (`GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`; and `GCP_SA_KEY` only if used). Then re-run the bootstrap wizard.

---

## Expected output & harmless warnings

During a normal, successful deploy you will see warnings and red/yellow text. **None of these mean the deploy failed.**

| What you see | Why | Action |
|--------------|-----|--------|
| `Regional Access Boundary HTTP request failed…` | Benign `google-auth` lookup for an optional org feature | Ignore (filtered by our scripts) |
| `[environment: untagged]…` | `gcloud` nag about optional project tags | Ignore |
| npm deprecation / vulnerability notices in Docker build | Transitive deps; build still succeeds | Ignore |
| `Setting IAM policy failed … allUsers … run.invoker` | Org policy blocks `allUsers`; service uses `--no-invoker-iam-check` | Ignore — access is app-layer (see SECURITY.md) |
| Two Service URLs (project-number and hash) | Both point at the same service | Use the URL printed at the end |

**Real** failures stop the run with `ERROR:` or a non-zero status. If the wizard prints a Service URL with `/health` OK, the deploy worked.

To see unfiltered `gcloud` output: `GWS_SHOW_GCLOUD_NOISE=1`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `unauthorized_client` on DWD test | Use the SA's numeric `client_id`, not the OAuth web client ID. Scopes must match `scopes.sh`. Wait 1–5 min after saving. |
| SA key creation blocked | Expected on secure orgs — use WIF: `scripts/setup-github-ci.sh` |
| CI: `Permission denied` / no auth | Set `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`. Re-run `scripts/setup-github-ci.sh`. |
| `400: redirect_uri_mismatch` | Confirm secret: `gcloud secrets versions access latest --secret=oauth-redirect-uri` equals `https://<url>/api/auth/callback` and is listed on the OAuth client. Redeploy if stuck on `PLACEHOLDER`. |
| OAuth login fails | Redirect URI must match Cloud Run URL + `/api/auth/callback` exactly. |
| Billing not enabled | Pass `--billing-account` or link billing in Console. |
| Permission denied on deploy | Deploy SA needs `run.admin`, `artifactregistry.writer`, `secretVersionAdder`, `serviceUsageAdmin`, and `actAs` on runtime SA. |
| Scope drift | `npm run check:scopes` |
| Public access blocked | Service uses `--no-invoker-iam-check`; app enforces auth (SECURITY.md). |
| Deleted user should have been blocked | Set `GWS_PROTECTED_USERS` and redeploy. |
| Signature template lost after redeploy | Set `SIGNATURE_TEMPLATE_BUCKET` and redeploy. |
