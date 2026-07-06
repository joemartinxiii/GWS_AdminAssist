import jwt from 'jsonwebtoken';

const REQUIRED = [
  'TEST_SUPER_ADMIN_EMAIL',
  'JWT_SECRET',
  'GCP_PROJECT_ID',
  'WORKSPACE_DOMAIN',
  'SERVICE_ACCOUNT_SECRET_NAME',
] as const;

export function requireLiveEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Live tests require: ${missing.join(', ')}. Copy .env.test.example to .env.test — see docs/STAGING_TEST_SETUP.md`
    );
  }
  if (!process.env.SA_KEY_PATH?.trim() && process.env.NODE_ENV !== 'production') {
    console.warn('Live tests: SA_KEY_PATH not set — will use Secret Manager (requires gcloud auth).');
  }
}

export function mintTestSessionToken(): string {
  requireLiveEnv();
  const email = process.env.TEST_SUPER_ADMIN_EMAIL!.trim();
  const secret = process.env.JWT_SECRET!.trim();
  return jwt.sign(
    {
      email,
      name: 'Live Test Admin',
      picture: undefined,
    },
    secret,
    { expiresIn: '1h' }
  );
}

export function authHeaders(): Record<string, string> {
  const token = mintTestSessionToken();
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `sessionToken=${token}`,
  };
}

export const mutatingEnabled = (): boolean => process.env.TEST_MUTATIONS === 'true';

export const describeMutating = mutatingEnabled() ? describe : describe.skip;
