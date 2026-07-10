# GWS Admin Assist

A web admin console for **Google Workspace** — built for MSPs and IT admins who need day-to-day user, Drive, mail, and security work without living in GAM or ten Admin Console tabs.

Runs on **GCP Cloud Run** with free-tier-friendly design (no always-on servers, no paid database for core features).

---

## What it does

| Area | What you get |
|------|----------------|
| **People** | Directory users, OU, status, 2FA overview, edit, suspend, delete (with protected accounts) |
| **Groups** | Create, membership, roles |
| **Drive** | Org search, trash, external/public sharing audit, file permissions |
| **Shared drives** | Inventory, sharing risk, members |
| **Email** | Delegation (owner → delegate), org signature templates |
| **Calendar** | Resources and sharing helpers |
| **Security audit** | Hardening baseline with severity, client-facing guidance, durable waivers, last run in free-tier GCS |

**Sign-in:** any Workspace admin can view. **Changes** (create/update/delete, Drive remediations, exports to Drive, audit run/waive) require a **super admin**.

---

## Quick start

### Deploy to Cloud Run (recommended)

Full walkthrough: **[docs/DEPLOY.md](docs/DEPLOY.md)**

```bash
git clone https://github.com/joemartinxiii/GWS_AdminAssist
cd GWS_AdminAssist
bash scripts/bootstrap-tenant.sh
```

That provisions GCP, walks OAuth + domain-wide delegation, and deploys. Ongoing updates: push to `main` (GitHub Actions) or re-run the deploy path in the deploy guide.

### Local development

See **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)** (mock UI with MSW, or full stack against a real tenant).

### Before you go live

1. Read **[SECURITY.md](SECURITY.md)** (OAuth, domain-wide delegation, scopes).
2. Run `npm install && npm run test:security`.

---

## Documentation

Start here when you need something specific:

| Doc | For |
|-----|-----|
| **[docs/README.md](docs/README.md)** | Full documentation map |
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Production deploy, CI, teardown |
| **[SECURITY.md](SECURITY.md)** | Auth, DWD, hardening of the app itself |
| **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)** | Develop on your machine |
| **[docs/STAGING_TEST_SETUP.md](docs/STAGING_TEST_SETUP.md)** | Live/API and Playwright tests |
| **[docs/ui.md](docs/ui.md)** | UI patterns for contributors |
| **[GWS_HARDENING.md](GWS_HARDENING.md)** | Security Audit checklist reference |

Reference / deeper notes: [AUDIT_LOGGING.md](AUDIT_LOGGING.md), [docs/tech-debt.md](docs/tech-debt.md).

---

## Multi-domain tenants

Set trusted domains (comma-separated) so admins can work across your customer’s domains:

```bash
GWS_ALLOWED_DOMAINS=company.com,eu.company.com,subsidiary.com
```

Sign-in still prefers the **primary** domain admin where possible.

---

## Stack (short)

- **Frontend:** React, TypeScript, MUI, Vite  
- **Backend:** Node.js, Express, TypeScript  
- **Auth:** Google OAuth (identity) + domain-wide delegation for Workspace APIs  
- **Host:** Cloud Run + Secret Manager; optional GCS for Drive scan + Security Audit state  

---

## Contributing

Match existing UI patterns ([docs/ui.md](docs/ui.md)) and security rules ([SECURITY.md](SECURITY.md)). Run `npm run test:security` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).

## Security reports

Report vulnerabilities privately to the maintainers. Do not open public issues for security bugs.
