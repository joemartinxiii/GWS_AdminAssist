import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function mintTestSessionToken(): string {
  const email = process.env.TEST_SUPER_ADMIN_EMAIL?.trim();
  const secret = process.env.JWT_SECRET?.trim();
  if (!email || !secret) {
    throw new Error('TEST_SUPER_ADMIN_EMAIL and JWT_SECRET required in .env.test');
  }
  return jwt.sign({ email, name: 'E2E Test Admin' }, secret, { expiresIn: '2h' });
}

/**
 * Write Playwright storage state with HttpOnly session cookie (not localStorage).
 * Matches production cookie-based auth.
 */
export function writeAuthStorageState(): string {
  const token = mintTestSessionToken();
  const authDir = path.resolve(__dirname, '../tests/e2e/.auth');
  fs.mkdirSync(authDir, { recursive: true });
  const outPath = path.join(authDir, 'session.json');

  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
  let domain = 'localhost';
  try {
    domain = new URL(baseURL).hostname;
  } catch {
    /* keep localhost */
  }

  const state = {
    cookies: [
      {
        name: 'sessionToken',
        value: token,
        domain,
        path: '/',
        httpOnly: true,
        secure: baseURL.startsWith('https'),
        sameSite: 'Lax' as const,
        expires: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
      },
    ],
    origins: [],
  };
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  return outPath;
}

if (process.argv[1]?.endsWith('mint-test-session.ts')) {
  const out = writeAuthStorageState();
  console.log(`Wrote Playwright auth state: ${out}`);
}
