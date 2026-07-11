# AGENTS.md

## Cursor Cloud specific instructions

This is a **single-product npm-workspaces monorepo**: a React + Vite + MUI frontend
(`frontend/`) and a Node + Express + TypeScript backend (`backend/`). There is **no
database** — persistence in prod is GCS, and in local dev it falls back to `backend/data/`
on disk. Standard commands live in `package.json` (root/frontend/backend) and
`docs/LOCAL_DEV.md`; prefer those over duplicating here.

### Dependencies
- `npm install` at the repo root installs **all** workspaces (frontend + backend). The
  update script already runs this on startup; no per-package install needed.

### Running the app (two dev modes)
- **UI-only (MSW mocks) — works with no secrets/tenant:** `npm run dev:frontend:msw`
  → Vite on http://localhost:3000. MSW auto-authenticates as a mock super admin and mocks
  every `/api/*` call, so the full UI is interactive (People, Groups, Drive, Calendar,
  Audit, etc.). This is the way to demo/verify UI end-to-end in the cloud VM.
- **Full stack:** `npm run dev` → backend on :5001 + frontend on :3000 (Vite proxies
  `/api` → :5001). The backend **boots** with only `JWT_SECRET`, `GCP_PROJECT_ID`,
  `WORKSPACE_DOMAIN`, but real **sign-in and Google API calls require** Google OAuth creds,
  a Workspace tenant with domain-wide delegation, and GCP Application Default Credentials
  (`gcloud auth application-default login`). Without those, login and data calls fail —
  use MSW mode instead for UI work.

### Backend env gotcha (non-obvious)
- `backend/src/index.ts` calls `dotenv.config()` **after** its imports, and
  `auth.service.ts` throws `JWT_SECRET environment variable is required` at
  **module-load time**. That means a plain `backend/.env` loaded by `dotenv.config()` is
  **too late** — the process crashes before it's read. Env vars must be present in the
  process environment **before** node starts. Inject them at process start, e.g.:
  `npx dotenv -e backend/.env -- npm run dev --prefix backend` (dotenv-cli is a root
  devDependency), or export the vars in the shell, or use `--env-file`. The repo's
  `npm run dev:backend:test` already does this via `dotenv -e .env.test`.
- `backend/.env`, `.env.local`, `.env.test` are gitignored — never commit real secrets or
  tenant identifiers (see `.cursor/rules/security.mdc`).

### Quality checks (all pass on a clean checkout)
- Type-check: `npm run type-check:all` (backend + frontend `tsc --noEmit`).
- Backend tests: `npm test` (jest); security subset: `npm run test:security`.
- Lint: root `npm run lint` runs **backend** eslint only (passes; warnings allowed).
  The frontend has its own stricter lint (`cd frontend && npm run lint`,
  `--max-warnings 0`) which currently reports pre-existing errors — not caused by setup.
- Live/E2E (`npm run test:live*`, `npm run test:e2e`) need a real tenant + `.env.test`
  (see `docs/STAGING_TEST_SETUP.md`) and are not runnable in the cloud VM without secrets.
