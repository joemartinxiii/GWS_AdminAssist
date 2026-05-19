# Quick start — view the UI

For **design system** conventions (tokens, lists, dialogs), see **[docs/ui.md](./docs/ui.md)**.

## Option A: Mock API (MSW) — no backend

Use this to build and test UI locally **without** Google sign-in or a running API. The app loads **[MSW](https://mswjs.io/)** in development and returns fixture data from `frontend/src/mocks/` (not shipped in production builds).

1. From **`frontend/`**:

   ```bash
   npm run dev:msw
   ```

   Or from the repo root: `npm run dev:frontend:msw`

   Alternatively add to **`frontend/.env.local`**: `VITE_USE_MSW=true` and run `npm run dev`.

2. Open **http://localhost:3000** — you get a dev session token and mocked `/api/*` responses.

3. **Do not** set `VITE_USE_MSW=true` in production. The Docker build explicitly disables it.

## Option B: Full stack (`npm run dev` from repo root)

Runs the backend (default **port 5001**) and frontend (**3000**) together. The Vite dev server proxies `/api` to `http://localhost:5001`. Sign in with Google.

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

## What you’ll see

- **Layout**: Sidebar (labels match the app: **People**, **Groups**, **Calendar**, etc.), light/dark theme, Plus Jakarta Sans.
- **Data views**: Mostly **flex list** surfaces (`ListShell`, `ColumnHeader`, `ListDataRow`) with pagination; some areas still use MUI **`Table`** or **`TablePagination`**.
