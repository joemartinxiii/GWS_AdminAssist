import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

export interface AuthRequest extends Request {
  user?: {
    email: string;
    name: string;
    picture?: string;
  };
  accessToken?: string;
}

/**
 * Middleware to verify JWT session token
 */
export async function authenticateSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.sessionToken;

    if (!token) {
      res.status(401).json({ error: 'No authentication token provided' });
      return;
    }

    const user = authService.verifySessionToken(token);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to verify OAuth2 access token and attach to request
 */
export async function authenticateOAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') ||
                  req.cookies?.accessToken;

    if (!token) {
      res.status(401).json({ error: 'No OAuth token provided' });
      return;
    }

    // Verify token is valid by getting user info
    const userInfo = await authService.getUserInfo(token);
    req.user = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
    };
    req.accessToken = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid OAuth token' });
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
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.sessionToken;

    if (token) {
      const user = authService.verifySessionToken(token);
      req.user = user;
    }
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
}
