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

The Vite dev server proxies `/api` → `http://localhost:5001`. Sign in with Google. This requires backend env vars (OAuth client, JWT secret, workspace domain, and a service-account key). Point `SA_KEY_PATH` at a local JSON key, or read from Secret Manager. See [SECURITY.md](../SECURITY.md#environment-variables) and [STAGING_TEST_SETUP.md](./STAGING_TEST_SETUP.md).

## Frontend env vars (`VITE_*`)

Only `VITE_`-prefixed vars are exposed to the bundle. Put overrides in `frontend/.env.local` (git-ignored); restart the dev server after changes.

| Var | Purpose |
|-----|---------|
| `VITE_USE_MSW` | `true` enables MSW mocks (**development only**). Omit/`false` for the real API. |
| `VITE_API_URL` | REST API base incl. `/api` prefix. Default when unset: `http://localhost:5001/api`. |
| `VITE_WORKSPACE_DOMAIN` | Used for export filenames; match backend `WORKSPACE_DOMAIN`. |

> Docker Compose may map the backend to host port **5000**; if you run only the compose API, set `VITE_API_URL=http://localhost:5000/api`.

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
