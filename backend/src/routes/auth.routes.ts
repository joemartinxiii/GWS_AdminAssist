import { Router, Request, Response } from 'express';
import { getAuthUrl } from '../config/google.config';
import { authService } from '../services/auth.service';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { permissionsService } from '../services/permissions.service';
import { isEmailInAllowedDomain, getAllowedDomains } from '../utils/validation';
import { sendApiError } from '../utils/apiError';

const router = Router();

function frontendBase(): string {
  return process.env.CORS_ORIGIN?.split(',')[0].trim() || 'http://localhost:3000';
}

/**
 * GET /api/auth/login
 * Get OAuth2 authorization URL
 */
router.get('/login', (req: Request, res: Response) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * GET /api/auth/callback
 * OAuth2 callback endpoint
 */
router.get('/callback', async (req: Request, res: Response) => {
  const base = frontendBase();
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`${base}/auth/error?error=${encodeURIComponent(String(error))}`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${base}/auth/error?error=no_code`);
    }

    // Exchange code for tokens
    const tokens = await authService.exchangeCodeForTokens(code);

    // Get user info
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

    // Create session token
    const sessionToken = authService.createSessionToken(userInfo);

    // Return tokens in the URL *fragment* (not query string): fragments are not
    // sent to the server, recorded in access logs, or leaked via the Referer
    // header, unlike query parameters.
    const params = new URLSearchParams();
    params.set('token', sessionToken);
    if (tokens.refreshToken) {
      params.set('refreshToken', tokens.refreshToken);
    }
    res.redirect(`${base}/auth/callback#${params.toString()}`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.redirect(`${base}/auth/error?error=callback_failed`);
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateSession, async (req: any, res: Response) => {
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
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const tokens = await authService.refreshAccessToken(refreshToken);
    res.json(tokens);
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client should clear tokens)
 */
router.post('/logout', authenticateSession, (req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/permissions
 * Get user's permissions based on Google Workspace admin roles
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
