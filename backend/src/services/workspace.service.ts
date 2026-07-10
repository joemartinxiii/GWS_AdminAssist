import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getDelegatedAuthClient } from '../config/google.config';

/**
 * Google API clients scoped to a single Workspace subject (impersonated via DWD).
 * Always treat as request-local — never store on a shared service singleton.
 */
export interface WorkspaceClients {
  auth: OAuth2Client;
  /** Admin Directory API (users, groups, org units, resources). */
  admin: any;
  drive: any;
  gmail: any;
  calendar: any;
  /** Alias of admin (directory) for call sites that historically used this.groups. */
  groups: any;
  chromePolicy: any;
}

/**
 * Base helpers for Workspace API access.
 *
 * Concurrency: Cloud Run may handle multiple requests on one process. Singletons
 * must not reassign shared `this.admin` / `this.drive` mid-request. Use
 * `clientsFor(email)` (or the typed helpers) and keep the returned clients in
 * local variables for the duration of the operation.
 */
export class WorkspaceService {
  /**
   * Build a full set of API clients authenticated as `userEmail` via keyless
   * domain-wide delegation. Fresh clients every call — safe under concurrency.
   */
  protected async clientsFor(userEmail: string): Promise<WorkspaceClients> {
    if (!userEmail) {
      throw new Error(
        'WorkspaceService.clientsFor requires a user email for domain-wide delegation'
      );
    }

    const auth = await getDelegatedAuthClient(userEmail);
    const admin = google.admin({ version: 'directory_v1', auth });
    return {
      auth,
      admin,
      drive: google.drive({ version: 'v3', auth }),
      gmail: google.gmail({ version: 'v1', auth }),
      calendar: google.calendar({ version: 'v3', auth }),
      groups: admin,
      chromePolicy: google.chromepolicy({ version: 'v1', auth }),
    };
  }

  protected async adminFor(userEmail: string) {
    return (await this.clientsFor(userEmail)).admin;
  }

  protected async driveFor(userEmail: string) {
    return (await this.clientsFor(userEmail)).drive;
  }

  protected async gmailFor(userEmail: string) {
    return (await this.clientsFor(userEmail)).gmail;
  }

  protected async calendarFor(userEmail: string) {
    return (await this.clientsFor(userEmail)).calendar;
  }

  protected async chromePolicyFor(userEmail: string) {
    return (await this.clientsFor(userEmail)).chromePolicy;
  }

  /**
   * Handle API errors with retry logic.
   * Returns `any` because the Google API clients are loosely typed.
   */
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

        const status: number =
          error?.response?.status ??
          (typeof error?.code === 'number' ? error.code : undefined) ??
          error?.status ??
          0;

        if (status === 429) {
          const retryAfter = error.response?.headers?.['retry-after'] ?? error.headers?.['retry-after'];
          const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }

        if (status >= 400 && status < 500) {
          throw error;
        }

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Check if user has admin privileges (super or delegated).
   */
  async isAdmin(userEmail: string): Promise<boolean> {
    try {
      const admin = await this.adminFor(userEmail);
      const response = await admin.users.get({
        userKey: userEmail,
        projection: 'full',
      });

      return response.data.isAdmin === true || response.data.isDelegatedAdmin === true;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }
}
