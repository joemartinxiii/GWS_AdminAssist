import dotenv from 'dotenv';
import { createApp } from './app';
import { validateEnvironment } from './utils/env.validation';

console.log('🚀 Starting Google Workspace Admin Assist...');
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  hasJWT: !!process.env.JWT_SECRET?.trim(),
  hasProjectId: !!process.env.GCP_PROJECT_ID?.trim(),
  hasWorkspaceDomain: !!process.env.WORKSPACE_DOMAIN?.trim(),
  hasClientId: !!process.env.GOOGLE_CLIENT_ID?.trim(),
});

dotenv.config();

const isTestRuntime = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;

if (!isTestRuntime) {
  validateEnvironment();
}

const app = createApp();
const port = Number(process.env.PORT) || 8080;

if (!isTestRuntime) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;
