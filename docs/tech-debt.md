# Technical Debt Backlog

This document tracks non-blocking improvements that raise product quality, reliability, and operator efficiency.

## UX Interaction Polish (No Visual Redesign)

### Context

The UI style is finalized. Remaining quality gaps are interaction-focused: keyboard efficiency, form focus behavior, and message consistency. The goal is to make admin workflows feel faster and more professional without changing visual design tokens, layout, or component styling.

### Scope

- Dialog and inline form keyboard flow
- Smart focus management (open, validate, close)
- Consistent snackbar/toast message patterns
- Accessibility-oriented focus behavior
- Calendar date/time picker consistency with app UI

### Constraints

- Do not alter established UI look and feel
- Do not redesign component hierarchy
- Preserve existing role gating and permissions behavior

### Work Plan

#### Phase 1 - Standards

- Define shared interaction rules:
  - Enter submits valid forms
  - Enter advances focus when appropriate
  - Shift+Enter reserved for multiline fields
  - Escape closes dialogs when safe
- Define message tone and severity policy:
  - success, warning (partial), error, info

#### Phase 2 - Shared Helpers

- Add reusable helpers/hooks:
  - dialog focus open/restore behavior
  - focus-first-invalid utility
  - standardized API error extraction
  - standardized toast copy helpers

#### Phase 3 - High-Impact Pages

- `frontend/src/pages/Calendar.tsx`
  - refine Enter-to-submit in edit/add-attendees/move/transfer flows
  - enforce mode-specific autofocus and validation focus
  - replace native `datetime-local` interaction with a UI-consistent date/time selection pattern that matches app tokens and dialog chrome
  - ensure date/time popover and controls follow existing component styling conventions in `docs/ui.md`
- `frontend/src/pages/EmailDelegation.tsx`
  - first-input autofocus and Enter progression
  - submit-on-enter when valid
- `frontend/src/pages/Groups.tsx`
  - inline add-member keyboard submission
  - validation focus and clearer partial-success messaging
- `frontend/src/pages/Drive.tsx`
  - add-permission keyboard flow and autofocus by permission type
- `frontend/src/pages/SharedDrives.tsx`
  - mirror permission dialog behavior and message consistency

#### Phase 4 - Messaging Consistency Sweep

- Standardize message templates across:
  - `Users`, `Groups`, `Drive`, `SharedDrives`, `Calendar`, `EmailDelegation`, `SecurityAudit`
- Normalize export wording and failure guidance

#### Phase 5 - QA and Accessibility

- Verify:
  - tab order and Enter behavior
  - validation focus movement
  - focus restore to trigger after close
  - severity correctness for partial failures
  - no keyboard traps in dialogs

### Acceptance Criteria

- Operators can complete all common dialog flows without mouse-only steps
- First invalid field is focused after validation failures
- Toast messages are consistent in structure and severity
- No visual regressions in page styling
- Calendar move/edit date selectors visually match established UI system (no browser-native picker chrome)

### Priority

High (operator productivity and perceived quality)

### Estimated Effort

4-6 hours total implementation + verification.

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
  - Request: `POST /api/gmail/{userEmail}/delegations`
  - Example observed: `POST https://workspace-admin-jevytnm5qa-uc.a.run.app/api/gmail/joe%40befree.wtf/delegations` -> `403`
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

Discovered during 2026-05-19 live testing. Not blocking but degrades UX.

### Confirm dialogs

Several Drive actions still use `window.confirm()` which is a browser-native modal and inconsistent with app UX:
- `handleDeletePermission` (`Drive.tsx`) — single permission delete
- `handleBulkRemovePermissions` (`Drive.tsx`) — bulk permission delete
- `handleBulkRemoveExternalShares` (`Drive.tsx`) — bulk external share removal

Replace with MUI `<Dialog>` confirmation modal (consistent with the rest of the app).

### Remaining `alert()` calls in Drive.tsx

- `handleUpdatePermission` — uses `alert()` on failure; replace with `setSnackbar`
- `handleOpenPermissionDialogForReport` — uses `alert()` on failure; replace with `setSnackbar`

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
