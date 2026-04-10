import { apiClient } from './api.client';
import { isDemoMode } from '../data/demoData';

export interface User {
  email: string;
  name: string;
}

class AuthService {
  private sessionToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    // Load tokens from localStorage on initialization
    this.sessionToken = localStorage.getItem('sessionToken');
    this.refreshToken = localStorage.getItem('refreshToken');
    
    // DEMO MODE: Set a fake token for UI preview
    if (isDemoMode() && !this.sessionToken) {
      this.sessionToken = 'demo-token';
      localStorage.setItem('sessionToken', 'demo-token');
    }
  }

  /**
   * Get OAuth2 login URL
   */
  async getAuthUrl(): Promise<string> {
    const response = await apiClient.get('/auth/login');
    return response.data.authUrl;
  }

  /**
   * Set session token
   */
  setSessionToken(token: string, refreshToken?: string): void {
    this.sessionToken = token;
    localStorage.setItem('sessionToken', token);
    
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem('refreshToken', refreshToken);
    }
  }

  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get('/auth/me');
    return response.data;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await apiClient.post('/auth/refresh', {
        refreshToken: this.refreshToken,
      });

      this.setSessionToken(response.data.accessToken, response.data.refreshToken);
    } catch (error) {
      // Refresh failed, clear tokens and redirect to login
      this.logout();
      throw error;
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      // Ignore errors on logout
    } finally {
      this.sessionToken = null;
      this.refreshToken = null;
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('refreshToken');
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    // DEMO MODE: Always return true for UI preview
    if (isDemoMode()) {
      return true;
    }
    return !!this.sessionToken;
  }

  /**
   * Get session token
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }
}

export const authService = new AuthService();
