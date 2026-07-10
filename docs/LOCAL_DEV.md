# Local Development

Cloud Run is the primary way to run the app (see [DEPLOY.md](./DEPLOY.md)). Local dev is for iterating on the UI or backend before deploying.

For UI **design system** conventions (tokens, lists, dialogs), see [ui.md](./ui.md).

## Install

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Option A — UI only, mocked API (MSW)

Build and test the UI **without** a running backend or Google sign-in. The app loads [MSW](https://mswjs.io/) in development and returns fixture data from `frontend/src/mocks/` (never shipped in production builds).

```bash
cd frontend
npm run dev:msw          # or, from repo root: npm run dev:frontend:msw
```

Open http://localhost:3000 — you get a dev session token and mocked `/api/*` responses.

Alternatively, add `VITE_USE_MSW=true` to `frontend/.env.local` and run `npm run dev`.

> **Never** set `VITE_USE_MSW=true` for production. The Docker build forces `VITE_USE_MSW=false`.

## Option B — full stack (real Google OAuth + API)

```bash
npm run dev              # from repo root: backend (port 5001) + frontend (3000)
```

The Vite dev server proxies `/api` → `http://localhost:5001`. The SPA calls **same-origin** `/api` so the **HttpOnly session cookie** works (do not point `VITE_API_URL` at `:5001` unless you know you need a cross-origin setup).

Sign in with Google. This requires backend env vars (OAuth client, JWT secret, workspace domain). For local OAuth, register redirect URI **`http://localhost:3000/api/auth/callback`** (proxied to the backend) so the session cookie is set on the same host as the UI. Auth is **keyless** — set `SERVICE_ACCOUNT_EMAIL` to the runtime SA and authenticate locally with `gcloud auth application-default login` (your account needs `roles/iam.serviceAccountTokenCreator` on that SA). No key file. See [SECURITY.md](../SECURITY.md#environment-variables) and [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md).

## Frontend env vars (`VITE_*`)

Only `VITE_`-prefixed vars are exposed to the bundle. Put overrides in `frontend/.env.local` (git-ignored); restart the dev server after changes.

| Var | Purpose |
|-----|---------|
| `VITE_USE_MSW` | `true` enables MSW mocks (**development only**). Omit/`false` for the real API. |
| `VITE_API_URL` | REST API base incl. `/api` prefix. Default: **`/api`** (same-origin; recommended). |
| `VITE_WORKSPACE_DOMAIN` | Used for export filenames; match backend `WORKSPACE_DOMAIN`. |

> Prefer the Vite proxy (`/api`) so session cookies stay same-site. Only override `VITE_API_URL` if you intentionally run a split origin.

## Routes

Authenticated landing is `/` → `/users` (there is no `/dashboard`).

| Path | Screen |
|------|--------|
| `/login`, `/auth/callback`, `/auth/error` | Login / OAuth return |
| `/users` | People (directory users) |
| `/groups` | Groups |
| `/calendar` | Calendar |
| `/email-delegation` | Email delegation |
| `/drive` | Drive file explorer (incl. external-sharing views) |
| `/shared-drives` | Shared drives |
| `/email-signatures` | Email signatures |
| `/audit` | Security audit (GWS hardening checklist) |

## Tests

```bash
npm run test:security     # input-validation + error/permission unit tests (no network)
npm run type-check
npm run lint
```

Live/E2E tests against a real tenant: see [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md).
