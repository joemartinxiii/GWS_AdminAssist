import jwt from 'jsonwebtoken';

const REQUIRED = [
  'TEST_SUPER_ADMIN_EMAIL',
  'JWT_SECRET',
  'GCP_PROJECT_ID',
  'WORKSPACE_DOMAIN',
] as const;

export function requireLiveEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Live tests require: ${missing.join(', ')}. Copy .env.test.example to .env.test — see docs/STAGING_TEST_SETUP.md`
    );
  }
  // Keyless DWD: the app signs delegation tokens as SERVICE_ACCOUNT_EMAIL using
  // Application Default Credentials. Locally you need `gcloud auth
  // application-default login` and tokenCreator on that SA.
  if (!process.env.SERVICE_ACCOUNT_EMAIL?.trim() && process.env.NODE_ENV !== 'production') {
    console.warn('Live tests: SERVICE_ACCOUNT_EMAIL not set — will infer the SA from ADC credentials.');
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
