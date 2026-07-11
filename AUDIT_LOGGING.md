# Audit logging

Mutations performed in the app are written to **Google Cloud Logging** for accountability.

Only **super admins** can mutate in this app; read-only traffic is not logged as audit events.

---

## What is logged

Each mutation records:

- Actor (email, name)
- Action (e.g. `user.delete`, `drive.permission.update`)
- Resource type / id
- Timestamp, IP, user agent
- Success or failure (and error message when failed)
- Before/after when available

### Typical actions

| Area | Examples |
|------|----------|
| Users | Profile update, delete, exports |
| Drive | Permission create/update/delete, external share remediation |
| Gmail | Delegation, send-as, signature templates |
| Calendar | Resource create/update/delete |
| Groups | Group and membership changes |
| Audit | Hardening exports, related privileged actions |

**Not logged:** ordinary GET/list/search (read paths).

---

## Where logs live

| Field | Value |
|-------|--------|
| Log name | `workspace-admin-audit` |
| Resource type | `global` |
| Default retention | Cloud Logging default (often 30 days) |

Local dev without `GCP_PROJECT_ID`: structured JSON to console only (not Cloud Logging).

---

## Viewing logs

### GCP Console

Logs Explorer filter examples:

```
logName="projects/YOUR_PROJECT_ID/logs/workspace-admin-audit"
jsonPayload.userEmail="admin@your-domain.com"
jsonPayload.action="user.delete"
```

### App API (CSV export)

`GET /api/audit/logs/export`

Optional query params: `startDate`, `endDate`, `userId`, `action`, `resourceType` (ISO dates).

Requires an authenticated admin session.

---

## Notes

- Log payloads can contain emails and resource IDs — treat exports as sensitive.
- Only authenticated admins can export via the API; Cloud Logging access is governed by your GCP IAM.
- Runtime SA needs `roles/logging.logWriter` (granted by bootstrap/deploy).
- Free-tier Cloud Logging is usually enough for this tool’s mutation volume.

---

## Related

- Security model: [SECURITY.md](SECURITY.md)
- Deploy (runtime SA permissions): [docs/DEPLOY.md](docs/DEPLOY.md)
