# Google Workspace Admin Management UI (WORK IN PROGRESS)

A comprehensive web-based admin tool for managing Google Workspace tenants, similar to GAM but with a modern UI. Runs entirely on GCP Cloud Run with cost-optimized architecture.

## ⚠️ Security Notice

This tool handles sensitive Google Workspace administrative operations. **All user inputs are validated and sanitized** to prevent injection attacks, XSS, and unauthorized access. The application enforces **strict domain restrictions** and **comprehensive audit logging** for all administrative actions.

## Features

- **People (users)**: View, update, and manage directory users with secure input validation (`/users`)
- **Groups**: Group creation, membership management, and permissions (`/groups`)
- **Calendar**: Calendar sharing and resource management (`/calendar`)
- **Email Delegation**: Secure delegation and send-as configuration with domain restrictions (`/email-delegation`)
- **Drive File Explorer**: Browse files, external-sharing visibility, and permission management (`/drive`)
- **Shared Drives**: Shared drive listing and permissions (`/shared-drives`)
- **Email Signatures**: Organization-wide signature templates with HTML sanitization (`/email-signatures`)
- **Security Audit**: GWS hardening checklist with compliance score and export (CSV, PDF, Drive) (`/audit`)

## Scope and Limitations (Effectiveness Evaluation)

This tool effectively replaces many GAM CLI workflows with a modern, auditable UI for core admin tasks (user/group management, Drive external sharing remediation, email delegation/signatures with sanitization, calendar resources, comprehensive security hardening/2FA audit with exports and scoring). It excels in usability for sysadmins (dense tables, filters, bulk ops, permissions gating in [EditUserDialog.tsx](frontend/src/components/EditUserDialog.tsx) and [Users.tsx](frontend/src/pages/Users.tsx)), cost (zero-scale Cloud Run stays in free tiers), and security (audit logging, validation, RBAC).

**Gaps vs. full GAM/Console**:
- No full Reports API integration (login/usage/activity logs beyond custom audit).
- No mobile device management, license/SKU assignment, Vault holds.
- Limited bulk CSV import/provisioning (UI focuses on interactive edits; backend supports more).
- Advanced Chrome OS/device policies partially covered via `chrome-policy.service.ts`.
- No real-time or scripting console.

**Recommendations**: For full GAM parity, prioritize Reports API + bulk import in future iterations. Current scope delivers high value for security-focused ops (see [GWS_HARDENING.md](GWS_HARDENING.md) and [SecurityAudit.tsx](frontend/src/pages/SecurityAudit.tsx)). Performance scales well with pagination for medium orgs; test with 10k+ users for large tenants.

## Architecture

- **Frontend**: React with TypeScript
- **Backend**: Node.js with Express and TypeScript
- **Deployment**: Single Cloud Run service (cost-optimized, now with improved ingress)
- **Authentication**: Google OAuth2 + Service Account with Domain-Wide Delegation
- **Authorization**: Any **Google Workspace admin** (super or delegated) may **sign in** and **view** directory data, reports, and read-only API data. **Mutations** (create/update/delete, Drive permission changes, Gmail delegation/send-as changes, calendar resource and event writes, exports to Drive, audit log CSV export, and similar actions) require a **Workspace super admin** (`isAdmin` in the Admin SDK). Enforcement includes **input validation**, **domain restrictions**, and **HTML sanitization** in `backend/src/services/permissions.service.ts`, `backend/src/utils/validation.ts`, and route middleware (`requireSuperAdmin`, `requirePermission`, `requireAnyAdmin`).

## Security Features

- **Input Validation**: All user inputs validated to prevent injection attacks
- **HTML Sanitization**: XSS prevention in email signatures and user profiles
- **Domain Restrictions**: Configurable domain allowlists for cross-domain operations
- **Rate Limiting**: DoS protection with configurable limits
- **Security Headers**: OWASP best practices (CSP, HSTS, XSS protection)
- **Audit Logging**: Comprehensive logging of all administrative actions
- **JWT Security**: Secure token handling with configurable secrets
- **Error Sanitization**: No sensitive information leakage in error messages

## Cost Analysis

This application is designed to run "free as possible" on GCP with cost-optimized architecture and generous free tiers.

### Free Tier Eligible Services
- **Cloud Run**: 2M requests + 400K GB-seconds + 200K vCPU-seconds/month
- **Secret Manager**: 6 secrets free (you need ~4-5 secrets)
- **Container Registry**: 5GB storage + 5GB pulls/month free
- **Cloud Logging**: 50GB logs/month free
- **Cloud Build**: 120 build-minutes/month free (for CI/CD)

### Google Workspace APIs (Generous Free Tiers)
- **Admin SDK** (Users, Groups, Org Units): 1B requests/month free
- **Drive API**: 1B requests/month free
- **Gmail API**: 1B requests/month free
- **Calendar API**: 1M requests/month free

### Estimated Monthly Costs

| Usage Level | Monthly Cost | Description |
|-------------|--------------|-------------|
| **Light** (1-2 admins, daily use) | **$0-2** | Occasional administrative sessions |
| **Moderate** (5-10 admins, regular use) | **$2-8** | Daily administrative work |
| **Heavy** (20+ admins, constant use) | **$15-50** | Continuous administrative operations |

### Cost Optimization Features
- **Zero scaling**: `--min-instances=0` eliminates idle costs completely
- **Efficient API usage**: Pagination and batching minimize API calls
- **Minimal resources**: 1Gi RAM, 1 vCPU sufficient for admin tasks
- **Streaming exports**: Large file operations don't consume excessive memory/bandwidth
- **Audit logging**: Uses Cloud Logging free tier for compliance

⚠️ **Cost Traps to Avoid:**
- API quota exceedance (very unlikely with current pagination)
- Large Drive exports (bandwidth costs ~$0.08/GB, but streaming minimizes this)
- Forgotten Cloud Run instances (auto-scaling prevents this)
- Excessive logging beyond free tier (50GB/month covers typical usage)

The app stays within GCP's free tier for most small-to-medium Google Workspace organizations!

## Setup

### Prerequisites

1. Google Cloud Project with billing enabled (free tier sufficient)
2. Google Workspace domain with admin access
3. Node.js 18+ and npm

### The fastest path

The bootstrap wizard provisions GCP (APIs, service accounts, secrets, Artifact Registry), guides the manual OAuth + domain-wide-delegation console steps, and deploys — all from Cloud Shell. Start with **[docs/DEPLOY.md](./docs/DEPLOY.md)**; you do not need to do the manual GCP setup by hand.

**Multi-domain note**: for Workspace setups with multiple domains, configure `GWS_ALLOWED_DOMAINS` to allow cross-domain operations (and sign-in) within your trusted domains.

Before deploying, run the security tests:

```bash
npm install
npm run test:security
```

### Deployment (Cloud Run — primary)

Cloud Run is the primary way to run this app. Full guide: **[docs/DEPLOY.md](./docs/DEPLOY.md)**.

**First-time / greenfield** — one command in Cloud Shell. It auto-detects your account, offers to create the project, links billing, provisions GCP, guides the OAuth + domain-wide-delegation console steps, and deploys. No flags to edit — just answer the prompts:

```bash
git clone <YOUR_REPO_URL> && cd GWS_AdminAssist && bash scripts/bootstrap-tenant.sh
```

**Ongoing deploys** — push to `main` or run GitHub Actions **Deploy to Cloud Run**. See [docs/DEPLOY.md](./docs/DEPLOY.md#2-ongoing-deploys--github-actions-recommended).

For iterating locally before deploying, see **[docs/LOCAL_DEV.md](./docs/LOCAL_DEV.md)**.

⚠️ **IMPORTANT**: Review **[SECURITY.md](./SECURITY.md)** and run `npm run test:security` before deployment to ensure all security measures are properly configured.

### Multi-Domain Configuration

For Google Workspace organizations with multiple domains:

```bash
# Add to your environment variables
GWS_ALLOWED_DOMAINS=company.com,eu.company.com,subsidiary.com
```

This allows secure cross-domain operations (delegation, sharing) within your trusted domains while maintaining security boundaries.

## Documentation

- **[docs/DEPLOY.md](./docs/DEPLOY.md)** — Cloud Run deployment: bootstrap wizard, GitHub Actions, teardown (PRIMARY)
- **[SECURITY.md](./SECURITY.md)** — Security features, OAuth setup, domain-wide delegation, and best practices (REQUIRED READING)
- **[docs/LOCAL_DEV.md](./docs/LOCAL_DEV.md)** — Local development (MSW mocks + full stack, `VITE_*` vars)
- **[docs/STAGING_TEST_SETUP.md](./docs/STAGING_TEST_SETUP.md)** — Live Workspace staging tests (`npm run test:live`, Playwright E2E)
- **[docs/ui.md](./docs/ui.md)** — UI design system (tokens, `frontend/src/components/ui/`, patterns)
- **[docs/tech-debt.md](./docs/tech-debt.md)** — Technical debt backlog and known issues
- **[GWS_HARDENING.md](./GWS_HARDENING.md)** — Hardening checks referenced by Security Audit
- **[AUDIT_LOGGING.md](./AUDIT_LOGGING.md)** — Admin mutation audit trail in Cloud Logging

## Project Structure

```
/
├── docs/              # UI notes and tech debt
├── frontend/          # React (Vite) + MUI
├── backend/           # Express API (default dev port 5001; see vite proxy)
├── Dockerfile         # Production container
└── docker-compose.yml # Local stack (backend on 5000 in compose)
```

## Contributing

We welcome contributions! Please ensure all changes maintain the security standards outlined in [SECURITY.md](./SECURITY.md).

### Development Setup
1. Follow the setup instructions above
2. Run tests: `npm run test:security`
3. Ensure security validation passes before submitting PRs

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Security

If you discover a security vulnerability, please email security concerns to the maintainers. Do not create public issues for security vulnerabilities.

## Disclaimer

This tool provides administrative capabilities for Google Workspace. Users are responsible for ensuring compliance with their organization's policies and applicable laws. Always test in a development environment before production deployment.
