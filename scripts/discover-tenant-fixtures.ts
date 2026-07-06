import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {
  discoverTenantFixtures,
  type TenantFixtures,
} from '../tests/helpers/tenantDiscovery';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env.test') });

const API_BASE = process.env.PLAYWRIGHT_API_URL || 'http://localhost:5001';
const FIXTURES_DIR = path.join(root, 'tests/e2e/.fixtures');
const FIXTURES_FILE = path.join(FIXTURES_DIR, 'tenant.json');

function mintToken(): string {
  const email = process.env.TEST_SUPER_ADMIN_EMAIL?.trim();
  const secret = process.env.JWT_SECRET?.trim();
  if (!email || !secret) {
    throw new Error('TEST_SUPER_ADMIN_EMAIL and JWT_SECRET required in .env.test');
  }
  return jwt.sign({ email, name: 'E2E Fixture Discovery' }, secret, { expiresIn: '1h' });
}

async function waitForHealth(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return;
    } catch {
      // backend not ready
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Backend not healthy at ${API_BASE}/health after ${timeoutMs}ms`);
}

async function apiGet(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: `sessionToken=${token}`,
    },
  });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

export async function discoverAndWriteFixtures(): Promise<TenantFixtures> {
  await waitForHealth();
  const token = mintToken();
  const fixtures = await discoverTenantFixtures(
    (p) => apiGet(p, token),
    {
      adminEmail: process.env.TEST_SUPER_ADMIN_EMAIL,
      groupEmail: process.env.TEST_GROUP_EMAIL,
      sharedDriveId: process.env.TEST_SHARED_DRIVE_ID,
      myDriveFileId: process.env.TEST_MY_DRIVE_FILE_ID,
      sharedDriveFileId: process.env.TEST_SHARED_DRIVE_FILE_ID,
      delegateEmail:
        process.env.TEST_DELEGATION_TARGET_EMAIL || process.env.TEST_USER_EMAIL,
    }
  );
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
  return fixtures;
}

if (process.argv[1]?.endsWith('discover-tenant-fixtures.ts')) {
  discoverAndWriteFixtures()
    .then((f) => {
      console.log(`Wrote tenant fixtures: ${FIXTURES_FILE}`);
      console.log(JSON.stringify(f, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
