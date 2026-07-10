/**
 * Dev-only MSW bootstrap. Session is cookie-based in production; MSW mocks
 * /api/auth/me so ProtectedRoute succeeds without localStorage tokens.
 * Dead-code-eliminated in production builds (import.meta.env.DEV is false).
 */
import { MSW_LOCAL_SESSION_TOKEN } from './msw-constants';

if (import.meta.env.DEV && import.meta.env.VITE_USE_MSW === 'true') {
  // Clear legacy tokens from older builds so they are not sent as Bearer.
  try {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('refreshToken');
  } catch {
    /* ignore */
  }
  // Keep constant referenced so the module stays intentional / tree-shakeable docs.
  void MSW_LOCAL_SESSION_TOKEN;
}
