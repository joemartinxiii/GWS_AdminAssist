# Project Handoff — Moving to Another Device

Use this guide when cloning or copying **Google Workspace Admin Management UI** to a new machine. The goal is to carry **code + operational context + AI session continuity**, not secrets in git.

---

## Fastest path (recommended)

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist.git
cd GWS_AdminAssist
npm install
npm --prefix frontend install
npm --prefix backend install
```

Then restore **secrets and GCP access** (see [Secrets & credentials](#secrets--credentials-not-in-git) below).

**Do not copy `node_modules/`** — reinstall on the new device (~600MB saved).

---

## What travels in git vs what you bring separately

| In git (clone gets it) | **Not** in git — bring manually |
|------------------------|----------------------------------|
| Full source (`frontend/`, `backend/`) | Service account JSON key (`*.json` keys are gitignored) |
| `Dockerfile`, `deploy.sh`, `setup-secrets.sh` | OAuth client secret |
| `.github/workflows/deploy.yml` | Local `.env` (gitignored) |
| All docs below | GitHub Actions secret `GCP_SA_KEY` (stored in GitHub only) |
| `.cursor/rules/end-session.mdc` | GCP user login: `gcloud auth login` on new machine |

Production secrets for Cloud Run live in **GCP Secret Manager** — you do not need to copy them to the new device unless you are doing local dev against real APIs.

---

## Context map — where everything lives

Read these in order when resuming work or onboarding Cursor on a new machine.

| Document | Purpose |
|----------|---------|
| **[README.md](../README.md)** | Product overview, features, architecture, setup index |
| **[docs/sessions/](sessions/)** | **Session logs** — dated summaries of what was done, bugs fixed, carry-over |
| **[docs/tech-debt.md](tech-debt.md)** | Backlog: UX polish, deployed bugs, verification checklist |
| **[docs/GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)** | CI/CD setup, GitHub secrets, troubleshooting deploy |
| **[DEPLOYMENT.md](../DEPLOYMENT.md)** | Cloud Run deploy, Docker, first-time GCP setup |
| **[SECURITY.md](../SECURITY.md)** | DWD scopes, OAuth, roles (super vs delegated admin) |
| **[docs/ui.md](ui.md)** | UI tokens and component patterns |
| **[.cursor/rules/end-session.mdc](../.cursor/rules/end-session.mdc)** | Cursor rule: say **"end session"** → write session log + update tech debt |

### Latest session (as of 2026-05-19)

See **[docs/sessions/2026-05-19.md](sessions/2026-05-19.md)** for:

- Drive permission fixes (`supportsAllDrives`, inherited-permission messaging, My Drive empty permissions)
- Users page column alignment + edit-dialog fresh fetch
- Export external email classification fix
- Pending: confirm dialogs, remaining `alert()` calls, file-list path shows drive root only

### Cursor / AI continuity

- **In repo:** session logs + tech debt + `end-session` rule give the agent project context on any machine.
- **Not in repo:** Cursor chat transcripts live under your user profile (`~/.cursor/projects/...`). They do **not** transfer with git. Rely on `docs/sessions/` for historical context.

---

## Production environment snapshot

Update this section if infra changes.

| Item | Value |
|------|--------|
| **GitHub repo** | https://github.com/joemartinxiii/GWS_AdminAssist |
| **Default branch** | `main` (push triggers deploy) |
| **GCP project ID** | `admin-assist-492920` (default in `deploy.sh`) |
| **Cloud Run service** | `workspace-admin` |
| **Region** | `us-central1` |
| **Artifact Registry repo** | `workspace-admin-repo` |
| **Runtime service account** | `workspace-admin-sa@<PROJECT_ID>.iam.gserviceaccount.com` |
| **CI deploy service account** | `github-deploy-sa@<PROJECT_ID>.iam.gserviceaccount.com` |
| **Production URL** | `https://workspace-admin-jevytnm5qa-uc.a.run.app` |
| **OAuth redirect URI** | `https://workspace-admin-jevytnm5qa-uc.a.run.app/api/auth/callback` |

OAuth redirect must match **Google Cloud Console → APIs & Services → Credentials → OAuth Web client**.

---

## New device setup checklist

### 1. Tooling

- Node.js 18+
- npm
- Docker (for local prod-like builds and `./deploy.sh`)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- Optional: [GitHub CLI](https://cli.github.com/) (`gh`)

### 2. Clone and install

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist.git
cd GWS_AdminAssist
npm install && npm --prefix frontend install && npm --prefix backend install
```

### 3. GCP authentication

```bash
gcloud auth login
gcloud config set project admin-assist-492920
gcloud auth application-default login   # if running backend locally against GCP
```

### 4. Local development (optional)

- Copy or recreate root `.env` per **[SECURITY.md](../SECURITY.md)** and **[DEPLOYMENT.md](../DEPLOYMENT.md)**.
- Or use MSW mocks: **[QUICK_START_UI.md](../QUICK_START_UI.md)** + **[frontend/ENV_SETUP.md](../frontend/ENV_SETUP.md)**.

```bash
npm run dev
```

### 5. Verify before changing production

```bash
npm run type-check
npm run test:security
```

### 6. Deploy (if needed)

```bash
./deploy.sh admin-assist-492920 us-central1
```

Or push to `main` and let GitHub Actions deploy (see **docs/GITHUB_ACTIONS.md**).

---

## Secrets & credentials (not in git)

### Already in GCP Secret Manager (production)

Created by `./setup-secrets.sh`:

- `service-account-key`
- `oauth-client-id`
- `oauth-client-secret`
- `oauth-redirect-uri`
- `app-jwt-secret`
- `app-workspace-domain`
- `app-allowed-domains`

Cloud Run mounts these via `deploy.sh` / `cloud-run.yaml`. New laptop only needs `gcloud` access to the project.

### For local dev on new machine

You need **one** of:

1. **Service account JSON** file path → `SA_KEY_PATH` / backend env, **or**
2. Re-download key from GCP (if your org allows key creation), **or**
3. Run frontend-only with MSW (no real Google APIs)

Also set locally (never commit):

- OAuth Web client ID + secret
- `WORKSPACE_DOMAIN`
- `JWT_SECRET` (or generate new for dev only)

### GitHub Actions (already configured in repo settings)

- `GCP_PROJECT_ID`
- `GCP_SA_KEY` (JSON for `github-deploy-sa`)

No action on new device unless you are reconfiguring CI.

---

## Offline / USB transfer (no network clone)

If you cannot clone from GitHub:

```bash
# On source machine, from repo root:
tar -czvf GWS_AdminAssist-handoff.tar.gz \
  --exclude=node_modules \
  --exclude=frontend/node_modules \
  --exclude=backend/node_modules \
  --exclude=frontend/dist \
  --exclude=backend/dist \
  --exclude=.env \
  --exclude='*.json' \
  --exclude=.git \
  .

# On new machine:
mkdir GWS_AdminAssist && cd GWS_AdminAssist
tar -xzvf /path/to/GWS_AdminAssist-handoff.tar.gz
npm install && npm --prefix frontend install && npm --prefix backend install
git init && git remote add origin https://github.com/joemartinxiii/GWS_AdminAssist.git
git fetch && git checkout main   # optional: reattach to remote history
```

Prefer **`git clone`** when possible so history and future pulls stay simple.

---

## Resuming work with Cursor

1. Open the cloned folder in Cursor.
2. Tell the agent: *"Read docs/HANDOFF.md and the latest file in docs/sessions/ for context."*
3. When finishing for the day, say **"end session"** — the agent will append a session log and update tech debt per `.cursor/rules/end-session.mdc`.

---

## Known open items (from tech debt)

See **[docs/tech-debt.md](tech-debt.md)** for full list. Highlights:

- Drive: replace `window.confirm()` / remaining `alert()` with MUI dialog + snackbar
- Drive file list: paths show Shared Drive root only (modal has full path)
- Calendar, Groups, Email Delegation: deployed bugs listed under "Deployed Bug Backlog"
- UX interaction polish phases (keyboard, focus, messaging)

---

## Support contacts / ownership

- **Maintainer:** Joe Martin
- **Repo:** GWS_AdminAssist (private/public per GitHub settings)

---

*Last updated: 2026-07-06 — handoff doc created for device migration.*
