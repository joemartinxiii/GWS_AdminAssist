/**
 * Dev-only: seed session for MSW so ProtectedRoute and API calls behave like a signed-in user.
 * Dead-code-eliminated in production builds (import.meta.env.DEV is false).
 */
import { MSW_LOCAL_SESSION_TOKEN } from './msw-constants';

if (import.meta.env.DEV && import.meta.env.VITE_USE_MSW === 'true') {
  if (!localStorage.getItem('sessionToken')) {
    localStorage.setItem('sessionToken', MSW_LOCAL_SESSION_TOKEN);
  }
}
