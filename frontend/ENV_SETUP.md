# Environment Variables Setup

## Local UI with mocked API (MSW)

To work on the UI **without** a running backend or Google OAuth, use **MSW** (Mock Service Worker). The app keeps normal auth routing; session and API responses are mocked in development only.

**Option A — npm script (recommended)**

```bash
cd frontend
npm run dev:msw
```

**Option B — env file**

Create **`frontend/.env.local`**:

```bash
VITE_USE_MSW=true
```

Then `npm run dev` as usual.

**Never set `VITE_USE_MSW=true` for production builds.** The Docker image sets `VITE_USE_MSW=false` for the build step.

## Full stack (real Google OAuth + API)

Remove `VITE_USE_MSW` or set `VITE_USE_MSW=false`, run the backend and frontend (e.g. `npm run dev` from the repo root). Sign in with Google.

## Available environment variables

- **`VITE_USE_MSW`**: `'true'` enables MSW mocks in **development** only. Omit or `false` for real API.
- **`VITE_API_URL`**: Base URL for the REST API, including the `/api` prefix.
- **`VITE_WORKSPACE_DOMAIN`**: Used for export filenames (e.g. `yourdomain.com-users-all-...csv`). Matches backend `WORKSPACE_DOMAIN`. Add to `.env.local` for consistent naming across frontend/backend.

**Default when unset:** `http://localhost:5001/api` — matches the backend’s default **`PORT`** in `backend/src/index.ts` (`5001`).

**Docker Compose:** The compose file may map the backend to host port **5000**. If you run only Docker for the API, set e.g. `VITE_API_URL=http://localhost:5000/api` for the frontend.

**Vite proxy:** In dev, `frontend/vite.config.mjs` proxies `/api` to `http://localhost:5001`. You can still point `VITE_API_URL` at the full URL so axios hits the backend directly; both patterns are used.

## Setup Instructions

1. For MSW: use `npm run dev:msw` or add `VITE_USE_MSW=true` to `.env.local`.
2. Restart the dev server after changing environment variables.
3. `.env.local` is git-ignored and will not be committed.

## Notes

- Environment variables must be prefixed with `VITE_` to be exposed to the frontend bundle.
- Changes to `.env.local` require a dev server restart to take effect.
