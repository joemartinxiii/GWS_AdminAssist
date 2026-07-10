# Technical debt (committed snapshot)

Living notes for contributors. Local session files may mirror or extend this.

## Open

- **Users:** Suspend flag sometimes returns true on PATCH but GET still false for some accounts — Directory API investigation.
- **Security Audit:** Optional immutable run history; optional “agreed remediation” status separate from waive.
- **Structure:** Large page components (Drive, Users, Calendar, Groups) — extract hooks when heavily touched.
- **CI:** If deploy logs show a NOTE about enabling APIs, re-run `scripts/setup-github-ci.sh` so the deploy SA has `serviceusage.serviceUsageAdmin`.

## Recently addressed

- Security Audit: cloud last-run + durable waivers, preflight on Policy 429, severity + client-facing recs.
- Users: OU column, Suspended label, list alignment, delete with protected accounts.
- Drive / Shared drives: permissions layout (Access column, trailing actions), member counts, consistent action icons.
