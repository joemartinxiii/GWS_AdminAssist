import jwt from 'jsonwebtoken';
import { getOAuth2Client, getTokensFromCode } from '../config/google.config';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('CRITICAL: JWT_SECRET environment variable not set!');
  throw new Error('JWT_SECRET environment variable is required');
}
// TypeScript now knows JWT_SECRET is defined
const jwtSecret: string = JWT_SECRET;
// Default 8h: privileged admin console; shorter TTL reduces stolen-session window.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface UserInfo {
  email: string;
  name: string;
  picture?: string;
}

export class AuthService {
  /**
   * Exchange OAuth2 code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<AuthTokens> {
    const tokens = await getTokensFromCode(code);
    
    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    const expiresAt = tokens.expiry_date 
      ? new Date(tokens.expiry_date).getTime()
      : Date.now() + 3600000; // Default 1 hour

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    };
  }

  /**
   * Get user info from OAuth2 token
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = (await import('googleapis')).google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    return {
      email: data.email || '',
      name: data.name || '',
      picture: data.picture || undefined,
    };
  }

  /**
   * Create a JWT token for session management
   */
  createSessionToken(userInfo: UserInfo): string {
    return jwt.sign(
      {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      },
      jwtSecret,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
  }

  /**
   * Verify a JWT session token
   */
  verifySessionToken(token: string): { email: string; name: string; picture?: string } {
    try {
      const decoded = jwt.verify(token, jwtSecret as string) as jwt.JwtPayload & { email: string; name: string; picture?: string };
      if (!decoded.email || !decoded.name) {
        throw new Error('Invalid token payload');
      }
      return { email: decoded.email, name: decoded.name, picture: decoded.picture };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

}

export const authService = new AuthService();
