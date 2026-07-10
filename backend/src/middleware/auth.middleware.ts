import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { SESSION_COOKIE_NAME } from '../utils/sessionCookie';

export interface AuthRequest extends Request {
  user?: {
    email: string;
    name: string;
    picture?: string;
  };
  accessToken?: string;
}

/**
 * Prefer HttpOnly session cookie; accept Authorization Bearer for automation
 * (Playwright, live tests, curl) only — the SPA does not store tokens.
 */
function extractSessionToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return undefined;
}

/**
 * Middleware to verify JWT session token (cookie or Bearer).
 */
export async function authenticateSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      res.status(401).json({ error: 'No authentication token provided' });
      return;
    }

    const user = authService.verifySessionToken(token);
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractSessionToken(req);

    if (token) {
      const user = authService.verifySessionToken(token);
      req.user = user;
    }
    next();
  } catch {
    next();
  }
}
