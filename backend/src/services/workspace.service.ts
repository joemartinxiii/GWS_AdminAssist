import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { getServiceAccountClient, getGoogleConfig } from '../config/google.config';

export class WorkspaceService {
  protected auth: JWT | null = null;
  protected admin: any = null;
  protected drive: any = null;
  protected gmail: any = null;
  protected calendar: any = null;
  protected groups: any = null;
  protected chromePolicy: any = null;

  /**
   * Initialize service with delegated authentication
   */
  async initialize(userEmail?: string): Promise<void> {
    if (userEmail) {
      this.auth = await getServiceAccountClient();
      this.auth.subject = userEmail;
    } else {
      this.auth = await getServiceAccountClient();
    }

    // Initialize API clients
    this.admin = google.admin({ version: 'directory_v1', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
    this.groups = google.admin({ version: 'directory_v1', auth: this.auth });
    this.chromePolicy = google.chromepolicy({ version: 'v1', auth: this.auth });
  }

  /**
   * Handle API errors with retry logic
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        // Don't retry on 4xx errors (client errors)
        if (error.status >= 400 && error.status < 500) {
          throw error;
        }

        // Rate limiting - wait longer
        if (error.status === 429) {
          const retryAfter = error.headers?.['retry-after'] 
            ? parseInt(error.headers['retry-after']) * 1000
            : delay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          continue;
        }

        // Wait before retry
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Check if user has admin privileges
   */
  async isAdmin(userEmail: string): Promise<boolean> {
    try {
      await this.initialize(userEmail);
      const response = await this.admin.users.get({
        userKey: userEmail,
        projection: 'full',
      });
      
      const isAdmin = response.data.isAdmin === true || 
                     response.data.isDelegatedAdmin === true;
      return isAdmin;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }
}
