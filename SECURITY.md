# Security

How GWS Admin Assist authenticates, authorizes, and protects Workspace data.

**Deploy first:** [docs/DEPLOY.md](docs/DEPLOY.md). This file is scopes, roles, env vars, and the security model — not a second install guide.

---

## Roles (who can do what)

Sign-in is Google OAuth (identity only). Workspace APIs use a **service account with domain-wide delegation** impersonating the **signed-in user** (never a fixed super-admin).

| Role | In the app |
|------|------------|
| **Super admin** (`isAdmin` in Admin SDK) | Full access: mutations, exports, Drive remediations, audit run/waive, scans |
| **Delegated admin** | View-only. Cannot write, export to Drive, or run privileged audit/scan actions |
| Everyone else | Login rejected |

The UI shows a role badge (Super Admin vs Delegated). The most common production confusion is “I can sign in but buttons do nothing” — that is delegated admin by design.

---

## Access model (network vs app)

The Cloud Run URL is **publicly reachable** so browsers can start OAuth. Reachability is not authorization.

| Gate | Rule |
|------|------|
| OAuth | Must sign in with Google |
| Domain | Email domain in `WORKSPACE_DOMAIN` / `GWS_ALLOWED_DOMAINS` (fails closed if unset) |
| Admin | Must be Workspace super or delegated admin |
| Session | HttpOnly, Secure, SameSite=Lax JWT cookie — Google tokens stay on the server |
| Routes | `requireAnyAdmin` / `requireSuperAdmin` / `requirePermission(...)` on each API |

Domain-wide delegation always uses `subject = signed-in user email`. Delegated admins are blocked from mutations in middleware even if Directory would allow some operations.

**Optional hardening (not required):** HTTPS Load Balancer + Cloud Armor in front of Cloud Run; restrict ingress once a load balancer exists. IAP is possible but adds a second Google sign-in on top of the app’s own OAuth.

---

## Copy-paste scope strings

No spaces after commas. Use **one** of these lists — they must match `scripts/lib/scopes.sh` and `backend/src/config/google.config.ts` (`npm run check:scopes`).

### OAuth consent screen (browser sign-in)

Identity only. Workspace APIs do **not** use user OAuth tokens.

```
openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/userinfo.profile
```

### Domain-wide delegation (admin.google.com)

Use the service account’s **numeric OAuth2 client ID**, not the OAuth Web client ID:

```bash
gcloud iam service-accounts describe workspace-admin-sa@YOUR_PROJECT.iam.gserviceaccount.com \
  --format='value(oauth2ClientId)'
```

Paste this scope string for that Client ID:

```
https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.user.security,https://www.googleapis.com/auth/apps.security,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/admin.directory.resource.calendar,https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/cloud-identity.policies.readonly
```

The last two scopes power Security Audit automation. Deploy enables the related APIs automatically. If a scope or API is missing, those checks fall back to **Manual** in the UI.

DWD cannot be set via gcloud — only in [Admin console → Domain-wide delegation](https://admin.google.com/ac/owl/domainwidedelegation). Every deploy prints the current scope line + Client ID.

---

## Runtime identity (keyless)

Production does **not** store a service-account JSON key.

- Cloud Run runs as `workspace-admin-sa@…`
- That SA has `roles/iam.serviceAccountTokenCreator` **on itself**
- It mints short-lived delegated tokens via the IAM Credentials API (`signJwt`)
- Requires `iamcredentials.googleapis.com` (enabled by deploy)

Local full-stack dev uses Application Default Credentials plus `SERVICE_ACCOUNT_EMAIL` pointing at that SA (your user needs tokenCreator on it). See [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md).

---

## Environment variables

Set by deploy via Secret Manager + Cloud Run env (see [docs/DEPLOY_REFERENCE.md](docs/DEPLOY_REFERENCE.md#secrets-and-environment)).

| Variable | Required | Purpose |
|----------|----------|---------|
| `JWT_SECRET` | Yes | Signs the app session cookie |
| `GCP_PROJECT_ID` | Yes | GCP project |
| `WORKSPACE_DOMAIN` | Yes | Primary Workspace domain |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Yes (prod) | OAuth Web client |
| `SERVICE_ACCOUNT_EMAIL` | Recommended | Runtime SA email for keyless DWD |
| `CORS_ORIGIN` | Recommended | Live app URL; production falls back to same-origin if unset |
| `GWS_ALLOWED_DOMAINS` | Recommended | Comma-separated domains allowed for login + mutations |
| `GWS_PROTECTED_USERS` | Optional | Emails that cannot be permanently deleted |
| `SIGNATURE_TEMPLATE_BUCKET` | Optional | Durable org signature templates |
| `SCAN_BUCKET` / `SCAN_JOB_NAME` / `SCAN_REGION` | Set by deploy | Drive external scan + Security Audit state in GCS |

### Multi-domain

```bash
WORKSPACE_DOMAIN=company.com
GWS_ALLOWED_DOMAINS=company.com,brand.com,ext.company.com
```

| Area | Behavior |
|------|----------|
| Login | Domain on allowlist **and** Workspace admin |
| Directory lists | Customer-wide (`my_customer`) |
| Mutations | Target email/domain must be on the allowlist |
| “External” labels | Outside the allowlist |

Update secret `app-allowed-domains` and redeploy when domains change. No extra DWD step per domain.

---

## App controls worth knowing

| Control | Behavior |
|---------|----------|
| Input validation | Emails, domains, HTML sanitization (signatures), text escaping |
| Rate limits | General + tighter limits on sensitive routes |
| Headers | Helmet / CSP / HSTS-style production headers |
| Errors | Sanitized in production |
| Protected deletes | `GWS_PROTECTED_USERS` — backend enforces; UI reads list from `/api/auth/me` |
| Mutation audit | Cloud Logging (`workspace-admin-audit`) — see [AUDIT_LOGGING.md](AUDIT_LOGGING.md) |

### External-sharing scan

- Super-admin only to start or remediate
- Same runtime SA + keyless DWD; lists metadata only (not file contents)
- Report in private GCS bucket (`SCAN_BUCKET`); treat as sensitive inventory data

Security Audit hardening checks: [GWS_HARDENING.md](GWS_HARDENING.md).

---

## Threat model (short)

| Risk | Mitigation |
|------|------------|
| Public Cloud Run URL | App-layer gates (OAuth, domain, admin, session, permissions). Not invoker-IAM based. |
| Broad DWD scopes | Impersonates signed-in user only; super-admin for mutations; no SA key on disk |
| Privilege escalation | Delegated admins view-only in app; roles re-checked per request |
| XSS / injection | Central validation + sanitization on write paths |
| Session theft | HttpOnly Secure cookie; short-lived JWT; Google tokens never in browser |
| Scan / audit data in GCS | Private bucket, runtime SA objectAdmin only, super-admin triggers |

Overall posture is appropriate for a browser-based Workspace admin tool. Optional network front-end (Cloud Armor) if you want defense in depth.

---

## Security testing

```bash
npm run test:security
npm run type-check:all
```

Live tenant tests: [docs/STAGING_TEST_SETUP.md](docs/STAGING_TEST_SETUP.md).

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Can sign in but cannot change anything | Role badge = Delegated → expected. Use a super admin. |
| `unauthorized_client` from Google | DWD Client ID must be the **SA numeric id**; scopes must match the block above; wait a few minutes after saving |
| `redirect_uri_mismatch` | OAuth client must list exact `https://<cloud-run-url>/api/auth/callback` |
| Permissions / “what I can do” errors | Runtime SA tokenCreator on itself; Secret Manager accessor on secrets; Cloud Run logs |
| Secret Manager access denied | Runtime SA needs `roles/secretmanager.secretAccessor` on each secret |

Logs:

```bash
gcloud run services logs read workspace-admin --region us-central1 --limit 100
```

---

## Practices

1. Never commit secrets; use Secret Manager  
2. Prefer WIF for CI (no deploy SA keys)  
3. Rotate JWT and OAuth client credentials periodically  
4. Keep DWD scopes minimal when you change product features — update `scopes.sh` + Admin console together  
5. Monitor Cloud Logging for unexpected mutation volume  
6. Report vulnerabilities privately to maintainers (not public issues)  
