export function validateEnvironment(): void {
  const required = ['JWT_SECRET', 'GCP_PROJECT_ID', 'WORKSPACE_DOMAIN', 'CORS_ORIGIN'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ CRITICAL: Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nApplication cannot start without these variables.');
    console.error('Please check your .env file or environment configuration.');
    process.exit(1);
  }

  // Optional but recommended
  const recommended = ['GWS_ALLOWED_DOMAINS'];
  const missingRecommended = recommended.filter(key => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn('⚠️  WARNING: Missing recommended environment variables:');
    missingRecommended.forEach(key => console.warn(`   - ${key} (defaults to WORKSPACE_DOMAIN only)`));
  }

  console.log('✅ Environment validation passed');
}