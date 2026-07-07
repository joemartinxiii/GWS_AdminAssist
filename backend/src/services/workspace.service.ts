import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getDelegatedAuthClient } from '../config/google.config';

export class WorkspaceService {
  protected auth: OAuth2Client | null = null;
  protected admin: any = null;
  protected drive: any = null;
  protected gmail: any = null;
  protected calendar: any = null;
  protected groups: any = null;
  protected chromePolicy: any = null;

  /**
   * Initialize service clients authenticated as `userEmail` via keyless
   * domain-wide delegation. A subject is always required — every Workspace
   * operation acts on behalf of a specific user.
   */
  async initialize(userEmail?: string): Promise<void> {
    if (!userEmail) {
      throw new Error(
        'WorkspaceService.initialize requires a user email for domain-wide delegation'
      );
    }

    this.auth = await getDelegatedAuthClient(userEmail);

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
  // Returns `any` because the Google API clients (this.admin/drive/gmail/…) are
  // themselves loosely typed; a generic here would infer `unknown` and force a
  // cast at every call site. Callers narrow the result as needed.
  protected async withRetry(
    operation: () => Promise<any>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        // googleapis/gaxios expose the HTTP status in different places
        // depending on the failure; `error.status` alone is often undefined.
        const status: number =
          error?.response?.status ??
          (typeof error?.code === 'number' ? error.code : undefined) ??
          error?.status ??
          0;

        // Rate limiting - wait longer (check before generic 4xx bail-out)
        if (status === 429) {
          const retryAfter = error.response?.headers?.['retry-after'] ?? error.headers?.['retry-after'];
          const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, wait));
          continue;
        }

        // Don't retry on other 4xx errors (client errors)
        if (status >= 400 && status < 500) {
          throw error;
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
