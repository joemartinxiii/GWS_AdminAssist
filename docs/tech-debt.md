# Technical debt (committed snapshot)

Living notes for contributors. Local session files (`todos.md`, root `tech-debt.md`) may extend this and are often gitignored.

## Open

- **Users:** Suspend flag sometimes returns true on PATCH but GET still false for some accounts — Directory API investigation.
- **Security Audit:** Optional immutable run history; optional “agreed remediation” status separate from waive.
- **Structure:** Large page components (Drive, Users, Calendar, Groups) — extract hooks when heavily touched.

## Product roadmap (not debt)

### V2 — Offboarding builder

Per-client **templates** + **runs**. Steps: auto (Workspace API), guided (Admin deep link + mark done), external (ticket/IdP URL). **Gates** enforce order (e.g. evidence before delete). Export run for evidence.

### V3 — Multi-tenant MSP portal

One app instance with a **tenant switcher**: many client Workspace orgs, each with own DWD SA / secrets / allowlist / templates / audit state. Each client still installs DWD once; the portal stores tenant config and routes API calls.

## Recently addressed

- Deploy shared path + CI Secret Manager preflight (`secretmanager.viewer`); WIF-first CI.
- Docs pass: SECURITY, HARDENING, AUDIT_LOGGING, LOCAL_DEV, deploy guide split.
- Protected deletes via `GWS_PROTECTED_USERS` only (no hard-coded emails).
- Security Audit durable last-run/waivers; Drive/Shared Drives list polish; resizable columns.
