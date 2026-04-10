import { Router, Request, Response } from 'express';
import { getAuthUrl } from '../config/google.config';
import { authService } from '../services/auth.service';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { permissionsService } from '../services/permissions.service';

const router = Router();

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
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3000'}/auth/error?error=${error}`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3000'}/auth/error?error=no_code`);
    }

    // Exchange code for tokens
    const tokens = await authService.exchangeCodeForTokens(code);
    
    // Get user info
    const userInfo = await authService.getUserInfo(tokens.accessToken);
    
    // Create session token
    const sessionToken = authService.createSessionToken(userInfo);

    // Redirect to frontend with tokens
    const redirectUrl = new URL(`${process.env.CORS_ORIGIN || 'http://localhost:3000'}/auth/callback`);
    redirectUrl.searchParams.set('token', sessionToken);
    if (tokens.refreshToken) {
      redirectUrl.searchParams.set('refreshToken', tokens.refreshToken);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.redirect(`${process.env.CORS_ORIGIN || 'http://localhost:3000'}/auth/error?error=callback_failed`);
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateSession, async (req: any, res: Response) => {
  try {
    res.json({
      email: req.user?.email,
      name: req.user?.name,
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
    console.error('Error getting permissions:', error);
    res.status(500).json({ error: error.message || 'Failed to get permissions' });
  }
});

export default router;
