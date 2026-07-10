import { google } from 'googleapis';
import { WorkspaceService } from './workspace.service';
import { getDelegatedAuthClient } from '../config/google.config';
import { mapWithConcurrency } from '../utils/concurrency';

const GMAIL_SCAN_CONCURRENCY = Number(process.env.GMAIL_SCAN_CONCURRENCY) || 10;

export interface EmailDelegation {
  delegateEmail: string;
  verificationStatus: string;
}

export interface SendAsSettings {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  isPrimary: boolean;
  verificationStatus: string;
}

export class GmailService extends WorkspaceService {
  /**
   * Build a Gmail client impersonating the mailbox owner.
   *
   * Gmail user-settings (delegates, send-as, signatures) can only be managed on
   * the mailbox of the impersonated user, always addressed as `userId: 'me'`.
   * Impersonating the calling admin and passing another user's address as
   * `userId` fails with 403 unless the admin happens to be that same user — which
   * is why delegation previously only worked "from" the signed-in admin.
   *
   * Returns a fresh, local client (does not mutate shared instance state) so it
   * is safe to call concurrently for different mailboxes.
   */
  private async gmailForMailbox(mailboxEmail: string) {
    const auth = await getDelegatedAuthClient(mailboxEmail);
    return google.gmail({ version: 'v1', auth });
  }

  /**
   * Get email delegations for a user
   */
  async getDelegations(_adminEmail: string, targetEmail: string): Promise<EmailDelegation[]> {
    const gmail = await this.gmailForMailbox(targetEmail);

    try {
      const response = await this.withRetry(() =>
        gmail.users.settings.delegates.list({
          userId: 'me',
        })
      );

      const delegations: EmailDelegation[] = [];
      if (response.data.delegates) {
        for (const delegate of response.data.delegates) {
          delegations.push({
            delegateEmail: delegate.delegateEmail || '',
            verificationStatus: delegate.verificationStatus || 'unknown',
          });
        }
      }

      return delegations;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Add email delegation
   */
  async addDelegation(
    _adminEmail: string,
    targetEmail: string,
    delegateEmail: string
  ): Promise<void> {
    const gmail = await this.gmailForMailbox(targetEmail);

    await this.withRetry(() =>
      gmail.users.settings.delegates.create({
        userId: 'me',
        requestBody: {
          delegateEmail,
        },
      })
    );
  }

  /**
   * Remove email delegation
   */
  async removeDelegation(
    _adminEmail: string,
    targetEmail: string,
    delegateEmail: string
  ): Promise<void> {
    const gmail = await this.gmailForMailbox(targetEmail);

    await this.withRetry(() =>
      gmail.users.settings.delegates.delete({
        userId: 'me',
        delegateEmail,
      })
    );
  }

  /**
   * Get all delegations across all users in the domain.
   * Returns coverage metadata so the UI can show partial failures (no Gmail,
   * suspended, rate limits) instead of a silently incomplete table.
   */
  async getAllDelegations(
    userEmail: string,
    maxUsers: number = 500
  ): Promise<{
    delegations: Array<{
      userEmail: string;
      delegateEmail: string;
      verificationStatus: string;
    }>;
    coverage: {
      usersTotal: number;
      usersOk: number;
      usersFailed: number;
      usersSkippedSuspended: number;
      failures: Array<{ email: string; error: string }>;
    };
  }> {
    const admin = await this.adminFor(userEmail);

    // Get all users in the tenant (all domains)
    const users: Array<{ primaryEmail: string; suspended?: boolean }> = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        admin.users.list({
          customer: 'my_customer',
          maxResults: Math.min(maxUsers, 500),
          pageToken,
          projection: 'basic',
        })
      );

      if (response.data.users) {
        for (const user of response.data.users) {
          if (user.primaryEmail) {
            users.push({
              primaryEmail: user.primaryEmail,
              suspended: user.suspended === true,
            });
          }
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && users.length < maxUsers);

    // Fetch each user's delegations with bounded concurrency. Doing this
    // sequentially made the endpoint scale linearly with directory size and
    // time out on larger tenants. Each worker returns a tagged result so
    // counters stay correct under concurrency.
    type ScanResult =
      | { kind: 'skipped' }
      | {
          kind: 'ok';
          rows: Array<{
            userEmail: string;
            delegateEmail: string;
            verificationStatus: string;
          }>;
        }
      | { kind: 'fail'; email: string; error: string };

    const scanned = await mapWithConcurrency(users, GMAIL_SCAN_CONCURRENCY, async (user): Promise<ScanResult> => {
      if (user.suspended) {
        return { kind: 'skipped' };
      }
      try {
        const delegations = await this.getDelegations(userEmail, user.primaryEmail);
        return {
          kind: 'ok',
          rows: delegations.map((delegation) => ({
            userEmail: user.primaryEmail,
            delegateEmail: delegation.delegateEmail,
            verificationStatus: delegation.verificationStatus,
          })),
        };
      } catch (error: any) {
        const message =
          error?.response?.data?.error?.message ||
          error?.message ||
          String(error);
        console.warn(`Failed to get delegations for ${user.primaryEmail}:`, message);
        return { kind: 'fail', email: user.primaryEmail, error: message };
      }
    });

    const failures = scanned
      .filter((r): r is Extract<ScanResult, { kind: 'fail' }> => r.kind === 'fail')
      .map((r) => ({ email: r.email, error: r.error }));
    const usersOk = scanned.filter((r) => r.kind === 'ok').length;
    const usersSkippedSuspended = scanned.filter((r) => r.kind === 'skipped').length;
    const delegations = scanned.flatMap((r) => (r.kind === 'ok' ? r.rows : []));

    return {
      delegations,
      coverage: {
        usersTotal: users.length,
        usersOk,
        usersFailed: failures.length,
        usersSkippedSuspended,
        // Cap failure detail so large tenants don't return megabyte payloads
        failures: failures.slice(0, 50),
      },
    };
  }

  /**
   * Get send-as settings for a user
   */
  async getSendAsSettings(_adminEmail: string, targetEmail: string): Promise<SendAsSettings[]> {
    const gmail = await this.gmailForMailbox(targetEmail);

    try {
      const response = await this.withRetry(() =>
        gmail.users.settings.sendAs.list({
          userId: 'me',
        })
      );

      const sendAsList: SendAsSettings[] = [];
      if (response.data.sendAs) {
        for (const sendAs of response.data.sendAs) {
          sendAsList.push({
            sendAsEmail: sendAs.sendAsEmail || '',
            displayName: sendAs.displayName,
            replyToAddress: sendAs.replyToAddress,
            isPrimary: sendAs.isPrimary === true,
            verificationStatus: sendAs.verificationStatus || 'unknown',
          });
        }
      }

      return sendAsList;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Create send-as alias
   */
  async createSendAs(
    _adminEmail: string,
    targetEmail: string,
    sendAs: {
      sendAsEmail: string;
      displayName?: string;
      replyToAddress?: string;
    }
  ): Promise<void> {
    const gmail = await this.gmailForMailbox(targetEmail);

    await this.withRetry(() =>
      gmail.users.settings.sendAs.create({
        userId: 'me',
        requestBody: {
          sendAsEmail: sendAs.sendAsEmail,
          displayName: sendAs.displayName,
          replyToAddress: sendAs.replyToAddress,
        },
      })
    );
  }

  /**
   * Update send-as settings
   */
  async updateSendAs(
    _adminEmail: string,
    targetEmail: string,
    sendAsEmail: string,
    updates: {
      displayName?: string;
      replyToAddress?: string;
      isPrimary?: boolean;
      signature?: string;
    }
  ): Promise<void> {
    const gmail = await this.gmailForMailbox(targetEmail);

    await this.withRetry(() =>
      gmail.users.settings.sendAs.patch({
        userId: 'me',
        sendAsEmail,
        requestBody: updates,
      })
    );
  }

  /**
   * Replace {{varName}} placeholders in a template string with values from a map.
   * Unknown variables are left as empty strings.
   */
  static substituteVariables(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  }

  /**
   * Set the primary send-as signature (HTML) for many users. Uses each user's primary identity.
   * Substitutes per-user directory variables ({{firstName}}, {{title}}, etc.) before pushing.
   */
  async batchSetPrimarySignatures(
    adminEmail: string,
    userEmails: string[],
    signatureHtml: string
  ): Promise<{ succeeded: string[]; failed: Array<{ email: string; error: string }> }> {
    const succeeded: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];

    // Directory reads use admin-scoped client (request-local). Per-user send-as
    // calls build their own mailbox-scoped clients via gmailForMailbox.
    const admin = await this.adminFor(adminEmail);

    for (const targetEmail of userEmails) {
      try {
        // Resolve per-user variables from the Directory API
        let resolvedHtml = signatureHtml;
        try {
          const userRes = await admin.users.get({ userKey: targetEmail, projection: 'full' });
          const u = userRes.data;
          const orgs = (u.organizations as any[] | undefined) ?? [];
          const phones = (u.phones as any[] | undefined) ?? [];
          const vars: Record<string, string> = {
            firstName:  u.name?.givenName  || '',
            lastName:   u.name?.familyName || '',
            fullName:   u.name?.fullName   || '',
            email:      u.primaryEmail     || '',
            title:      orgs[0]?.title      || '',
            department: orgs[0]?.department || '',
            phone:      phones[0]?.value    || '',
            company:    orgs[0]?.name       || '',
          };
          resolvedHtml = GmailService.substituteVariables(signatureHtml, vars);
        } catch {
          // If profile fetch fails, push the template as-is
        }

        const list = await this.getSendAsSettings(adminEmail, targetEmail);
        const primary = list.find((s) => s.isPrimary) ?? list[0];
        if (!primary) {
          failed.push({ email: targetEmail, error: 'No send-as identity found' });
          continue;
        }
        await this.updateSendAs(adminEmail, targetEmail, primary.sendAsEmail, {
          signature: resolvedHtml,
        });
        succeeded.push(targetEmail);
      } catch (error: any) {
        failed.push({
          email: targetEmail,
          error: error?.message || String(error),
        });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Delete send-as alias
   */
  async deleteSendAs(
    _adminEmail: string,
    targetEmail: string,
    sendAsEmail: string
  ): Promise<void> {
    const gmail = await this.gmailForMailbox(targetEmail);

    await this.withRetry(() =>
      gmail.users.settings.sendAs.delete({
        userId: 'me',
        sendAsEmail,
      })
    );
  }

  /**
   * Send an email using Gmail API
   */
  async sendEmail(
    userEmail: string,
    to: string | string[],
    subject: string,
    body: string,
    isHtml: boolean = false
  ): Promise<void> {
    const gmail = await this.gmailFor(userEmail);

    const recipients = Array.isArray(to) ? to.join(', ') : to;

    const headers = [
      `To: ${recipients}`,
      `Subject: ${subject}`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    ];

    const message = `${headers.join('\n')}\n\n${body}`;

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await this.withRetry(() =>
      gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      })
    );
  }
}

export const gmailService = new GmailService();
