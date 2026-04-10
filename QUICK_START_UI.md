# Quick start — view the UI

For **design system** conventions (tokens, lists, dialogs), see **[docs/ui.md](./docs/ui.md)**.

## Option A: Demo mode (recommended)

⚠️ **SECURITY WARNING**: Demo mode bypasses authentication and grants all permissions for UI preview. **Never enable `VITE_DEMO_MODE=true` in production** or expose demo instances publicly.

Use **demo mode** to browse the app **without** a running backend or Google sign-in. Data comes from `frontend/src/data/demoData.ts`.

1. Create **`frontend/.env.local`**:

   ```bash
   cd frontend
   echo "VITE_DEMO_MODE=true" > .env.local
   ```

2. Install and run:

   ```bash
   npm install
   npm run dev
   ```

3. Open **http://localhost:3000** — `ProtectedRoute` skips auth when `VITE_DEMO_MODE=true`.

If the API is called and fails, the UI still loads; list pages use demo data where wired.

## Option B: Full stack (`npm run dev` from repo root)

Runs the backend (default **port 5001**) and frontend (**3000**) together. The Vite dev server proxies `/api` to `http://localhost:5001`. Sign in with Google when not in demo mode.

## Routes (no separate dashboard)

The default authenticated landing route is **`/` → `/users`**. There is **no** `/dashboard` route.

| Path | Screen |
|------|--------|
| `/login` | Login |
| `/auth/callback` | OAuth return (same handler as `/login`; backend redirects here with `?token=` after Google) |
| `/users` | People (directory users) |
| `/groups` | Groups |
| `/calendar` | Calendar |
| `/email-delegation` | Email delegation |
| `/drive` | Drive file explorer (includes external-sharing views) |
| `/shared-drives` | Shared drives |
| `/email-signatures` | Email signatures |
| `/audit` | Security audit (GWS hardening checklist) |

## Optional: bypass auth in code

Instead of demo mode, you can temporarily change **`frontend/src/components/ProtectedRoute.tsx`** (not recommended for anything other than local UI debugging).

## What you’ll see

- **Layout**: Sidebar (labels match the app: **People**, **Groups**, **Calendar**, etc.), light/dark theme, Plus Jakarta Sans.
- **Data views**: Mostly **flex list** surfaces (`ListShell`, `ColumnHeader`, `ListDataRow`) with pagination; some areas still use MUI **`Table`** or **`TablePagination`**.
- **Dialogs**, **filter drawer**, **export** menus where implemented.

## Troubleshooting

**Dependencies:**

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Port 3000 in use:** Vite is configured with `strictPort: true` — free port 3000 or change `server.port` in `frontend/vite.config.mjs`.

**API URL:** See **[frontend/ENV_SETUP.md](./frontend/ENV_SETUP.md)**. Local dev defaults to **`http://localhost:5001/api`** unless `VITE_API_URL` is set (e.g. Docker Compose exposes the backend on **5000**).
