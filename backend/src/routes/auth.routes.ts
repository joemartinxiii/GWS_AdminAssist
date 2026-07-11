import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getAuthUrl } from '../config/google.config';
import { authService } from '../services/auth.service';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { permissionsService } from '../services/permissions.service';
import { isEmailInAllowedDomain, getAllowedDomains } from '../utils/validation';
import { sendApiError } from '../utils/apiError';
import {
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  sessionCookieOptions,
  clearCookieOptions,
  oauthStateCookieOptions,
} from '../utils/sessionCookie';
import { getProtectedUserEmails } from '../utils/protectedUsers';

const router = Router();

function frontendBase(): string {
  return process.env.CORS_ORIGIN?.split(',')[0].trim() || 'http://localhost:3000';
}

/**
 * GET /api/auth/login
 * Start Google OAuth (identity only). Sets a short-lived oauth_state cookie for CSRF.
 */
router.get('/login', (_req: Request, res: Response) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, oauthStateCookieOptions());
    const authUrl = getAuthUrl(state);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * GET /api/auth/callback
 * OAuth2 callback: exchange code, gate domain + admin, set HttpOnly session cookie.
 * Google tokens are used only for this request and never sent to the browser.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const base = frontendBase();
  try {
    const { code, error, state } = req.query;

    if (error) {
      return res.redirect(`${base}/auth/error?error=${encodeURIComponent(String(error))}`);
    }

    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearCookieOptions());
    if (!state || !expectedState || String(state) !== String(expectedState)) {
      console.warn('OAuth callback rejected: missing or mismatched state');
      return res.redirect(`${base}/auth/error?error=invalid_state`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${base}/auth/error?error=no_code`);
    }

    // Exchange code for tokens (server-side only; discarded after identity check)
    const tokens = await authService.exchangeCodeForTokens(code);
    const userInfo = await authService.getUserInfo(tokens.accessToken);

    // --- Login gate -------------------------------------------------------
    // Only allow accounts in a permitted Workspace domain that are actually
    // Workspace admins. Previously any Google account could obtain a session
    // and the admin check happened lazily on later API calls.
    if (!isEmailInAllowedDomain(userInfo.email)) {
      console.warn(`Denied login for out-of-domain account: ${userInfo.email}`);
      return res.redirect(`${base}/auth/error?error=domain_not_allowed`);
    }

    try {
      const adminRole = await permissionsService.getAdminRoles(userInfo.email);
      if (!adminRole.isSuperAdmin && !adminRole.isDelegatedAdmin) {
        console.warn(`Denied login for non-admin account: ${userInfo.email}`);
        return res.redirect(`${base}/auth/error?error=not_admin`);
      }
    } catch (adminErr) {
      console.error('Login gate admin check failed:', adminErr);
      return res.redirect(`${base}/auth/error?error=admin_check_failed`);
    }
    // ---------------------------------------------------------------------

    const sessionToken = authService.createSessionToken(userInfo);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());

    // Clean redirect — no tokens in query or fragment
    res.redirect(`${base}/users`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.redirect(`${base}/auth/error?error=callback_failed`);
  }
});

/**
 * GET /api/auth/me
 * Current user from session cookie (or optional Bearer for automation).
 */
router.get('/me', authenticateSession, async (req: AuthRequest, res: Response) => {
  try {
    // Authoritative internal-domain list (WORKSPACE_DOMAIN + GWS_ALLOWED_DOMAINS),
    // unioned with the signed-in user's own domain as a safety net. The client
    // uses this to classify Drive permissions as internal/external instead of a
    // hardcoded default.
    const allowedDomains = getAllowedDomains();
    const selfDomain = req.user?.email?.split('@')[1]?.toLowerCase();
    if (selfDomain && !allowedDomains.includes(selfDomain)) allowedDomains.push(selfDomain);
    res.json({
      email: req.user?.email,
      name: req.user?.name,
      picture: req.user?.picture,
      allowedDomains,
      /** Emails that cannot be permanently deleted (from GWS_PROTECTED_USERS). */
      protectedUsers: getProtectedUserEmails(),
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /api/auth/logout
 * Clear session cookie. Does not require a valid session (always clear client state).
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions());
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearCookieOptions());
  res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/permissions
 * Permissions from Workspace admin roles (DWD). Requires session.
 */
router.get('/permissions', authenticateSession, async (req: AuthRequest, res: Response) => {
  try {
    const permissions = await permissionsService.getUserPermissions(req.user!.email);
    const adminRole = await permissionsService.getAdminRoles(req.user!.email);

    res.json({
      permissions,
      isSuperAdmin: adminRole.isSuperAdmin,
      isDelegatedAdmin: adminRole.isDelegatedAdmin,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get permissions', 'auth.permissions');
  }
});

export default router;
