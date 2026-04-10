// Test environment setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.GCP_PROJECT_ID = 'test-project';
process.env.WORKSPACE_DOMAIN = 'example.com';
process.env.GWS_ALLOWED_DOMAINS = 'example.com,subsidiary.com';