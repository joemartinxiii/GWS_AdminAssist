# Technical Debt Backlog

This document tracks non-blocking improvements that raise product quality, reliability, and operator efficiency.

## Completed — 2026-07-06 refactor pass

The following were delivered in the codebase-wide reliability/security/UX pass and are no longer outstanding:

- **UX interaction polish (all pages)** — replaced native `window.confirm()` with the `useConfirm` hook, native `alert()` with the `useSnackbar` hook, and the native `datetime-local` inputs in Calendar with the app-styled `DateTimePicker`. Added `loadError` states with MUI `Alert` banners (distinct from empty states) and dialog `autoFocus` across `Users`, `Groups`, `Drive`, `SharedDrives`, `Calendar`, `EmailDelegation`, `EmailSignatures`, and `SecurityAudit`.
- **Standardized API error handling** — backend `utils/apiError.ts` (`normalizeApiError`/`sendApiError`) resolves the true Google status/message/hint; frontend `utils/apiError.ts` (`getApiErrorMessage`) renders consistent, actionable messages including backend hints.
- **Reliability/perf** — bounded-concurrency bulk scans (`utils/concurrency.ts`) in Drive/Groups/Gmail services; robust 404/status detection in `withRetry`.
- **Security** — login-time Workspace-admin + allowed-domain gate, OAuth tokens returned via URL fragment (not query string), CORS locked to `CORS_ORIGIN` in production, trimmed `/health` payload.
- **Durable signatures** — org signature template persists to GCS when `SIGNATURE_TEMPLATE_BUCKET` is set (falls back to local disk otherwise).
- **CI** — `npm run check:scopes` now validates both DWD **and** OAuth-consent scopes; deploy script runs a post-deploy `/health` smoke check.

## Remaining follow-ups (deferred)

- **Large page components** — `Drive.tsx`, `Calendar.tsx`, and `Users.tsx` are large; extract data-fetch/mutation logic into per-feature hooks (e.g. `useDriveFiles`, `useCalendarEvents`) for testability. Structural only; no behavior change.
- **Full integration security test** — `backend/tests/security.test.ts.disabled` exercises live route + auth + Google API paths and needs a mocking harness (JWT test tokens + nock/MSW for googleapis) before it can be re-enabled in CI. Pure-logic coverage now lives in `security-validation.test.ts` and `permissions-and-errors.test.ts`.
- **Signature bucket provisioning** — `SIGNATURE_TEMPLATE_BUCKET` provisioning + runtime-SA IAM is wired into `deploy-cloudshell.sh` (opt-in via env). Consider folding it into `bootstrap-tenant.sh` for greenfield tenants.

## Deployed Bug Backlog (Triage Required)

These are reported from deployed runtime behavior and should be treated as production-facing defects.

### Calendar

- Search clear control (`X`) does not clear search input on the Calendar page.
  - Area: `frontend/src/pages/Calendar.tsx`
  - Expected: clicking `X` clears current search text and refreshes filtered results immediately.

### Groups

- "Externally Shared" tab does not present group data.
  - Expected: show only groups with external members.
- "No Members" tab does not present group data.
  - Expected: show only groups with zero members.
  - Area: `frontend/src/pages/Groups.tsx`

### Email Delegation

- Add delegation returns `403 Forbidden` in production:
  - Request: `POST /api/gmail/{userEmail}/delegations` -> `403`
  - Frontend error surface currently logs axios error and generic failure.
  - Area: `frontend/src/pages/EmailDelegation.tsx`, `backend/src/routes/gmail.routes.ts`, permissions/DWD config.
  - Expected: actionable error surface and successful delegation creation for authorized super admin.

### Drive File Explorer

- No data returned on either tab in deployed environment.
  - Tabs: External Shares, All Files
  - Area: `frontend/src/pages/Drive.tsx`, `backend/src/routes/drive.routes.ts`, Drive API scopes/delegation.
  - Expected: tab data loads successfully for authorized admin user.

### Shared Drives

- Shared drive details/permissions dialog does not return members (permissions list empty or missing).
  - Area: `frontend/src/pages/SharedDrives.tsx`, `backend` shared drive permissions endpoints.
  - Expected: dialog lists shared drive members/permissions reliably.

### Suggested triage metadata (for each issue above)

- Repro steps (UI path + exact request)
- Deployed env vs local parity result
- API response payload/body capture
- Required role (super admin vs delegated admin) and actual signed-in role
- Scope/IAM dependency check (DWD scopes + service account IAM)

## Drive Permissions Modal — Remaining Polish

Discovered during 2026-05-19 live testing.

> **Resolved 2026-07-06:** the `window.confirm()` calls (`handleDeletePermission`, `handleBulkRemovePermissions`, `handleBulkRemoveExternalShares`) now use the `useConfirm` MUI dialog, and the `alert()` calls (`handleUpdatePermission`, `handleOpenPermissionDialogForReport`) now use the snackbar. The item below is the only remaining known limitation.

### File list path shows drive root only

`buildFastPath` (used during bulk scan for performance) returns only `/Shared Drives/<name>` for Shared Drive files — no subfolder path. The permissions modal now shows the correct full path via a fresh `GET /files/:id` fetch. If full path is also needed in the file list rows, it requires either per-file API calls (high perf cost) or a lazy-expand pattern.

Area: `backend/src/services/drive.service.ts` → `buildFastPath`

### Priority

Low-medium — UX polish, not functional blockers.

---

## Post-Deployment Verification Checklist (Add to Release SOP)

Add a lightweight verification pass after each production deploy to catch configuration and role-gating regressions early.

### Auth and Identity

- Confirm login succeeds and `/api/auth/me` returns `email`, role context, and avatar picture.
- Verify token refresh/session persistence across page reloads.

### Role and Permission Gating

- Validate Super Admin can run all mutation flows on `Users`, `Groups`, `Drive`, `SharedDrives`, `Calendar`, and `Email Delegation`.
- Validate delegated admin is restricted to intended read-only flows without hard crashes.
- Confirm 403 messages are actionable (include permission/scope guidance, not generic errors).

### Gmail Delegation and Send-As

- Create delegation from `Email Delegation` page and verify success response.
- Remove delegation and verify list refreshes immediately.
- Confirm DWD scopes include `gmail.settings.sharing` and `gmail.settings.basic` in deployed environment.

### Drive and Shared Drives

- Verify both `Drive` tabs load data: `External Shares` and `All Files`.
- Open shared drive details dialog and verify permissions/member list loads.
- Add/remove drive permission and verify data refresh.

### Groups and Calendar

- Verify `Groups` tabs return data: `All Groups`, `Externally Shared`, `No Members`.
- Verify Calendar search clear (`X`) resets input and table results.
- Verify move-event date/time controls use app-consistent picker controls and save correctly.

### Operational Checks

- Smoke test export actions (CSV + Drive) across major pages.
- Check backend logs for recurring 4xx/5xx after deploy for first 15-30 minutes.
- Record verification outcome in deployment notes (pass/fail + follow-up issues).
