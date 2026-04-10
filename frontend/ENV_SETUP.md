# Environment Variables Setup

## Demo mode

To enable **demo mode** (skip sign-in; use data from `src/data/demoData.ts`), create **`frontend/.env.local`**:

```bash
# frontend/.env.local
VITE_DEMO_MODE=true
```

To disable demo mode for a real backend session, remove the variable or set:

```bash
VITE_DEMO_MODE=false
```

## Available environment variables

- **`VITE_DEMO_MODE`**: `'true'` enables demo mode; `'false'` or unset uses normal auth (see `ProtectedRoute.tsx`).
- **`VITE_API_URL`**: Base URL for the REST API, including the `/api` prefix.
- **`VITE_WORKSPACE_DOMAIN`**: Used for export filenames (e.g. `yourdomain.com-users-all-...csv`). Matches backend `WORKSPACE_DOMAIN`. Add to `.env.local` for consistent naming across frontend/backend.

**Default when unset:** `http://localhost:5001/api` — matches the backend’s default **`PORT`** in `backend/src/index.ts` (`5001`).

**Docker Compose:** The compose file maps the backend to host port **5000**. If you run only Docker for the API, set e.g. `VITE_API_URL=http://localhost:5000/api` for the frontend.

**Vite proxy:** In dev, `frontend/vite.config.mjs` proxies `/api` to `http://localhost:5001`. You can still point `VITE_API_URL` at the full URL so axios hits the backend directly; both patterns are used in the wild.

## Setup Instructions

1. Copy the example file (if it exists) or create `.env.local`:
   ```bash
   cd frontend
   # Create .env.local with:
   echo "VITE_DEMO_MODE=true" > .env.local
   ```

2. Restart your development server after changing environment variables

3. The `.env.local` file is git-ignored and will not be committed

## Notes

- Environment variables must be prefixed with `VITE_` to be accessible in the frontend
- Changes to `.env.local` require a dev server restart to take effect
- For production builds, set environment variables in your deployment environment
