function envPresent(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateEnvironment(): void {
  const required = ['JWT_SECRET', 'GCP_PROJECT_ID', 'WORKSPACE_DOMAIN', 'SERVICE_ACCOUNT_SECRET_NAME'];
  const missing = required.filter((key) => !envPresent(key));

  if (missing.length > 0) {
    console.error('❌ CRITICAL: Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nApplication cannot start without these variables.');
    console.error('Please check your Secret Manager configuration.');
    process.exit(1);
  }

  // Optional but recommended
  const recommended = ['CORS_ORIGIN', 'GWS_ALLOWED_DOMAINS'];
  const missingRecommended = recommended.filter((key) => !envPresent(key));

  if (missingRecommended.length > 0) {
    console.warn('⚠️  WARNING: Missing recommended environment variables:');
    missingRecommended.forEach(key => console.warn(`   - ${key} (will use fallback)`));
  }

  console.log('✅ Environment validation passed');
}