# Technical Debt Backlog

This document tracks non-blocking improvements that raise product quality, reliability, and operator efficiency.

## Completed — 2026-07-07 tech-debt pass

- **Security audit no longer auto-runs** — the audit was re-running on every mount (SPA nav / refresh), which could transiently flip Policy-API checks to "manual" and reset the score. It now runs only on the explicit **Run audit** button; results are cached per tab (`sessionStorage`) so navigating back or refreshing restores the last run. Empty state prompts a first run. (`frontend/src/pages/SecurityAudit.tsx`)
- **Manage Permissions external mis-classification FIXED** — dropped the client-side `WORKSPACE_DOMAIN = … || 'example.com'` default. `/api/auth/me` now returns the authoritative `allowedDomains` (WORKSPACE_DOMAIN + GWS_ALLOWED_DOMAINS ∪ signed-in user's domain); the modal classifier consumes it, honors the multi-domain allowlist, skips `role: owner`, and does not flag when the list is unknown. (`backend/src/routes/auth.routes.ts`, `frontend/src/services/auth.service.ts`, `frontend/src/pages/Drive.tsx`)
- **Dialog pagination suppressed on tiny lists** — `DialogListPagination` now hides entirely when the list fits within the smallest page size (kills the "Rows per page … 1–2 of 2" chrome on 2-row modals, e.g. Drive permissions + Shared Drives). (`frontend/src/components/ui/DialogListPagination.tsx`)
- **Dependency vulnerabilities reduced** — non-breaking `npm audit fix` at the workspace root: 29 → 19 vulnerabilities, **both criticals cleared** (remaining 19 = 12 moderate / 7 high need breaking `--force` upgrades; see below).
- **Unused-var lint warnings pruned to zero** — removed dead `Request` imports (`middleware/audit.middleware.ts`, `middleware/request.middleware.ts`), `startTime` (audit middleware), and `totalProcessed`/`progressCallback` (`routes/drive.routes.ts`). Backend lint now emits only `no-explicit-any` warnings.
- **Calendar search-clear verified working (stale item)** — both the user-search (`handleClearUserSearch`) and table-search (`setTableSearchTerm('')`) clear controls are correctly wired to controlled inputs + the filter memo (recomputes on `tableSearchTerm`). No code change needed; the earlier report predates a prior fix.

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
- **Dependency vulnerabilities (`npm audit`) — remaining breaking upgrades.** After the 2026-07-07 non-breaking `npm audit fix` (29 → 19, criticals cleared), **19 remain (12 moderate, 7 high)** that only resolve via `npm audit fix --force` (breaking major bumps). Needs a deliberate pass with build/test verification per upgrade. Includes deprecated transitive deps (`glob@7/10`, `rimraf@3`, `inflight`, `@humanwhocodes/*`) and **`eslint@8.57.1` (end-of-life)** — bump ESLint to a supported v9 line with flat config (own mini-project; do separately).
- **Lint warnings (`@typescript-eslint/no-explicit-any`).** Unused-var warnings are now **zero** (pruned 2026-07-07). ~211 `no-explicit-any` warnings remain (0 errors), dominated by googleapis client casts across `routes/*` and `services/*`. Introduce typed wrappers for the Google API clients (or narrow response types) to drive the count toward zero. Low value / high churn — do incrementally.

## Deployed Bug Backlog (Triage Required)

These are reported from deployed runtime behavior. **Re-triaged 2026-07-07:** several predate recent fixes. The frontend wiring for each was code-reviewed and is correct — the remaining unknowns are runtime/data (backend responses against real Workspace data + DWD scopes), which require a deployed environment to diagnose. Do not "fix" these blind.

### Calendar

- ✅ **RESOLVED (stale).** Search clear (`X`) is correctly wired for both the user-search and table-search inputs and refreshes results via the filter memo. Verified 2026-07-07.

### Groups

- ⚠️ **Needs live verification (wiring confirmed correct).** "Externally Shared" fetches `GET /groups/with-external-members` on tab select; "No Members" derives from `directMembersCount === 0`. If either shows empty, check: (a) the backend endpoint's response against real data, and (b) whether the Directory API populates `directMembersCount` in this tenant.
  - Area: `backend/src/routes/groups.routes.ts` + `services/groups.service.ts` (data), not the client filter.

### Email Delegation

- ⚠️ **Likely resolved — re-test.** `POST /api/gmail/{userEmail}/delegations` returned `403` because Gmail calls impersonated the wrong subject. `gmail.service.ts` was rewritten (2026-07-06) to impersonate the target mailbox owner (`gmailForMailbox` + `userId: 'me'`), which should fix any-direction delegation. Confirm in deployed env; also verify DWD scopes `gmail.settings.sharing` + `gmail.settings.basic`.

### Drive File Explorer

- ⚠️ **Partially superseded.** "All Files" was replaced by the on-demand **Drive Search** tab; "External Shares"/"Public Links" now use the async Cloud Run scan (Run scan → GCS report). If tabs are empty: for search, confirm a query is entered + Directory/Drive scopes; for audit tabs, confirm the scan job ran and the GCS report exists.
  - Area: `frontend/src/pages/Drive.tsx`, `backend/src/routes/drive.routes.ts` + `jobs/externalScan.ts`.

### Shared Drives

- ⚠️ **Needs live verification.** Details/permissions dialog reportedly returns no members.
  - Area: `frontend/src/pages/SharedDrives.tsx`, backend shared-drive permissions endpoints. Check the permissions response payload + `supportsAllDrives`/`useDomainAdminAccess` handling against real shared drives.

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

### Manage Permissions modal (observed 2026-07-07, deployed)

- ✅ **Mis-classification FIXED (2026-07-07).** The modal no longer defaults to `example.com`. `/api/auth/me` returns the authoritative `allowedDomains`; `isPermissionExternal(perm, allowedDomains)` honors the multi-domain allowlist, skips `role: owner`, and doesn't flag when the list is unknown.
- ✅ **Tiny-list pagination FIXED (2026-07-07).** `DialogListPagination` hides under one page.
- ⏳ **Remaining layout polish (low-medium):**
  - Delete (trash) icon renders inside the `EXTERNAL` column and appears on only some rows; edit (pencil) vs. delete affordances are inconsistent per row.
  - The add-permission `+` control sits alone in a full-width table row with no label — reads as unstyled.
  - `EXTERNAL` column + colored dot is redundant with role/access info and adds horizontal noise; consider merging into the access cell.

Area: `frontend/src/pages/Drive.tsx` (permissions dialog).

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
