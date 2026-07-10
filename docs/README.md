# Documentation

Human-oriented guides for **GWS Admin Assist**. Start with the row that matches what you’re doing.

## For operators (run the product)

| Guide | When to use it |
|-------|----------------|
| **[DEPLOY.md](DEPLOY.md)** | First deploy, GitHub Actions, updates, teardown |
| **[../SECURITY.md](../SECURITY.md)** | OAuth client, domain-wide delegation, scopes, app security model |
| **[../GWS_HARDENING.md](../GWS_HARDENING.md)** | What the Security Audit page checks |

## For developers

| Guide | When to use it |
|-------|----------------|
| **[LOCAL_DEV.md](LOCAL_DEV.md)** | Run UI mocks or full stack locally |
| **[ui.md](ui.md)** | Lists, actions, tokens — keep the UI cohesive |
| **[STAGING_TEST_SETUP.md](STAGING_TEST_SETUP.md)** | Live API tests and Playwright E2E |
| **[../AUDIT_LOGGING.md](../AUDIT_LOGGING.md)** | How admin actions are logged |

## Project notes (not required for day-to-day)

| Doc | Notes |
|-----|--------|
| **[tech-debt.md](tech-debt.md)** | Known gaps and polish backlog (committed snapshot) |

Session handoff files (`session/`, root `todos.md`, `tech-debt.md`) are **local-only** and gitignored when present.

## Repo layout

```
docs/           ← you are here
frontend/       React app
backend/        Express API
scripts/        bootstrap, deploy, CI helpers
.github/        Actions workflows
```

## Design principles (product)

1. **On-demand, free-tier** — heavy work is explicit (Run audit, Run scan), not continuous paid infra.
2. **Super admin for mutations** — delegates can view; changes need super.
3. **Protect critical accounts** — never delete configured protected users (e.g. primary admin / backup).
4. **UI consistency** — data columns left, risk chips fixed-width, **Actions trailing right** (see [ui.md](ui.md)).
