/**
 * Smoke-test domain-wide delegation: impersonate admin and list one directory user.
 * Usage: tsx scripts/verify-dwd.ts <sa-key.json> <admin@domain.com>
 */
import { readFileSync } from 'fs';
import { google } from 'googleapis';

const saKeyPath = process.argv[2];
const adminEmail = process.argv[3];

if (!saKeyPath || !adminEmail) {
  console.error('Usage: tsx scripts/verify-dwd.ts <sa-key.json> <admin@domain.com>');
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
  const creds = JSON.parse(readFileSync(saKeyPath, 'utf8'));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
    subject: adminEmail,
  });

  const admin = google.admin({ version: 'directory_v1', auth });
  const res = await admin.users.list({ customer: 'my_customer', maxResults: 1, orderBy: 'email' });
  const count = res.data.users?.length ?? 0;
  console.log(`OK: DWD verified — listed ${count} user(s) as ${adminEmail}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('unauthorized_client') || msg.includes('invalid_grant')) {
    console.error('FAIL: DWD not configured or scopes mismatch.');
    console.error('  - Verify client_id in admin.google.com matches SA JSON client_id (not OAuth web client)');
    console.error('  - Verify scopes match scripts/lib/scopes.sh / SECURITY.md');
    console.error('  - Propagation can take 1–5 minutes after saving DWD');
  } else {
    console.error('FAIL:', msg);
  }
  process.exit(1);
});
