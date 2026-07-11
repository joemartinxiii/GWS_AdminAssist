function envPresent(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateEnvironment(): void {
  const isProduction = process.env.NODE_ENV === 'production';

  const required = ['JWT_SECRET', 'GCP_PROJECT_ID', 'WORKSPACE_DOMAIN'];
  // OAuth client credentials are required in production (Secret Manager).
  // Local/dev may still start without them for non-login work, but login will fail.
  if (isProduction) {
    required.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI');
  }

  const missing = required.filter((key) => !envPresent(key));

  if (missing.length > 0) {
    console.error('❌ CRITICAL: Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nApplication cannot start without these variables.');
    console.error('Please check your Secret Manager configuration.');
    process.exit(1);
  }

  // Optional but recommended
  const recommended = ['CORS_ORIGIN', 'GWS_ALLOWED_DOMAINS', 'SERVICE_ACCOUNT_EMAIL'];
  if (!isProduction) {
    recommended.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI');
  }
  const missingRecommended = recommended.filter((key) => !envPresent(key));

  if (missingRecommended.length > 0) {
    console.warn('⚠️  WARNING: Missing recommended environment variables:');
    missingRecommended.forEach((key) => console.warn(`   - ${key} (will use fallback)`));
  }

  if (isProduction && envPresent('JWT_SECRET') && (process.env.JWT_SECRET || '').length < 32) {
    console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters in production.');
  }

  console.log('✅ Environment validation passed');
}