import fs from 'fs';
import path from 'path';
import type { TenantFixtures } from '../../helpers/tenantDiscovery';

const FIXTURES_FILE = path.resolve(__dirname, '../.fixtures/tenant.json');

export function loadTenantFixtures(): TenantFixtures {
  if (!fs.existsSync(FIXTURES_FILE)) {
    throw new Error(
      'Missing tests/e2e/.fixtures/tenant.json — run: npm run test:e2e:fixtures (after backend is up)'
    );
  }
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8')) as TenantFixtures;
}

export function requireTenantFixture(key: keyof TenantFixtures, hint: string): string {
  const fixtures = loadTenantFixtures();
  const value = fixtures[key];
  if (!value) {
    throw new Error(`Tenant fixture "${key}" missing. ${hint}`);
  }
  return value;
}
