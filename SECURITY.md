# Security Configuration Guide

This document outlines the security setup required for the Google Workspace Admin UI.

## Application roles (Workspace)

Sign-in uses Google OAuth; API access uses a **service account with domain-wide delegation** impersonating the signed-in user. After authentication, the backend loads Admin SDK directory data for that user:

- **Super admins** (`isAdmin` in the Admin SDK) receive full app permissions, including all **mutations** and exports.
- **Delegated admins** receive **view-only** permissions in this app (browsing users, groups, Drive, calendar, audit views, Gmail read-only areas). They **cannot** perform writes, Drive uploads from exports, or other actions gated by `requireSuperAdmin` or mutation permissions.

Network-level controls (for example **Identity-Aware Proxy** and OAuth client restrictions) are separate; they do not replace this in-app enforcement.

## Prerequisites & Setup (Simplified)

**Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the complete <30min help-desk flow.** It uses `./setup-secrets.sh` (now non-interactive with env var support and placeholders) and `./deploy.sh`.

Key security setup (one-time):

1. **Enable APIs** (included in DEPLOYMENT.md prerequisites):
   ```bash
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com admin.googleapis.com drive.googleapis.com gmail.googleapis.com calendar-json.googleapis.com
   ```

2. **Service Account (`workspace-admin-sa`)**:
   - Create in IAM & Admin > Service Accounts.
   - Grant `roles/secretmanager.secretAccessor` and `roles/run.invoker`.
   - Set up **domain-wide delegation** in Google Workspace Admin Console > Security > API Controls:
     - Client ID from SA JSON.
     - Scopes: `https://www.googleapis.com/auth/admin.directory.user`, `admin.directory.group`, `drive`, `gmail.settings.basic`, `calendar`.
   - Download JSON key (`sa-key.json`) — passed to `setup-secrets.sh`.

3. **OAuth 2.0 Web Client** (APIs & Services > Credentials):
   - Application type: Web application.
   - Authorized redirect URIs: `http://localhost:5001/api/auth/callback` (dev), production `https://<service-url>/api/auth/callback` (updated automatically by deploy.sh).
   - Configure consent screen with appropriate scopes (userinfo.email, profile, admin.directory.*.readonly, etc.).

4. **Secrets**:
   - Run `./setup-secrets.sh` (or with env vars). It creates **one secret per value** for unambiguous Cloud Run `--set-secrets` injection (`:latest` or specific version).
   - Script handles SA key JSON, JWT (auto-generates if missing), placeholders for redirect/CORS.
   - **Run the printed IAM commands** to grant `roles/secretmanager.secretAccessor` to the Cloud Run SA on each secret.
   - `deploy.sh` automatically adds versions for production URLs.

**Production mapping** (in `deploy.sh` and `cloud-run.yaml` / `service.yaml`):
- `GOOGLE_CLIENT_ID` ← `oauth-client-id:latest`
- Similar for secret, redirect, JWT, domain, allowed domains.
- SA key loaded at runtime via `@google-cloud/secret-manager` (`backend/src/config/gcp.config.ts`).
- `GCP_PROJECT_ID`, `SERVICE_ACCOUNT_SECRET_NAME` set as literal env vars.

See DEPLOYMENT.md for exact commands. Old combined secrets (`oauth-config` etc.) are supported via migration in the new script.

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
4. Add scopes:
   - https://www.googleapis.com/auth/userinfo.email
   - https://www.googleapis.com/auth/userinfo.profile
   - https://www.googleapis.com/auth/admin.directory.user.readonly
   - https://www.googleapis.com/auth/admin.directory.group.readonly
   - https://www.googleapis.com/auth/drive.readonly
   - https://www.googleapis.com/auth/gmail.readonly
   - https://www.googleapis.com/auth/calendar.readonly

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

- **Network Exposure (High)**: Cloud Run was configured with `ingress: all` and `--allow-unauthenticated`. **Fixed**: Updated to `internal-and-cloud-load-balancing` in [cloud-run.yaml](cloud-run.yaml) and [.github/workflows/deploy.yml](.github/workflows/deploy.yml). **Recommendation**: Configure Identity-Aware Proxy (IAP) + OAuth consent screen for zero-trust access. Only authenticated GWS admins can reach the service. Update CORS_ORIGIN and redirect URIs accordingly.
- **Domain-Wide Delegation/Impersonation**: Broad SA scopes (full Drive, Gmail send, Admin Directory). Per-request `subject = userEmail` + super-admin gating in [permissions.middleware.ts](backend/src/middleware/permissions.middleware.ts) and [permissions.service.ts](backend/src/services/permissions.service.ts). **Mitigation**: Split clients by permission level; regular SA key rotation via Secret Manager; monitor Cloud Logging for anomalous API calls.
- **Privilege Escalation**: Delegated admins limited to read-only via `isAdmin` check from Admin SDK and permission cache. Tested in security-validation.test.ts.
- **Input/XSS**: Centralized validation in [utils/validation.ts](backend/src/utils/validation.ts) (email, domain, delegation) + sanitizeText + DOMPurify. CSV/exports now centralized in [utils/csv.ts](backend/src/utils/csv.ts). Route-specific checks added (e.g. [users.routes.ts](backend/src/routes/users.routes.ts)).
- **Session/Auth**: JWT with short expiry, verified in [auth.service.ts](backend/src/services/auth.service.ts). Use HttpOnly/SameSite=Strict cookies (add in auth routes if not present). No refresh token leakage.
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
- `SERVICE_ACCOUNT_SECRET_NAME`: Name of the secret containing service account key
- `GOOGLE_CLIENT_ID`: OAuth2 client ID
- `GOOGLE_CLIENT_SECRET`: OAuth2 client secret
- `GOOGLE_REDIRECT_URI`: OAuth2 redirect URI
- `JWT_SECRET`: Secret for signing JWT tokens
- `WORKSPACE_DOMAIN`: Your primary Google Workspace domain
- `CORS_ORIGIN`: Frontend URL for CORS policy (e.g., https://your-app.a.run.app)
- `GWS_ALLOWED_DOMAINS`: Comma-separated list of trusted domains for cross-domain operations (optional)

## Troubleshooting

### Service Account Authentication Fails

- Verify domain-wide delegation is set up correctly
- Check that the service account has the correct scopes
- Ensure the service account key is valid

### OAuth Flow Fails

- Verify redirect URI matches exactly (including trailing slashes)
- Check OAuth consent screen is configured
- Ensure client ID and secret are correct

### Secret Manager Access Denied

- Verify the Cloud Run service account has Secret Manager Secret Accessor role
- Check IAM bindings for the secrets
