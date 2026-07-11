import { apiClient } from './api.client';

export interface User {
  email: string;
  name: string;
  picture?: string;
  /** Internal domains (WORKSPACE_DOMAIN + GWS_ALLOWED_DOMAINS) for external-share classification. */
  allowedDomains?: string[];
  /** Emails that cannot be permanently deleted (from GWS_PROTECTED_USERS). */
  protectedUsers?: string[];
}

/**
 * Session is an HttpOnly cookie set by the backend OAuth callback.
 * The SPA never stores JWTs or Google tokens in localStorage.
 */
class AuthService {
  private cachedUser: User | null = null;
  private sessionKnown = false;

  /**
   * Get OAuth2 login URL (also sets oauth_state cookie server-side).
   */
  async getAuthUrl(): Promise<string> {
    const response = await apiClient.get('/auth/login');
    return response.data.authUrl;
  }

  /**
   * Validate session via cookie and return the current user.
   */
  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get('/auth/me');
    this.cachedUser = response.data;
    this.sessionKnown = true;
    return response.data;
  }

  /**
   * Probe session (cookie). Returns null if not signed in.
   */
  async checkSession(): Promise<User | null> {
    try {
      return await this.getCurrentUser();
    } catch {
      this.cachedUser = null;
      this.sessionKnown = true;
      return null;
    }
  }

  /**
   * Logout — clears HttpOnly session cookie on the server.
   */
  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore errors on logout
    } finally {
      this.cachedUser = null;
      this.sessionKnown = true;
      try {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('refreshToken');
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Last known session user (from checkSession / getCurrentUser). Not a live check.
   */
  getCachedUser(): User | null {
    return this.cachedUser;
  }

  /**
   * True only after a successful checkSession/getCurrentUser in this page load.
   * Prefer checkSession() for route guards.
   */
  hasCachedSession(): boolean {
    return this.sessionKnown && !!this.cachedUser;
  }
}

export const authService = new AuthService();
