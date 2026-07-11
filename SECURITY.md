# Security Configuration Guide

This document outlines the security setup required for the Google Workspace Admin UI.

## Application roles (Workspace)

Sign-in uses Google OAuth; API access uses a **service account with domain-wide delegation** impersonating the signed-in user. After authentication, the backend loads Admin SDK directory data for that user. The UI now shows a clear role badge (green "Super Admin (Full Access)" or orange "Delegated Admin (View Only)") in the top-right user menu:

- **Super admins** (`isAdmin` in the Admin SDK) receive full app permissions, including all **mutations** and exports.
- **Delegated admins** receive **view-only** permissions in this app (browsing users, groups, Drive, calendar, audit views, Gmail read-only areas). They **cannot** perform writes, Drive uploads from exports, or other actions gated by `requireSuperAdmin` or mutation permissions. This is the most common source of "what I can and cannot do" in production.

**Error messages** have been improved to provide actionable guidance for Secret Manager, IAM, and delegation issues (see Troubleshooting below). Network-level controls (for example **Identity-Aware Proxy** and OAuth client restrictions) are separate; they do not replace this in-app enforcement.

## Network access & the `allUsers` warning (expected and safe)

During deploy you will see:

```
Completed with warnings:
  Setting IAM policy failed, try "gcloud beta run services add-iam-policy-binding ... --member=allUsers --role=roles/run.invoker ..."
```

**This is expected. It does not mean the tool is open to the public.** It is worth understanding the distinction:

- **Who can *reach* the URL (network layer):** The Cloud Run service is intentionally **publicly reachable**. A browser-based OAuth app must be — real admins sign in with their Google account and do not carry a Cloud Run IAM invoker token to put in an `Authorization` header. Many organizations also block granting `allUsers` the invoker role via the `iam.allowedPolicyMemberDomains` (domain-restricted-sharing) org policy, which is why that IAM binding "fails" — so the service is instead made reachable with `--no-invoker-iam-check`. The two approaches are equivalent for reachability.
- **Who can *use* the tool (application layer):** Reaching the URL only gets you a login page. Authorization is enforced by the app, in layers:

| Gate | What it enforces | Where |
|------|------------------|-------|
| OAuth sign-in | Must authenticate with a Google account (identity scopes only) | `backend/src/routes/auth.routes.ts` (`/callback`) |
| Allowed-domain check | Email domain must be in `WORKSPACE_DOMAIN` / `GWS_ALLOWED_DOMAINS`; **fails closed** if none set | `backend/src/utils/validation.ts` |
| **Workspace-admin check** | Login is **rejected** (`not_admin`) unless the Directory API reports the user as `isAdmin` or `isDelegatedAdmin` | `backend/src/services/permissions.service.ts` |
| **HttpOnly session cookie** | After gates pass, the server sets an **HttpOnly, Secure, SameSite=Lax** app session JWT cookie. Google tokens are **not** stored in the browser or put in the URL. | `backend/src/utils/sessionCookie.ts`, `auth.routes.ts` |
| Per-route permissions | `requireAnyAdmin` / `requireSuperAdmin` / `requirePermission(...)` re-checked on protected routes | `backend/src/middleware/permissions.middleware.ts` |

**No privilege escalation:** domain-wide delegation impersonates the **signed-in user's own email** (`req.user.email`), never a fixed super-admin. Every Google API call runs with that person's real Workspace privileges, and delegated (view-only) admins are additionally blocked from mutations by the permission middleware. **Audit logs** attribute mutations to `req.user.email` from the session cookie — the same identity DWD uses.

**Net effect:** a stranger with no domain account is stopped at the domain check; a non-admin employee who signs in is stopped at the admin check; only real Workspace admins get a session, acting only as themselves.

### Optional hardening (not required)

The current posture is correct for a browser OAuth app. If you later want defense-in-depth to shrink the public *network* surface:

- **External HTTPS Load Balancer + Cloud Armor** in front of Cloud Run — adds edge rate-limiting, WAF rules, and geo/IP allow-listing before traffic reaches the app. This is the recommended upgrade if you want one (adds some setup and a small monthly cost).
- **Ingress restriction** (`--ingress=internal-and-cloud-load-balancing`) once a load balancer is in place, or IP allow-listing — only practical if your admins connect from known egress IPs.
- **Identity-Aware Proxy (IAP):** possible, but it layers a *second* Google sign-in in front of the app's own OAuth flow, which is redundant and can be confusing. Prefer the Load Balancer + Cloud Armor route unless you specifically need IAP's context-aware access policies.

## Copy-paste scope strings (full URLs, comma-delimited)

Use **no spaces** after commas. Some UIs accept one line; others let you add scopes one-by-one (split on commas).

**Google Cloud — OAuth consent screen** (APIs & Services → OAuth consent screen → add scopes). Browser sign-in is **identity only**; Workspace APIs use domain-wide delegation, not user OAuth tokens:

```
openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/userinfo.profile
```

**Google Workspace Admin — domain-wide delegation** (admin.google.com → Security → API controls → Domain-wide delegation). Use the service account's **numeric OAuth2 client ID** (not the OAuth web client ID). With keyless runtime auth there is no JSON key file — get it with:

```bash
gcloud iam service-accounts describe workspace-admin-sa@YOUR_PROJECT.iam.gserviceaccount.com \
  --format='value(oauth2ClientId)'
```

Scopes must match `backend/src/config/google.config.ts` and [`scripts/lib/scopes.sh`](scripts/lib/scopes.sh):

```
https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.user.security,https://www.googleapis.com/auth/apps.security,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/admin.directory.resource.calendar,https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/cloud-identity.policies.readonly
```

The last two scopes power the **Security Audit** automated checks. Their APIs are enabled automatically on **every** deploy path — the bootstrap wizard, `deploy-cloudshell.sh`, and the GitHub Actions workflow all run `gcloud services enable "${GCP_APIS[@]}"` from [`scripts/lib/scopes.sh`](scripts/lib/scopes.sh), so a newly added API dependency ships with the code that needs it (no manual enable). The equivalent one-liner, if you ever want to enable them by hand:

```bash
gcloud services enable chromepolicy.googleapis.com cloudidentity.googleapis.com --project=YOUR_PROJECT_ID
```

DWD scope authorization is the only step with no gcloud/API equivalent, so every deploy prints the required scope string + SA Client ID + the admin.google.com link. If the API or scope is missing the audit still runs — the affected checks just fall back to "manual".

## Prerequisites & Setup (Simplified)

**Follow [docs/DEPLOY.md](docs/DEPLOY.md) for the complete deploy flow** — the bootstrap wizard automates most of the steps below. This section documents what happens under the hood for security review.

Key security setup (one-time):

1. **Enable APIs** (done automatically by the bootstrap wizard):
   ```bash
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com admin.googleapis.com drive.googleapis.com gmail.googleapis.com calendar-json.googleapis.com \
     iamcredentials.googleapis.com chromepolicy.googleapis.com cloudidentity.googleapis.com
   ```

2. **Service Account (`workspace-admin-sa`)**:
   - Create in IAM & Admin > Service Accounts (bootstrap does this).
   - Grant `roles/secretmanager.secretAccessor`, `roles/logging.logWriter`, and **`roles/iam.serviceAccountTokenCreator` on itself** (keyless DWD via `signJwt`).
   - Set up **domain-wide delegation** in Google Workspace Admin Console > Security → API Controls:
     - **Client ID**: numeric `oauth2ClientId` of the runtime SA (see command above) — not the OAuth web client.
     - **OAuth scopes (comma-delimited)**: paste the **domain-wide delegation** single line from the **Copy-paste scope strings** section at the top of this file.
   - **No JSON key** is required or created for production runtime.

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
For Google Workspace organizations with multiple domains (secondaries, brands, contractor domains):

```bash
WORKSPACE_DOMAIN=company.com
# Full allowlist — include primary + every domain this install may manage
GWS_ALLOWED_DOMAINS=company.com,brand.com,ext.company.com
```

**Bootstrap** prompts for primary + optional “other domains” and stores both in Secret Manager (`app-workspace-domain`, `app-allowed-domains`). The admin’s email domain is auto-added when it differs from primary (e.g. `you@ext.company.com`).

| Use | Behavior |
|-----|----------|
| Login | Email domain must be on the allowlist **and** user must be a Workspace admin |
| Lists (users/groups/scans) | Customer-wide Directory (`my_customer`) — all domains in the tenant |
| Mutations (create user, share, delegate, …) | Target email/domain must be on the allowlist |
| “External” Drive/group flags | Outside the allowlist = external |

To add a domain later: update secret `app-allowed-domains` and redeploy (or ship a new revision). **No** extra DWD step per domain.

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

- **Network Exposure (High)**: Cloud Run is deployed with `--allow-unauthenticated` + `--no-invoker-iam-check` (see [.github/workflows/deploy.yml](.github/workflows/deploy.yml) and [scripts/deploy-cloudshell.sh](scripts/deploy-cloudshell.sh)) because common org policies block `allUsers` invoker IAM bindings. This is expected and safe — see [Network access & the `allUsers` warning](#network-access--the-allusers-warning-expected-and-safe) for the full explanation. Access control is enforced at the **application layer**: Google OAuth sign-in, a login-time Workspace-admin + allowed-domain gate, and per-request super-admin/role checks. CORS is locked to `CORS_ORIGIN` in production. **Optional hardening**: front the service with an external HTTPS Load Balancer + Cloud Armor and restrict ingress to `internal-and-cloud-load-balancing`. (IAP is possible but redundant with the app's own OAuth.)
- **Domain-Wide Delegation/Impersonation**: Broad SA scopes (full Drive, Gmail send, Admin Directory). Per-request `subject = userEmail` (the signed-in user, never a fixed super-admin) + super-admin gating in [permissions.middleware.ts](backend/src/middleware/permissions.middleware.ts) and [permissions.service.ts](backend/src/services/permissions.service.ts). **Auth is keyless** — the runtime SA signs its own short-lived delegation tokens via the IAM Credentials API, so there is **no service-account key to leak or rotate**. **Mitigation**: monitor Cloud Logging for anomalous API calls; consider splitting scopes by permission level in future.
- **Privilege Escalation**: Delegated admins limited to read-only via `isAdmin` check from Admin SDK and permission cache. Tested in security-validation.test.ts.
- **Input/XSS**: Centralized validation in [utils/validation.ts](backend/src/utils/validation.ts) (email, domain, delegation) + sanitizeText + DOMPurify. CSV/exports now centralized in [utils/csv.ts](backend/src/utils/csv.ts). Route-specific checks added (e.g. [users.routes.ts](backend/src/routes/users.routes.ts)).
- **Session/Auth**: App session JWT (default **8h**, configurable via `JWT_EXPIRES_IN`) in an **HttpOnly Secure SameSite=Lax cookie**, verified in [auth.service.ts](backend/src/services/auth.service.ts). A **login-time gate** in [auth.routes.ts](backend/src/routes/auth.routes.ts) rejects any account that is not a Workspace admin in an allowed domain before a session cookie is set. Google OAuth tokens are used **only on the server** during the callback and are never stored in the browser or put in the URL. The `/health` endpoint returns only `{ status, timestamp }` and discloses no configuration.
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
- `SIGNATURE_TEMPLATE_BUCKET` *(optional)*: GCS bucket for durable persistence of the org signature template. Without it, the template is stored on ephemeral local disk and is lost on redeploy. Export before deploy (or set the GitHub Actions variable); the deploy path provisions the bucket and grants the runtime SA `roles/storage.objectAdmin`.
- `GWS_PROTECTED_USERS` *(optional)*: comma-separated emails that **cannot be permanently deleted** via this app (e.g. primary admin and break-glass account). Empty by default — configure for your tenant. Exposed to the UI via `/api/auth/me` → `protectedUsers`.
- `SCAN_BUCKET`, `SCAN_JOB_NAME`, `SCAN_REGION`, `SCAN_USER_CONCURRENCY`: External-sharing scan **and** Security Audit durability (last-run + waivers under `security-audit/` in the same bucket).

### External-sharing scan security

The Drive **External Shares** / **Public Links** audit runs as an on-demand Cloud Run **Job** (`workspace-admin-scan`), not in the request-serving web container. Security properties:

- **Trigger is super-admin only.** `POST /api/audit/external-scan/run` is gated by `requireSuperAdmin`; delegated admins can view cached results but cannot start a scan or remediate.
- **Runs as the runtime SA.** The job uses the same `workspace-admin-sa` identity and keyless domain-wide delegation as the web app — no new credentials. It impersonates each user only to *list* files and read permissions.
- **Least-privilege GCS.** Reports are written to `gs://<project>-workspace-admin-scans`; the runtime SA holds `roles/storage.objectAdmin` on that bucket only. The web service holds `roles/run.developer` solely to execute the job.
- **Metadata only.** The cached report stores file *metadata* (id, name, owner, path, sharing) — never file **contents**. Treat the bucket as sensitive (it enumerates externally shared files) and keep it private (uniform bucket-level access, no public members).
- **Remediation** (`/api/audit/external-scan/remediate`) is super-admin only and removes only `anyone` and external principals via the shared classifier, skipping owners and internal users.

## Troubleshooting

The UI now displays a **role badge** (green "Super Admin (Full Access)" or orange "Delegated Admin (View Only)") in the top-right user menu. Permission fetch and middleware now return **detailed, actionable error messages** for prod issues (Secret Manager, domain-wide delegation, IAM). Check Cloud Run logs with:
```bash
gcloud beta run services logs tail workspace-admin --region us-central1
# Or (all gcloud versions):
gcloud run services logs read workspace-admin --region us-central1 --limit 200
```

### Service Account / Permissions / "What I Can and Cannot Do" Fails (Most Common)

- **Delegated vs Super Admin**: If badge shows "Delegated Admin (View Only)", mutations are intentionally blocked (see Application Roles section). Use a true Super Admin account.
- Verify domain-wide delegation scopes **exactly** match SECURITY.md (copy-paste, no extra spaces/commas) using the SA numeric `oauth2ClientId` in GWS Admin Console → Security → API controls.
- Confirm the runtime SA has `roles/iam.serviceAccountTokenCreator` on itself and Secret Manager accessor on every secret (bootstrap / deploy grants these).
- Check for 403s on `users.get()` or SA init in logs.

### OAuth Flow Fails

- Verify redirect URI matches **exactly** (including trailing slashes, no query params) in GCP Console (use the URI printed at the end of deploy).
- Check OAuth consent screen is configured with identity-only scopes.
- Ensure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` are in Secret Manager and not stuck on `PLACEHOLDER`.

### Secret Manager Access Denied

- Verify the Cloud Run service account (`workspace-admin-sa`) has `roles/secretmanager.secretAccessor` on each secret (re-apply IAM from setup script).
- Confirm `GCP_PROJECT_ID`, secret versions (`:latest`), and env vars in Cloud Run service.
