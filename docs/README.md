# Documentation

Start with the row that matches what you are doing.

## Operators

| Guide | When |
|-------|------|
| **[DEPLOY.md](DEPLOY.md)** | First deploy, updates, go-live checklist |
| **[DEPLOY_REFERENCE.md](DEPLOY_REFERENCE.md)** | Flags, secrets, scan/audit infra, troubleshooting |
| **[../SECURITY.md](../SECURITY.md)** | Auth model, scopes, env vars |
| **[../GWS_HARDENING.md](../GWS_HARDENING.md)** | Security Audit checks and UI flow |
| **[../AUDIT_LOGGING.md](../AUDIT_LOGGING.md)** | Mutation logs in Cloud Logging |

## Developers

| Guide | When |
|-------|------|
| **[LOCAL_DEV.md](LOCAL_DEV.md)** | MSW UI or full stack locally |
| **[ui.md](ui.md)** | List/actions design contract |
| **[STAGING_TEST_SETUP.md](STAGING_TEST_SETUP.md)** | Live API + Playwright |

## Project notes

| Doc | Notes |
|-----|--------|
| **[tech-debt.md](tech-debt.md)** | Known gaps and roadmap snapshot |

## Repo layout

```
docs/           ← you are here
frontend/       React app
backend/        Express API
scripts/        bootstrap, deploy, CI
.github/        Actions workflows
```

## Product principles

1. **On-demand, free-tier friendly** — heavy work is explicit (Run audit, Run scan).
2. **Super admin for mutations** — delegates can view; changes need super.
3. **Protect critical accounts** — set `GWS_PROTECTED_USERS`.
4. **UI consistency** — list shell, trailing actions, resizable data columns ([ui.md](ui.md)).
5. **One deploy path** after the image exists — `scripts/deploy-from-image.sh`.
