# Security Configuration Guide

This document outlines the security setup required for the Google Workspace Admin UI.

## Application roles (Workspace)

Sign-in uses Google OAuth; API access uses a **service account with domain-wide delegation** impersonating the signed-in user. After authentication, the backend loads Admin SDK directory data for that user. The UI now shows a clear role badge (green "Super Admin (Full Access)" or orange "Delegated Admin (View Only)") in the top-right user menu:

- **Super admins** (`isAdmin` in the Admin SDK) receive full app permissions, including all **mutations** and exports.
- **Delegated admins** receive **view-only** permissions in this app (browsing users, groups, Drive, calendar, audit views, Gmail read-only areas). They **cannot** perform writes, Drive uploads from exports, or other actions gated by `requireSuperAdmin` or mutation permissions. This is the most common source of "what I can and cannot do" in production.

**Error messages** have been improved to provide actionable guidance for Secret Manager, IAM, and delegation issues (see Troubleshooting below). Network-level controls (for example **Identity-Aware Proxy** and OAuth client restrictions) are separate; they do not replace this in-app enforcement.

## Copy-paste scope strings (full URLs, comma-delimited)

Use **no spaces** after commas. Some UIs accept one line; others let you add scopes one-by-one (split on commas).

**Google Cloud — OAuth consent screen** (APIs & Services → OAuth consent screen → add scopes):

```
https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/userinfo.profile,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.readonly
```

**Google Workspace Admin — domain-wide delegation** (admin.google.com → Security → API controls → Domain-wide delegation). Use the **`client_id`** from the **service account JSON** (not the OAuth web client ID). Scopes must match `backend/src/config/google.config.ts` and [`scripts/lib/scopes.sh`](scripts/lib/scopes.sh) (`getServiceAccountClient`):

```
https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.user.security,https://www.googleapis.com/auth/apps.security,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/admin.directory.resource.calendar,https://www.googleapis.com/auth/chrome.management.policy
```

Enable the Chrome Policy API in GCP if you use the last scope (`gcloud services enable chromepolicy.googleapis.com`).

## Prerequisites & Setup (Simplified)

**Follow [docs/DEPLOY.md](docs/DEPLOY.md) for the complete deploy flow** — the bootstrap wizard automates most of the steps below. This section documents what happens under the hood for security review.

Key security setup (one-time):

1. **Enable APIs** (done automatically by the bootstrap wizard):
   ```bash
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com admin.googleapis.com drive.googleapis.com gmail.googleapis.com calendar-json.googleapis.com
   ```

2. **Service Account (`workspace-admin-sa`)**:
   - Create in IAM & Admin > Service Accounts.
   - Grant `roles/secretmanager.secretAccessor`, `roles/run.invoker`, and `roles/logging.logWriter` (for audit logging).
   - Set up **domain-wide delegation** in Google Workspace Admin Console > Security > API Controls:
     - **Client ID**: numeric `client_id` from the service account JSON key (not the OAuth web client).
     - **OAuth scopes (comma-delimited)**: paste the **domain-wide delegation** single line from the **Copy-paste scope strings** section at the top of this file.
   - Download JSON key (`sa-key.json`) — passed to `setup-secrets.sh`.
   - **Cloud Build permission** (common with `--source .`): The default compute service account must have `roles/storage.objectViewer`. The deploy scripts grant this automatically. See [docs/DEPLOY.md](docs/DEPLOY.md) if it fails.

3. **OAuth 2.0 Web Client** (APIs & Services > Credentials):
   - Application type: Web application.
   - Authorized redirect URIs: `http://localhost:5001/api/auth/callback` (dev), production `https://<service-url>/api/auth/callback` (updated automatically by deploy.sh).
   - Configure consent screen: paste the **OAuth consent screen** comma-delimited line from the **Copy-paste scope strings** section at the top of this file (or add scopes one-by-one by splitting on commas).

4. **Secrets**:
   - Run `./setup-secrets.sh` (or with env vars). It creates **one secret per value** for unambiguous Cloud Run `--set-secrets` injection (`:latest` or specific version).
   - Script handles OAuth client id/secret, JWT (auto-generates if missing), placeholders for redirect/CORS. No SA key — auth is keyless.
   - **Run the printed IAM commands** to grant `roles/secretmanager.secretAccessor` to the Cloud Run SA on each secret.
   - `deploy.sh` automatically adds versions for production URLs.

**Production mapping** (in `scripts/deploy-cloudshell.sh` and `.github/workflows/deploy.yml`):
- `GOOGLE_CLIENT_ID` ← `oauth-client-id:latest`
- Similar for secret, redirect, JWT, domain, allowed domains.
- **Keyless domain-wide delegation** — no service-account key is stored. Cloud Run runs as the runtime SA, which signs its own delegation tokens via the IAM Credentials API (`signJwt`). Requires `roles/iam.serviceAccountTokenCreator` on the SA itself + `iamcredentials.googleapis.com` enabled (`backend/src/config/google.config.ts`).
- `GCP_PROJECT_ID`, `SERVICE_ACCOUNT_EMAIL` set as literal env vars.

See [docs/DEPLOY.md](docs/DEPLOY.md) for exact commands.

## Application Roles & Permissions

```bash
gcloud iam service-accounts create workspace-admin-sa \
  --display-name="Workspace Admin Service Account" \
  --project=YOUR_PROJECT_ID

# Grant necessary permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:workspace-admin-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 8: Configure OAuth Consent Screen

1. Go to APIs & Services > OAuth consent screen
2. Choose "Internal" (for Workspace users) or "External"
3. Fill in required information
4. Add scopes — copy the **OAuth consent screen** comma-delimited line from the **Copy-paste scope strings** section at the top of this file (split on commas if the UI adds scopes one at a time):

```
https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/userinfo.profile,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.readonly
```

## Security Features Implemented

This tool implements comprehensive security measures to protect your Google Workspace environment:

### Input Validation & Sanitization
- **Email validation**: All email inputs validated for format and length
- **Domain restrictions**: Configurable domain allowlists prevent cross-domain attacks
- **HTML sanitization**: Email signatures sanitized to prevent XSS attacks
- **Text escaping**: User profile fields escaped to prevent injection

### Authentication & Authorization
- **JWT security**: Secure token handling with configurable secrets
- **Role-based access**: Super admin vs delegated admin permissions
- **Session security**: HttpOnly cookies and secure token storage

### Production Security
- **Security headers**: CSP, HSTS, XSS protection, and referrer policy
- **Rate limiting**: 100 requests/15min general, 10 requests/15min sensitive operations
- **Error sanitization**: Production errors don't leak sensitive information
- **Audit logging**: Comprehensive logging of all administrative actions

### Multi-Domain Support
For Google Workspace organizations with multiple domains:

```bash
# Allow cross-domain operations within trusted domains
GWS_ALLOWED_DOMAINS=company.com,eu.company.com,subsidiary.com
```

This enables secure delegation and sharing between domains while maintaining security boundaries.

### Attack Surface Protection

The tool protects against these specific attack vectors:

| Attack Vector | Protection | Location |
|---------------|------------|----------|
| **Email delegation injection** | Email validation + domain restrictions | Gmail delegation endpoint |
| **Drive permission injection** | Email validation + domain allowlists | Drive permissions endpoint |
| **HTML injection in signatures** | DOMPurify sanitization | Email signature templates |
| **User profile XSS** | Text escaping + input validation | User profile updates |
| **Group membership injection** | Email validation | Group management |
| **Unauthorized external sharing** | Domain restrictions | File permission management |

### Threat Model

**Key Risks and Mitigations** (evaluated as seasoned security engineer):

- **Network Exposure (High)**: Cloud Run is deployed with `--allow-unauthenticated` + `--no-invoker-iam-check` (see [.github/workflows/deploy.yml](.github/workflows/deploy.yml) and [scripts/deploy-cloudshell.sh](scripts/deploy-cloudshell.sh)) because common org policies block `allUsers` invoker IAM bindings. Access control is therefore enforced at the **application layer**: Google OAuth sign-in, a login-time Workspace-admin + allowed-domain gate, and per-request super-admin/role checks. CORS is locked to `CORS_ORIGIN` in production. **Recommendation**: For zero-trust network isolation, front the service with an external HTTPS Load Balancer + Identity-Aware Proxy (IAP) and restrict ingress to `internal-and-cloud-load-balancing`.
- **Domain-Wide Delegation/Impersonation**: Broad SA scopes (full Drive, Gmail send, Admin Directory). Per-request `subject = userEmail` + super-admin gating in [permissions.middleware.ts](backend/src/middleware/permissions.middleware.ts) and [permissions.service.ts](backend/src/services/permissions.service.ts). **Mitigation**: Split clients by permission level; regular SA key rotation via Secret Manager; monitor Cloud Logging for anomalous API calls.
- **Privilege Escalation**: Delegated admins limited to read-only via `isAdmin` check from Admin SDK and permission cache. Tested in security-validation.test.ts.
- **Input/XSS**: Centralized validation in [utils/validation.ts](backend/src/utils/validation.ts) (email, domain, delegation) + sanitizeText + DOMPurify. CSV/exports now centralized in [utils/csv.ts](backend/src/utils/csv.ts). Route-specific checks added (e.g. [users.routes.ts](backend/src/routes/users.routes.ts)).
- **Session/Auth**: JWT with short expiry, verified in [auth.service.ts](backend/src/services/auth.service.ts). A **login-time gate** in [auth.routes.ts](backend/src/routes/auth.routes.ts) rejects any account that is not a Workspace admin in an allowed domain before a session is issued. OAuth callback tokens are returned in the URL **fragment** (`#`, never sent to servers/logs) rather than the query string. The `/health` endpoint returns only `{ status, timestamp }` and discloses no configuration.
- **Error/Info Leak**: Global [error.middleware.ts](backend/src/middleware/error.middleware.ts) sanitizes in prod. Route catches updated to avoid leaking Google SDK details.
- **Deps/Supply Chain**: 20 vulns identified via `npm audit` (mostly dev deps like eslint/minimatch, some google-cloud). Add `npm audit fix`, Dependabot, Trivy in CI. Pin versions.
- **Bulk Mutations**: Gated by `requireSuperAdmin` + auditLog middleware. Add JIT approval for high-risk (e.g. mass Drive changes) in future.
- **Other**: Rate limiting, CSP (with MUI unsafe-inline note), no DB so no SQLi. Regular pentests recommended.

**Overall Posture**: Strong for GWS admin tool; network and dep updates significantly improve it. See [GWS_HARDENING.md](GWS_HARDENING.md) for compliance scoring.

### Security Testing

Run security tests to verify all protections are working:

```bash
# Test security validations
npm run test:security

# Test all backend functionality
npm run test:backend
```

## Security Best Practices

1. **Never commit secrets**: All secrets are stored in Secret Manager
2. **Use least privilege**: Service accounts have minimal required permissions
3. **Enable audit logging**: Monitor API access in GCP with comprehensive mutation logging
4. **Regular rotation**: Rotate JWT secrets and OAuth credentials periodically
5. **HTTPS only**: Cloud Run enforces HTTPS with security headers (CSP, HSTS, XSS protection)
6. **CORS**: Configure CORS to allow only your domain
7. **Rate limiting**: Implement rate limiting (100 req/15min general, 10 req/15min sensitive operations)
8. **Input validation**: All user inputs validated with email format checking, domain restrictions, and HTML sanitization
9. **Domain restrictions**: Configure `GWS_ALLOWED_DOMAINS` for multi-domain Workspace setups
10. **Error sanitization**: Production errors don't leak sensitive information

## Environment Variables

Required environment variables (stored as secrets):

- `GCP_PROJECT_ID`: Your GCP project ID
- `SERVICE_ACCOUNT_EMAIL`: The runtime service account the app impersonates as for keyless domain-wide delegation (e.g. `workspace-admin-sa@<project>.iam.gserviceaccount.com`). If unset, inferred from Application Default Credentials.
- `GOOGLE_CLIENT_ID`: OAuth2 client ID
- `GOOGLE_CLIENT_SECRET`: OAuth2 client secret
- `GOOGLE_REDIRECT_URI`: OAuth2 redirect URI
- `JWT_SECRET`: Secret for signing JWT tokens
- `WORKSPACE_DOMAIN`: Your primary Google Workspace domain
- `CORS_ORIGIN`: Frontend URL for CORS policy (e.g., https://your-app.a.run.app). In production, if unset the app enforces same-origin.
- `GWS_ALLOWED_DOMAINS`: Comma-separated list of trusted domains for cross-domain operations. Also enforced by the **login-time gate** — sign-in is rejected unless the user's email domain is in this list (or `WORKSPACE_DOMAIN`) **and** they hold a Workspace admin role.
- `SIGNATURE_TEMPLATE_BUCKET` *(optional)*: GCS bucket for durable persistence of the org signature template. Without it, the template is stored on ephemeral local disk and is lost on redeploy. The deploy script provisions the bucket and grants the runtime SA `roles/storage.objectAdmin` when this is exported.

## Troubleshooting

The UI now displays a **role badge** (green "Super Admin (Full Access)" or orange "Delegated Admin (View Only)") in the top-right user menu. Permission fetch and middleware now return **detailed, actionable error messages** for prod issues (Secret Manager, domain-wide delegation, IAM). Check Cloud Run logs with:
```bash
gcloud beta run services logs tail workspace-admin --region us-central1
# Or (all gcloud versions):
gcloud run services logs read workspace-admin --region us-central1 --limit 200
```

### Service Account / Permissions / "What I Can and Cannot Do" Fails (Most Common)

- **Delegated vs Super Admin**: If badge shows "Delegated Admin (View Only)", mutations are intentionally blocked (see Application Roles section). Use a true Super Admin account.
- Verify domain-wide delegation scopes **exactly** match SECURITY.md (copy-paste, no extra spaces/commas) using SA `client_id` in GWS Admin Console > Security > API controls.
- Re-run `./setup-secrets.sh <project>` and all printed IAM commands. SA must have Secret Manager access on **every** secret.
- Check for 403s on `users.get()` or SA init in logs.

### OAuth Flow Fails

- Verify redirect URI matches **exactly** (including trailing slashes, no query params) in GCP Console (use the one printed by `./deploy.sh`).
- Check OAuth consent screen is configured with readonly scopes.
- Ensure `GOOGLE_CLIENT_ID`/`SECRET` are in Secret Manager.

### Secret Manager Access Denied

- Verify the Cloud Run service account (`workspace-admin-sa`) has `roles/secretmanager.secretAccessor` on each secret (re-apply IAM from setup script).
- Confirm `GCP_PROJECT_ID`, secret versions (`:latest`), and env vars in Cloud Run service.
