/**
 * Fail CI if scripts/lib/scopes.sh DWD_SCOPES diverge from google.config.ts SERVICE_ACCOUNT_SCOPES.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const configPath = join(root, 'backend/src/config/google.config.ts');
const scopesPath = join(root, 'scripts/lib/scopes.sh');

function parseConfigScopes(source: string): string[] {
  const match = source.match(/const SERVICE_ACCOUNT_SCOPES = \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('Could not find SERVICE_ACCOUNT_SCOPES in google.config.ts');
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function parseScopesSh(source: string): string[] {
  const match = source.match(/^DWD_SCOPES="([^"]+)"/m);
  if (!match) {
    throw new Error('Could not find DWD_SCOPES in scripts/lib/scopes.sh');
  }
  return match[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
}

const configScopes = parseConfigScopes(readFileSync(configPath, 'utf8'));
const shScopes = parseScopesSh(readFileSync(scopesPath, 'utf8'));

const inConfigOnly = configScopes.filter((s) => !shScopes.includes(s));
const inShOnly = shScopes.filter((s) => !configScopes.includes(s));

if (inConfigOnly.length || inShOnly.length) {
  console.error('Scope mismatch between google.config.ts and scripts/lib/scopes.sh');
  if (inConfigOnly.length) {
    console.error('  In google.config.ts only:', inConfigOnly.join(', '));
  }
  if (inShOnly.length) {
    console.error('  In scopes.sh only:', inShOnly.join(', '));
  }
  console.error('Run npm run check:scopes after updating both files.');
  process.exit(1);
}

console.log(`OK: ${configScopes.length} DWD scopes match between google.config.ts and scopes.sh`);
