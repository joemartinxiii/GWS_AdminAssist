# Staging Test Setup (Live Workspace)

Live tests hit your **real Google Workspace tenant** via domain-wide delegation. Mutating tests create and revert changes automatically.

## Prerequisites

1. Super admin account for automation (e.g. your workspace super admin)
2. Service account with DWD scopes from [SECURITY.md](../SECURITY.md)
3. **Keyless** — no JSON key. Run `gcloud auth application-default login` with an identity that has `roles/iam.serviceAccountTokenCreator` on the runtime SA
4. Node.js 18+, Playwright Chromium (`npx playwright install chromium`)

## Configure `.env.test`

```bash
cp .env.test.example .env.test
# Set SERVICE_ACCOUNT_EMAIL to the runtime SA; fill JWT_SECRET, domain, etc.
# Or: npm run bootstrap:test  (from gcloud + Secret Manager)
```

`JWT_SECRET` must match what the backend uses (same as production Secret Manager value).

## Verify config (smoke)

```bash
./scripts/smoke-config.sh
```

## Auto-discovery (no manual TEST_* IDs required)

Live and E2E tests **auto-discover** groups, shared drives, files, and a second user for delegation from your tenant:

- Jest: `backend/tests/helpers/liveFixtures.ts` (via `tests/helpers/tenantDiscovery.ts`)
- Playwright: `npm run test:e2e:fixtures` writes `tests/e2e/.fixtures/tenant.json`

Env vars like `TEST_GROUP_EMAIL` only override discovery when you need a specific resource.

## Test tiers

| Command | What it runs | Typical runtime |
|---------|--------------|-----------------|
| `npm run test:all:read` | type-check + security + live `@read` API | ~3 min |
| `npm run test:live:read` | Live API read-only | ~3 min |
| `npm run test:live` + `TEST_MUTATIONS=true` | Live API read + write (with cleanup) | ~5 min |
| `npm run test:e2e:read` | Playwright UI smoke (8 pages) | ~5 min |
| `npm run test:e2e:mutating` | Playwright UI write flows | ~5 min |
| **`npm run test:all`** | **Full gate: all of the above** | **~25–35 min** |

```bash
# One-time Playwright browser
npx playwright install chromium

# Full top-to-bottom gate
npm run test:all
```

## What each layer proves

| Layer | Proves |
|-------|--------|
| Live `@read` | Backend routes + Google read APIs |
| Live `@mutating` | Backend write paths + cleanup |
| E2E `@read` | UI loads real data through full stack |
| E2E `@mutating` | UI buttons/forms → API → Google |

## Agent workflow

In Cursor, say **"run tests"** or **"test and fix"**. See `.cursor/rules/test-and-fix.mdc`.

## Post-deploy smoke

After a GitHub Actions deploy (or `./deploy.sh`):

```bash
curl -sf "https://YOUR_CLOUD_RUN_URL/health"
npm run test:live:read   # confirms DWD + secrets against live tenant
```

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 403 from Google APIs | Missing DWD scope or wrong SA |
| `unauthorized_client` | Scope added in code but not Admin Console (or vice versa) |
| 401 from app API | `JWT_SECRET` mismatch or expired token |
| E2E redirect to `/login` | Re-run `npm run test:e2e:auth` |
| Mutating E2E fixture error | Backend must be up; run `npm run test:e2e:fixtures` |
| External-sharing test slow | Normal (~2 min); live test timeout is 180s |
