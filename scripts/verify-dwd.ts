/**
 * Smoke-test keyless domain-wide delegation: mint a delegated token for the
 * admin via the IAM Credentials API (signJwt) and list one directory user.
 * No service-account key is used.
 *
 * Usage: tsx scripts/verify-dwd.ts <service-account-email> <admin@domain.com>
 *
 * Requires the caller's ADC to have tokenCreator (signJwt) on the SA. This may
 * not hold from Cloud Shell even when the runtime SA (which holds tokenCreator
 * on itself) will succeed, so callers treat failure as best-effort.
 */
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

const saEmail = process.argv[2];
const adminEmail = process.argv[3];

if (!saEmail || !adminEmail) {
  console.error('Usage: tsx scripts/verify-dwd.ts <service-account-email> <admin@domain.com>');
  process.exit(2);
}

const configSource = readFileSync('backend/src/config/google.config.ts', 'utf8');
const scopeMatch = configSource.match(/const SERVICE_ACCOUNT_SCOPES = \[([\s\S]*?)\];/);
if (!scopeMatch) {
  console.error('Could not parse SERVICE_ACCOUNT_SCOPES from google.config.ts');
  process.exit(2);
}
const scopes = [...scopeMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

async function main() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: saEmail,
    sub: adminEmail,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const iamcredentials = google.iamcredentials({ version: 'v1', auth });
  const signResp = await iamcredentials.projects.serviceAccounts.signJwt({
    name: `projects/-/serviceAccounts/${saEmail}`,
    requestBody: { payload: JSON.stringify(payload) },
  });
  const signedJwt = signResp.data.signedJwt;
  if (!signedJwt) {
    throw new Error('IAM signJwt returned no signedJwt');
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }).toString(),
  });
  if (!tokenResp.ok) {
    throw new Error(`token exchange failed (${tokenResp.status}): ${await tokenResp.text()}`);
  }
  const { access_token: accessToken } = (await tokenResp.json()) as { access_token: string };

  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  const admin = google.admin({ version: 'directory_v1', auth: oauth });
  const res = await admin.users.list({ customer: 'my_customer', maxResults: 1, orderBy: 'email' });
  const count = res.data.users?.length ?? 0;
  console.log(`OK: DWD verified (keyless) — listed ${count} user(s) as ${adminEmail}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('unauthorized_client') || msg.includes('invalid_grant')) {
    console.error('FAIL: DWD not configured or scopes mismatch.');
    console.error('  - Verify the SA client_id (oauth2ClientId) is authorized in admin.google.com');
    console.error('  - Verify scopes match scripts/lib/scopes.sh / SECURITY.md');
    console.error('  - Propagation can take 1–5 minutes after saving DWD');
  } else if (msg.includes('permission') || msg.includes('PERMISSION_DENIED') || msg.includes('signJwt')) {
    console.error('FAIL: caller lacks permission to sign as the service account (tokenCreator).');
    console.error('  This is expected from Cloud Shell in some orgs — the runtime SA will still work.');
  } else {
    console.error('FAIL:', msg);
  }
  process.exit(1);
});
