# Deploy to Cloud Run

Google Workspace Admin Assist runs as a **single Cloud Run service** (Express serves the API and the built React app). This is the **primary and recommended** way to run the app. For local development, see [LOCAL_DEV.md](./LOCAL_DEV.md).

There are two deploy paths:

1. **Bootstrap wizard** (first-time / greenfield) — one command in Cloud Shell provisions everything and deploys.
2. **GitHub Actions** (ongoing) — every push to `main` builds and redeploys.

A local-Docker fallback (`deploy.sh`) exists but is not required.

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
| `github-deploy-sa` (key for optional CI; skipped if org blocks keys) | Optional | IAM |
| Secret Manager secrets + IAM bindings | Yes | — |
| Artifact Registry | Yes | — |
| OAuth consent screen + Web client | **No** | GCP Console (wizard opens links + copy-paste scopes) |
| Domain-wide delegation | **No** | admin.google.com (wizard prints the SA `client_id` + scopes) |
| First Cloud Run deploy | Yes | Cloud Build via `deploy-cloudshell.sh` |
| GitHub Actions secrets | Optional | `gh secret set` or printed instructions |
| DWD smoke test + `/health` check | Best-effort | Keyless: mints a delegated token, lists 1 user |

### Wizard options

```
--create-project          Create the GCP project
--billing-account ID      Link billing
--organization ID         Org for a new project
--folder ID               Folder for a new project
--region REGION           Default: us-central1
--skip-cloudshell         Skip the immediate deploy
--skip-github             Skip GitHub secret setup
--non-interactive         Requires CLIENT_ID, CLIENT_SECRET, --billing-account via env/flags
--github-repo OWNER/REPO  For `gh secret set`
```

### Manual console steps (the wizard guides these)

1. **OAuth consent screen** — add the read-only consent scopes (copy-paste block in [SECURITY.md](../SECURITY.md)).
2. **OAuth 2.0 Web client** — create it with the placeholder redirect URI. **After the first deploy** the wizard pauses and has you add the real `https://<cloud-run-url>/api/auth/callback` to the client's Authorized redirect URIs. (The wizard writes this URI into Secret Manager for the app automatically, but Google requires you to register it on the OAuth client manually.)
3. **Domain-wide delegation** — in admin.google.com → Security → API controls, add the service account's numeric `client_id` with the DWD scopes (copy-paste block in [SECURITY.md](../SECURITY.md)).

> **Scopes are single-source.** DWD + OAuth-consent scope strings live in [`scripts/lib/scopes.sh`](../scripts/lib/scopes.sh) and must match [`backend/src/config/google.config.ts`](../backend/src/config/google.config.ts). Verify with `npm run check:scopes`.

---

## 2. Ongoing deploys — GitHub Actions (recommended)

After the first setup, every push to `main` deploys automatically (Docker builds on GitHub's runner — no local Docker). Manual trigger: **Actions → Deploy to Cloud Run → Run workflow**.

### One-time CI setup

Create a dedicated deploy service account and grant it deploy permissions:

```bash
export PROJECT_ID=your-gcp-project-id

gcloud iam service-accounts create github-deploy-sa \
  --display-name="GitHub Actions deploy" --project="$PROJECT_ID"

for ROLE in roles/run.admin roles/artifactregistry.writer \
            roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$ROLE"
done

gcloud iam service-accounts keys create github-deploy-key.json \
  --iam-account="github-deploy-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

Add these **GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | your GCP project ID |
| `GCP_SA_KEY` | full contents of `github-deploy-key.json` |

**Never commit `github-deploy-key.json`** — delete it locally after adding it to GitHub. If your org blocks SA key creation (`iam.disableServiceAccountKeyCreation`), use [Workload Identity Federation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation) instead of `GCP_SA_KEY`.

> CI only needs deploy permissions. The Cloud Run **runtime** still uses `workspace-admin-sa`, not `github-deploy-sa`.

### What the workflow does

1. `npm ci` → lint, type-check, security tests
2. Docker build (`linux/amd64`) → Artifact Registry `workspace-admin-repo`
3. `gcloud run deploy workspace-admin` (with `--no-invoker-iam-check`)
4. Updates `CORS_ORIGIN` and the `oauth-redirect-uri` secret
5. Post-deploy `/health` smoke check

### Local-Docker alternative

If you cannot use CI and want to deploy from your machine (requires Docker Desktop):

```bash
./deploy.sh your-gcp-project-id us-central1
```

---

## Secrets & environment mapping

Runtime configuration comes from Secret Manager, injected by Cloud Run. See [SECURITY.md](../SECURITY.md#environment-variables) for the full list. Key mappings (in `scripts/deploy-cloudshell.sh` and `.github/workflows/deploy.yml`):

- `GOOGLE_CLIENT_ID` ← `oauth-client-id:latest`
- `GOOGLE_CLIENT_SECRET` ← `oauth-client-secret:latest`
- `GOOGLE_REDIRECT_URI` ← `oauth-redirect-uri:latest`
- `JWT_SECRET` ← `app-jwt-secret:latest`
- `WORKSPACE_DOMAIN` ← `app-workspace-domain:latest`
- `GWS_ALLOWED_DOMAINS` ← `app-allowed-domains:latest`
- `GCP_PROJECT_ID`, `SERVICE_ACCOUNT_EMAIL` set as literal env vars
- **Keyless domain-wide delegation** — no service-account key is created or stored. Cloud Run runs as the runtime SA, which signs its own delegation tokens via the IAM Credentials API (`signJwt`); the SA holds `roles/iam.serviceAccountTokenCreator` on itself
- **Optional:** export `SIGNATURE_TEMPLATE_BUCKET=<bucket>` before deploying to persist the org signature template in GCS (survives redeploys). The deploy script creates the bucket and grants the runtime SA `roles/storage.objectAdmin`. Without it, the template uses ephemeral local disk.

---

## Verification

```bash
# Health
curl -s "$(gcloud run services describe workspace-admin --region us-central1 --format='value(status.url)')/health"

# DWD only (if troubleshooting)
npx tsx scripts/verify-dwd.ts /path/to/sa-key.json you@yourcompany.com

# Read-only live tests (optional; requires .env.test — see STAGING_TEST_SETUP.md)
npm run bootstrap:test
npm run test:live:read
```

After deploy, add the printed redirect URI to your OAuth Web client if the URL changed.

---

## Teardown / rebuild

Remove the app from GCP (Cloud Run service, 7 secrets, both service accounts, Artifact Registry repo):

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id
```

Delete the entire GCP project (true greenfield; deletion is async — wait a few minutes before reusing the ID):

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id --delete-project
```

Delete only the Cloud Run service:

```bash
gcloud run services delete workspace-admin --region us-central1 --quiet
```

Manual cleanup (not automated): remove the DWD entry for the old SA `client_id` in [admin.google.com → DWD](https://admin.google.com/ac/owl/domainwidedelegation), delete/clear the OAuth Web client in GCP Console, and clear the `GCP_PROJECT_ID` / `GCP_SA_KEY` GitHub secrets. Then re-run the bootstrap wizard.

---

## Expected output & harmless warnings

During a normal, successful deploy you will see warnings and red/yellow text. **None of these mean the deploy failed.** Here is what's expected and why it's safe:

| What you see | Why | Action |
|--------------|-----|--------|
| `Regional Access Boundary HTTP request failed after retries: … Account not found for email: …` | A benign `google-auth` library check for an optional org feature (trust boundary) that your org hasn't enabled. It's logged as a warning but the command still succeeds. Google is downgrading it to DEBUG in newer releases. | Ignore. Our scripts filter it automatically; it only shows if you run raw `gcloud` commands by hand. |
| `[environment: untagged] Read more to tag: g.co/cloud/project-env-tag.` | A `gcloud` nag about optionally tagging your project's environment. | Ignore. Filtered by our scripts. |
| npm `deprecated` / `EBADENGINE` / `N vulnerabilities` / funding / "New major version of npm" notices during the Docker build | Standard npm chatter from transitive dependencies. They don't affect the built image. | Ignore. Quieted in the Dockerfile (Node 20 base + `NPM_CONFIG_LOGLEVEL=error`). |
| `Completed with warnings: Setting IAM policy failed … allUsers … run.invoker` | Many orgs block granting `allUsers` (domain-restricted-sharing policy). The service is instead made public with `--no-invoker-iam-check`, so it's reachable — that's why the `/health` check passes. | Ignore. Access is enforced at the app layer (see [SECURITY.md](../SECURITY.md)). |
| Two different Service URLs in the logs (`…-<projectnumber>.<region>.run.app` and `…-<hash>-<region>.a.run.app`) | Cloud Run issues both a project-number URL and a classic hash URL; both point to the same service. | Use the URL the wizard prints at the end. |
| `useradd warning: … uid 1001 is greater than SYS_UID_MAX 999` | Cosmetic warning from creating the non-root container user. | Fixed — no longer appears. |
| Vite `Some chunks are larger than 500 kB` | Frontend bundle-size hint. | Fixed — vendors are code-split, no longer appears. |

**Real** failures look different: they stop the run with a line beginning `ERROR:` (from our scripts) or a non-zero build/deploy status. If the wizard finishes and prints a **Service URL** with `Deployed successfully — /health responded OK.`, the deploy worked regardless of any warnings above.

To see the raw, unfiltered `gcloud` output for debugging, set `GWS_SHOW_GCLOUD_NOISE=1` before running.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `unauthorized_client` on DWD test | Use the SA's numeric `client_id`, not the OAuth web client ID. Scopes must match `scopes.sh`. Wait 1–5 min after saving. |
| SA key creation blocked | Org policy `iam.disableServiceAccountKeyCreation` — use Workload Identity Federation. |
| `400: redirect_uri_mismatch` on sign-in | The redirect URI the app sends must be registered **exactly** on the OAuth Web client. Confirm the app is sending the real URL (not `PLACEHOLDER`): `gcloud secrets versions access latest --secret=oauth-redirect-uri`. It must equal `https://<cloud-run-url>/api/auth/callback` and be listed under the client's Authorized redirect URIs. Changes take ~1 min to propagate. |
| OAuth login fails | Redirect URI must exactly match the Cloud Run URL + `/api/auth/callback`. |
| Billing not enabled | Pass `--billing-account` or link it in the GCP Console. |
| Permission denied on deploy | Grant `roles/run.admin` + `roles/iam.serviceAccountUser` to `github-deploy-sa`. |
| Docker push denied | Grant `roles/artifactregistry.writer`; ensure `artifactregistry.googleapis.com` is enabled. |
| Scope drift | Run `npm run check:scopes`. |
| Public access blocked | The service deploys with `--no-invoker-iam-check` because many orgs block `allUsers` invoker IAM. Access is enforced at the app layer (see SECURITY.md). |
