/**
 * Fail CI if scripts/lib/scopes.sh diverges from backend/src/config/google.config.ts.
 * Verifies BOTH:
 *   - DWD service-account scopes (SERVICE_ACCOUNT_SCOPES  ↔ DWD_SCOPES)
 *   - OAuth consent sign-in scopes (getAuthUrl scope list ↔ OAUTH_CONSENT_SCOPES)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const configPath = join(root, 'backend/src/config/google.config.ts');
const scopesPath = join(root, 'scripts/lib/scopes.sh');

const configSource = readFileSync(configPath, 'utf8');
const scopesSource = readFileSync(scopesPath, 'utf8');

function quotedList(source: string): string[] {
  return [...source.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function parseConfigArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`Could not find ${name} in google.config.ts`);
  return quotedList(match[1]);
}

function parseAuthUrlScopes(source: string): string[] {
  const match = source.match(/scope:\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('Could not find getAuthUrl scope array in google.config.ts');
  return quotedList(match[1]);
}

function parseShVar(source: string, name: string): string[] {
  const match = source.match(new RegExp(`^${name}="([^"]+)"`, 'm'));
  if (!match) throw new Error(`Could not find ${name} in scripts/lib/scopes.sh`);
  return match[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
}

function diff(label: string, fromConfig: string[], fromSh: string[]): boolean {
  const inConfigOnly = fromConfig.filter((s) => !fromSh.includes(s));
  const inShOnly = fromSh.filter((s) => !fromConfig.includes(s));
  if (inConfigOnly.length || inShOnly.length) {
    console.error(`Scope mismatch (${label}) between google.config.ts and scripts/lib/scopes.sh`);
    if (inConfigOnly.length) console.error('  In google.config.ts only:', inConfigOnly.join(', '));
    if (inShOnly.length) console.error('  In scopes.sh only:', inShOnly.join(', '));
    return true;
  }
  return false;
}

const dwdConfig = parseConfigArray(configSource, 'SERVICE_ACCOUNT_SCOPES');
const dwdSh = parseShVar(scopesSource, 'DWD_SCOPES');
const oauthConfig = parseAuthUrlScopes(configSource);
const oauthSh = parseShVar(scopesSource, 'OAUTH_CONSENT_SCOPES');

const dwdMismatch = diff('DWD service-account scopes', dwdConfig, dwdSh);
const oauthMismatch = diff('OAuth consent scopes', oauthConfig, oauthSh);

if (dwdMismatch || oauthMismatch) {
  console.error('Run npm run check:scopes after updating both files.');
  process.exit(1);
}

console.log(
  `OK: ${dwdConfig.length} DWD scopes and ${oauthConfig.length} OAuth consent scopes match ` +
    `between google.config.ts and scopes.sh`
);
