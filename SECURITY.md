# Security Configuration Guide

This document outlines the security setup required for the Google Workspace Admin UI.

## Application roles (Workspace)

Sign-in uses Google OAuth; API access uses a **service account with domain-wide delegation** impersonating the signed-in user. After authentication, the backend loads Admin SDK directory data for that user:

- **Super admins** (`isAdmin` in the Admin SDK) receive full app permissions, including all **mutations** and exports.
- **Delegated admins** receive **view-only** permissions in this app (browsing users, groups, Drive, calendar, audit views, Gmail read-only areas). They **cannot** perform writes, Drive uploads from exports, or other actions gated by `requireSuperAdmin` or mutation permissions.

Network-level controls (for example **Identity-Aware Proxy** and OAuth client restrictions) are separate; they do not replace this in-app enforcement.

## Prerequisites

1. Google Cloud Project with billing enabled
2. Google Workspace domain with admin access
3. Service Account with domain-wide delegation

## Step 1: Enable Required APIs

Enable the following APIs in your GCP project:

```bash
gcloud services enable \
  admin.googleapis.com \
  drive.googleapis.com \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com
```

## Step 2: Create Service Account

1. Go to IAM & Admin > Service Accounts in GCP Console
2. Create a new service account
3. Grant the following roles:
   - Secret Manager Secret Accessor
   - Cloud Run Invoker
4. Download the JSON key file

## Step 3: Set Up Domain-Wide Delegation

1. In Google Workspace Admin Console:
   - Go to Security > API Controls > Domain-wide Delegation
   - Click "Add new"
   - Enter the Service Account Client ID (from the JSON key)
   - Add the following OAuth scopes:
     - https://www.googleapis.com/auth/admin.directory.user
     - https://www.googleapis.com/auth/admin.directory.group
     - https://www.googleapis.com/auth/drive
     - https://www.googleapis.com/auth/gmail.settings.basic
     - https://www.googleapis.com/auth/calendar
   - Click "Authorize"

## Step 4: Store Service Account Key in Secret Manager

```bash
# Create secret
gcloud secrets create service-account-key \
  --data-file=path/to/service-account-key.json \
  --project=YOUR_PROJECT_ID

# Grant access to Cloud Run service account
gcloud secrets add-iam-binding service-account-key \
  --member="serviceAccount:workspace-admin-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 5: Create OAuth2 Credentials

1. Go to APIs & Services > Credentials in GCP Console
2. Create OAuth 2.0 Client ID
3. Application type: Web application
4. **Authorized redirect URIs** for the Google OAuth **web client** (must match **`GOOGLE_REDIRECT_URI`** in the backend—the Google OAuth flow calls **`GET /api/auth/callback`** on the **API** host first; the API then redirects the browser to **`${CORS_ORIGIN}/auth/callback`** with tokens, which the SPA handles—same component as `/login`):
   - `http://localhost:5001/api/auth/callback` — backend default when running `npm run dev` in `backend/` (port `5001`)
   - `http://localhost:5000/api/auth/callback` — backend on host port `5000` (e.g. **Docker Compose**)
   - `https://YOUR-CLOUD-RUN-URL/api/auth/callback` — production Cloud Run
5. Download the credentials

## Step 6: Store secrets in Secret Manager

Production deploys map environment variables to Secret Manager entries via **`--set-secrets`** (exact names and version aliases are in **[DEPLOYMENT.md](./DEPLOYMENT.md)** and **`deploy.sh`**). At minimum you need:

- **`service-account-key`** — JSON for the delegated service account  
- **OAuth values** — client ID, secret, redirect URI (stored as separate versions on the secrets your deploy references)  
- **JWT** and **workspace domain** — as referenced by Cloud Run  
- **GCP project id** — for the logging client and Secret Manager lookups  

**Recommended:** run the interactive script from the repo root (creates or updates secrets and versions in the order `setup-secrets.sh` expects):

```bash
./setup-secrets.sh YOUR_PROJECT_ID
```

Avoid copy-pasting duplicate `gcloud secrets create oauth-config` lines—each secret name can only be created once; additional values use `gcloud secrets versions add`.

## Step 7: Create Cloud Run Service Account

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
