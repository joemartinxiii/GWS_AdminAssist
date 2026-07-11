# Deploy reference

Technical detail for operators and contributors. Day-to-day steps live in **[DEPLOY.md](./DEPLOY.md)**.

---

## Shared deploy pipeline

After a container image exists in Artifact Registry, every path calls:

```text
scripts/deploy-from-image.sh  →  scripts/lib/deploy-cloud-run.sh
```

| Entry | Build | Then |
|-------|--------|------|
| `scripts/bootstrap-tenant.sh` | Cloud Build (via deploy-cloudshell) | deploy-from-image |
| `scripts/deploy-cloudshell.sh` | Cloud Build | deploy-from-image |
| `.github/workflows/deploy.yml` | Docker on the runner | deploy-from-image |
| `./deploy.sh` | Local Docker (`linux/amd64`) | deploy-from-image |

Post-image steps (in order):

1. Deploy Cloud Run service `workspace-admin` with Secret Manager bindings and scan env
2. Write the live OAuth redirect URI and **pin that secret version** on the service
3. Set `CORS_ORIGIN` to the service URL
4. Ensure scan/audit GCS bucket, IAM, and Cloud Run Job `workspace-admin-scan`
5. Optional signature-template bucket when `SIGNATURE_TEMPLATE_BUCKET` is set
6. Optional `GWS_PROTECTED_USERS` when set
7. `/health` check
8. Print DWD scopes + SA Client ID (verify when `DWD_ADMIN_EMAIL` is set)

APIs are enabled from the single list in [`scripts/lib/scopes.sh`](../scripts/lib/scopes.sh) (`GCP_APIS`). Scope strings for OAuth consent and DWD must stay in sync with [`backend/src/config/google.config.ts`](../backend/src/config/google.config.ts) — check with `npm run check:scopes`.

---

## Bootstrap wizard options

```
--create-project          Create the GCP project
--billing-account ID      Link billing
--organization ID         Org for a new project
--folder ID               Folder for a new project
--region REGION           Default: us-central1
--skip-cloudshell         Skip the immediate deploy
--skip-github             Skip GitHub CI (WIF) setup
--non-interactive         Requires CLIENT_ID, CLIENT_SECRET, and flags via env
--github-repo OWNER/REPO  For WIF + gh secret set
--allowed-domains LIST    Extra domains (comma-separated)
```

Non-interactive example (new project):

```bash
bash scripts/bootstrap-tenant.sh \
  --create-project \
  --billing-account 012345-678901-ABCDEF \
  --domain yourcompany.com \
  --project workspace-admin-prod \
  --admin you@yourcompany.com \
  --non-interactive
# Also set CLIENT_ID and CLIENT_SECRET in the environment
```

### What the wizard automates vs what you click

| Step | Automated? |
|------|------------|
| Create / select project, link billing | Yes |
| Enable APIs, runtime SA (keyless DWD), deploy SA | Yes |
| Secret Manager + Artifact Registry | Yes |
| OAuth consent + Web client | You (guided) |
| Domain-wide delegation | You (guided) |
| First Cloud Run deploy + health | Yes |
| GitHub Actions WIF secrets | Optional / guided |

---

## Secrets and environment

Runtime values come from Secret Manager (injected by Cloud Run) plus a few plain env vars. Full security notes: [SECURITY.md](../SECURITY.md#environment-variables).

| App env | Source |
|---------|--------|
| `GOOGLE_CLIENT_ID` | Secret `oauth-client-id` |
| `GOOGLE_CLIENT_SECRET` | Secret `oauth-client-secret` |
| `GOOGLE_REDIRECT_URI` | Secret `oauth-redirect-uri` (pinned version after each deploy) |
| `JWT_SECRET` | Secret `app-jwt-secret` |
| `WORKSPACE_DOMAIN` | Secret `app-workspace-domain` |
| `GWS_ALLOWED_DOMAINS` | Secret `app-allowed-domains` |
| `GCP_PROJECT_ID` | Literal env |
| `SERVICE_ACCOUNT_EMAIL` | Literal env (`workspace-admin-sa@…`) |
| `SCAN_BUCKET` / `SCAN_JOB_NAME` / `SCAN_REGION` | Literal env |

**Multi-domain:** bootstrap merges the admin’s domain into the allowlist and can take extras. Update `app-allowed-domains` in Secret Manager if domains change, then redeploy. DWD is not repeated per domain.

**Keyless DWD:** the runtime SA signs its own delegation tokens (`roles/iam.serviceAccountTokenCreator` on itself). No service-account key is stored for production.

### Optional production settings

| Setting | Purpose |
|---------|---------|
| `GWS_PROTECTED_USERS` | Comma-separated emails that cannot be permanently deleted |
| `SIGNATURE_TEMPLATE_BUCKET` | Durable org signature templates (otherwise ephemeral local disk) |
| `DWD_ADMIN_EMAIL` | Super-admin subject for post-deploy DWD verification |
| `SCAN_BUCKET` | Override default `<project>-workspace-admin-scans` |
| `SCAN_USER_CONCURRENCY` | Drive scan parallelism (default `15`) |

GitHub Actions: set the first three as repository **Variables** if needed. Export them in the shell before `deploy-cloudshell.sh` / `deploy.sh`.

---

## Scan job and Security Audit storage

| Resource | Name | Role |
|----------|------|------|
| Cloud Run Job | `workspace-admin-scan` | On-demand Drive external/public scan |
| GCS bucket | `<project>-workspace-admin-scans` | Scan reports **and** `security-audit/latest.json` + `security-audit/waivers.json` |

Drive → External Shares / Public Links → **Run scan** (super admin). Security Audit → **Run audit** (super admin). Idle cost is effectively zero; work is on demand.

Security Audit also needs Cloud Identity Policy (and Chrome Policy for Chrome checks) APIs — enabled automatically via `GCP_APIS` — and the DWD scopes in [SECURITY.md](../SECURITY.md).

---

## GitHub Actions (WIF)

```bash
bash scripts/setup-github-ci.sh <PROJECT_ID> <GITHUB_OWNER/REPO>
```

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_WIF_PROVIDER` | `projects/…/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOY_SA` | `github-deploy-sa@<project>.iam.gserviceaccount.com` |

Deploy SA roles: `run.admin`, `artifactregistry.writer`, `secretmanager.viewer` (describe secrets for preflight), `secretmanager.secretVersionAdder`, `serviceusage.serviceUsageAdmin`, and `actAs` on the runtime SA. Runtime remains `workspace-admin-sa`.

Key fallback (only if your org allows SA keys): set `GCP_SA_KEY` and omit `GCP_WIF_PROVIDER`. Prefer WIF.

---

## Verification commands

```bash
# Health
curl -s "$(gcloud run services describe workspace-admin --region us-central1 --format='value(status.url)')/health"

# DWD (needs ADC with tokenCreator on the runtime SA)
npx tsx scripts/verify-dwd.ts workspace-admin-sa@PROJECT.iam.gserviceaccount.com you@yourcompany.com

# Optional live API tests — see STAGING_TEST_SETUP.md
npm run bootstrap:test
npm run test:live:read
```

SA Client ID for the Admin console (keyless — no JSON key file):

```bash
gcloud iam service-accounts describe workspace-admin-sa@PROJECT.iam.gserviceaccount.com \
  --format='value(oauth2ClientId)'
```

---

## Teardown

```bash
bash scripts/teardown-project.sh --project your-gcp-project-id
bash scripts/teardown-project.sh --project your-gcp-project-id --delete-project
```

Removes Cloud Run service, scan job + bucket, app secrets, service accounts, and Artifact Registry. You still remove:

- DWD entry for the old SA Client ID in [admin.google.com](https://admin.google.com/ac/owl/domainwidedelegation)
- OAuth Web client in GCP Console (if unused)
- GitHub secrets: `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` (and `GCP_SA_KEY` if used)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `unauthorized_client` (DWD) | Use the SA **numeric** Client ID, not the OAuth Web client ID. Scopes must match `scopes.sh`. Wait a few minutes after saving. |
| `redirect_uri_mismatch` | Secret `oauth-redirect-uri` must equal `https://<service-url>/api/auth/callback` and be registered on the OAuth client. Redeploy if the value is still a placeholder. |
| OAuth login fails | Redirect URI must match exactly (scheme, host, path). |
| CI auth failures | Confirm WIF secrets; re-run `setup-github-ci.sh`. |
| `App secrets not found` / `Cannot read Secret Manager` in CI | Deploy SA needs `roles/secretmanager.viewer`. Re-run `bash scripts/setup-github-ci.sh <PROJECT> OWNER/REPO`, then re-run the workflow. |
| Permission denied on deploy | Deploy SA roles listed above; re-run `setup-github-ci.sh` / bootstrap. |
| Billing errors | Link a billing account (`--billing-account` or Console). |
| Scope drift | `npm run check:scopes` |
| Delete should have been blocked | Set `GWS_PROTECTED_USERS` and redeploy. |
| Signature template lost after redeploy | Set `SIGNATURE_TEMPLATE_BUCKET` and redeploy. |
| Audit checks stuck on Manual | Confirm Policy APIs + DWD scopes; sign in as super admin. |

App-layer access (who can sign in and mutate) is documented in [SECURITY.md](../SECURITY.md) — the service is publicly reachable by design for browser OAuth; authorization is enforced in the app.

### Script diagnostics

Scripts filter common noisy `gcloud` stderr lines. To see raw `gcloud` output:

```bash
GWS_SHOW_GCLOUD_NOISE=1 bash scripts/deploy-cloudshell.sh <PROJECT_ID>
```
