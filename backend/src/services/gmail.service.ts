import { WorkspaceService } from './workspace.service';

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
   * Get email delegations for a user
   */
  async getDelegations(userEmail: string, targetEmail: string): Promise<EmailDelegation[]> {
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.gmail.users.settings.delegates.list({
          userId: targetEmail,
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
    userEmail: string,
    targetEmail: string,
    delegateEmail: string
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.gmail.users.settings.delegates.create({
        userId: targetEmail,
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
    userEmail: string,
    targetEmail: string,
    delegateEmail: string
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.gmail.users.settings.delegates.delete({
        userId: targetEmail,
        delegateEmail,
      })
    );
  }

  /**
   * Get all delegations across all users in the domain
   */
  async getAllDelegations(userEmail: string, maxUsers: number = 500): Promise<Array<{
    userEmail: string;
    delegateEmail: string;
    verificationStatus: string;
  }>> {
    await this.initialize(userEmail);

    // Get all users in the domain
    const admin = this.admin;
    const users: Array<{ primaryEmail: string }> = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        admin.users.list({
          domain: process.env.WORKSPACE_DOMAIN,
          maxResults: Math.min(maxUsers, 500),
          pageToken,
        })
      );

      if (response.data.users) {
        for (const user of response.data.users) {
          users.push({ primaryEmail: user.primaryEmail || '' });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && users.length < maxUsers);

    const allDelegations: Array<{
      userEmail: string;
      delegateEmail: string;
      verificationStatus: string;
    }> = [];

    // Get delegations for each user
    for (const user of users) {
      try {
        const delegations = await this.getDelegations(userEmail, user.primaryEmail);
        for (const delegation of delegations) {
          allDelegations.push({
            userEmail: user.primaryEmail,
            delegateEmail: delegation.delegateEmail,
            verificationStatus: delegation.verificationStatus,
          });
        }
      } catch (error) {
        // Skip users that fail (might not have Gmail enabled)
        console.warn(`Failed to get delegations for ${user.primaryEmail}:`, error);
      }
    }

    return allDelegations;
  }

  /**
   * Get send-as settings for a user
   */
  async getSendAsSettings(userEmail: string, targetEmail: string): Promise<SendAsSettings[]> {
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.gmail.users.settings.sendAs.list({
          userId: targetEmail,
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
    userEmail: string,
    targetEmail: string,
    sendAs: {
      sendAsEmail: string;
      displayName?: string;
      replyToAddress?: string;
    }
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.gmail.users.settings.sendAs.create({
        userId: targetEmail,
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
    userEmail: string,
    targetEmail: string,
    sendAsEmail: string,
    updates: {
      displayName?: string;
      replyToAddress?: string;
      isPrimary?: boolean;
      signature?: string;
    }
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.gmail.users.settings.sendAs.patch({
        userId: targetEmail,
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

    for (const targetEmail of userEmails) {
      try {
        // Resolve per-user variables from the Directory API
        let resolvedHtml = signatureHtml;
        try {
          const userRes = await this.admin.users.get({ userKey: targetEmail, projection: 'full' });
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
    userEmail: string,
    targetEmail: string,
    sendAsEmail: string
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.gmail.users.settings.sendAs.delete({
        userId: targetEmail,
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
    await this.initialize(userEmail);

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
      this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      })
    );
  }
}

export const gmailService = new GmailService();
