# Local development

Cloud Run is the primary way to run the product ([DEPLOY.md](./DEPLOY.md)). Use this guide to iterate on the UI or API on your machine.

UI conventions: [ui.md](./ui.md). Live tests: [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md).

---

## Install

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

---

## Option A — UI only (mocked API)

No backend, no Google sign-in. MSW serves fixtures from `frontend/src/mocks/` (not included in production builds).

```bash
npm run dev:frontend:msw
# or: cd frontend && npm run dev:msw
```

Open http://localhost:3000.

Or set `VITE_USE_MSW=true` in `frontend/.env.local` and run `npm run dev`.  
**Never** enable MSW in production — the Docker build forces `VITE_USE_MSW=false`.

---

## Option B — full stack (real OAuth + APIs)

```bash
npm run dev   # backend :5001 + frontend :3000
```

Vite proxies `/api` → `http://localhost:5001`. The SPA should call **`/api`** (same origin) so the HttpOnly session cookie works.

### Backend env (minimum)

Put these in `backend/.env` or the environment (names match production):

| Variable | Notes |
|----------|--------|
| `JWT_SECRET` | Any long random string for local sessions |
| `GCP_PROJECT_ID` | Your GCP project |
| `WORKSPACE_DOMAIN` | Primary domain |
| `GWS_ALLOWED_DOMAINS` | Optional; defaults behavior uses primary |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Web client |
| `GOOGLE_REDIRECT_URI` | **`http://localhost:3000/api/auth/callback`** |
| `SERVICE_ACCOUNT_EMAIL` | `workspace-admin-sa@PROJECT.iam.gserviceaccount.com` |
| `CORS_ORIGIN` | `http://localhost:3000` |

Register that redirect URI on the OAuth Web client.

### Keyless Workspace access

```bash
gcloud auth application-default login
```

Your Google account needs `roles/iam.serviceAccountTokenCreator` on the runtime SA (same as production keyless DWD). No SA JSON key.

Or pull secrets for a test project: `npm run bootstrap:test` (see staging doc).

---

## Frontend env (`VITE_*`)

Only `VITE_`-prefixed vars reach the browser. Use `frontend/.env.local` (gitignored).

| Var | Purpose |
|-----|---------|
| `VITE_USE_MSW` | `true` = mocks (dev only) |
| `VITE_API_URL` | Default `/api` (recommended) |
| `VITE_WORKSPACE_DOMAIN` | Export filenames; match backend domain |

---

## Routes

Authenticated home is `/` → `/users`.

| Path | Screen |
|------|--------|
| `/login`, `/auth/callback`, `/auth/error` | Auth |
| `/users` | People |
| `/groups` | Groups |
| `/calendar` | Calendar |
| `/email-delegation` | Email delegation |
| `/drive` | Drive + external/public sharing |
| `/shared-drives` | Shared drives |
| `/email-signatures` | Signature templates |
| `/audit` | Security audit |

---

## Quick checks

```bash
npm run type-check:all
npm run test:security
npm run lint
```

Live/E2E against a real tenant: [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md).
