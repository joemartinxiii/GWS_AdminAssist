# Technical debt (committed snapshot)

Living notes for contributors. Local session files may mirror or extend this.

## Open

- **Users:** Suspend flag sometimes returns true on PATCH but GET still false for some accounts — Directory API investigation.
- **Security Audit:** Optional immutable run history; optional “agreed remediation” status separate from waive.
- **Structure:** Large page components (Drive, Users, Calendar, Groups) — extract hooks when heavily touched.
- **CI:** If deploy logs show a NOTE about enabling APIs, re-run `scripts/setup-github-ci.sh` so the deploy SA has `serviceusage.serviceUsageAdmin` (and `secretVersionAdder`).

## Product roadmap (not debt — planned upgrades)

### V2 — Offboarding builder (Jones IT–style playbooks)

Per-client **templates** + **runs**. Steps: auto (Workspace API), guided (Admin deep link + mark done), external (Okta/ASM/ticket URL). **Gates** enforce order (e.g. Drive transfer + mbox/Vault evidence complete before delete; delete before add alias under manager). Export run for evidence. See session notes / todos for detail.

### V3 — Multi-tenant MSP portal

One app instance (Jones IT side) with a **tenant switcher**: many client Workspace orgs, each with own DWD SA / secrets / allowlist / offboarding templates / audit state. Not “one OAuth into every customer without setup” — each client still installs DWD once; the portal stores tenant config and routes API calls per selected client.

## Recently addressed

- Deploy primetime: shared `deploy-from-image.sh` for CI / Cloud Shell / local Docker; OAuth redirect pin; WIF-first GitHub setup; go-live checklist.
- Protected deletes: env-only `GWS_PROTECTED_USERS` (no hard-coded tenant emails).
- Security Audit: cloud last-run + durable waivers, preflight on Policy 429, severity + client-facing recs.
- Users: OU column, Suspended label, list alignment, delete with protected accounts.
- Drive / Shared drives: permissions layout (Access column, trailing actions), member counts, consistent action icons.
- Resizable columns on all data tables (localStorage).
