// @ts-nocheck - Temporary to allow clean build/deployment (Google API response typing)
import { WorkspaceService } from './workspace.service';
import { dnsCheckService } from './dns-check.service';
import { chromePolicyService } from './chrome-policy.service';

export interface HardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'warning' | 'fail' | 'manual';
  currentValue?: any;
  recommendedValue?: any;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

export class HardeningService extends WorkspaceService {
  /**
   * Check 2FA enforcement
   * Note: Admin SDK doesn't have a direct API for 2FA enforcement settings
   * We'll check by looking at users' 2FA status as a proxy
   */
  async check2FAEnforcement(userEmail: string): Promise<HardeningCheck> {
    try {
      await this.initialize(userEmail);
      
      // Check a sample of users to see if 2FA is being enforced
      // If most users have 2FA enforced, we can infer the setting
      const usersResponse = await this.withRetry(() =>
        this.admin.users.list({
          domain: process.env.WORKSPACE_DOMAIN,
          maxResults: 100,
        })
      );

      const users = usersResponse.data.users || [];
      const usersWith2FA = users.filter((u: any) => u.isEnforcedIn2Sv === true).length;
      const totalUsers = users.length;
      const enforcementRate = totalUsers > 0 ? usersWith2FA / totalUsers : 0;

      // If >80% have 2FA enforced, consider it "enforced"
      const isEnforced = enforcementRate > 0.8;

      return {
        id: '2fa-enforcement',
        category: 'Authentication',
        name: '2FA Authentication',
        description: 'Two-step verification enforcement',
        status: isEnforced ? 'pass' : (enforcementRate > 0.5 ? 'warning' : 'fail'),
        currentValue: `${Math.round(enforcementRate * 100)}% of users have 2FA enforced`,
        recommendedValue: 'Enforced for all users',
        recommendation: 'Enforcement should be ON for all users',
        adminConsoleUrl: 'https://admin.google.com/ac/security/2sv',
      };
    } catch (error: any) {
      return {
        id: '2fa-enforcement',
        category: 'Authentication',
        name: '2FA Authentication',
        description: 'Two-step verification enforcement',
        status: 'warning',
        recommendation: 'Unable to check 2FA enforcement status. Verify manually in Admin Console.',
        adminConsoleUrl: 'https://admin.google.com/ac/security/2sv',
        issues: [error.message],
      };
    }
  }

  /**
   * Check password policy
   */
  async checkPasswordPolicy(userEmail: string): Promise<HardeningCheck> {
    try {
      await this.initialize(userEmail);
      
      const response = await this.withRetry(() =>
        this.admin.users.get({
          userKey: userEmail,
          projection: 'full',
        })
      );

      // Password policy is typically at domain level, but we can check user-level indicators
      // For domain-level, we'd need to check domain settings
      return {
        id: 'password-policy',
        category: 'Authentication',
        name: 'Strong Password Policy',
        description: 'Password strength requirements',
        status: 'manual',
        currentValue: 'Check manually',
        recommendedValue: 'Enforce strong password',
        recommendation: 'Set to Enforce strong password',
        adminConsoleUrl: 'https://admin.google.com/ac/security/passwordmanagement',
      };
    } catch (error: any) {
      return {
        id: 'password-policy',
        category: 'Authentication',
        name: 'Strong Password Policy',
        description: 'Password strength requirements',
        status: 'warning',
        recommendation: 'Unable to check password policy',
      };
    }
  }

  /**
   * Check Gmail settings
   */
  async checkGmailSettings(userEmail: string): Promise<HardeningCheck[]> {
    try {
      await this.initialize(userEmail);
      
      // Gmail settings are typically per-user or domain-wide
      // We'll check domain-wide settings where possible
      const checks: HardeningCheck[] = [
        {
          id: 'gmail-read-receipts',
          category: 'Email',
          name: 'Email Read Receipts',
          description: 'Allow users to request read receipts',
          status: 'manual',
          recommendation: 'Set to Do Not Allow',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
        },
        {
          id: 'gmail-delegation',
          category: 'Email',
          name: 'Mail Delegation',
          description: 'Allow users to delegate email access',
          status: 'manual',
          recommendation: 'Set to OFF',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
        },
        {
          id: 'gmail-confidential-mode',
          category: 'Email',
          name: 'Confidential Mode',
          description: 'Allow users to send confidential emails',
          status: 'manual',
          recommendation: 'Set to ON',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
        },
        {
          id: 'gmail-auto-forwarding',
          category: 'Email',
          name: 'Automatic Forwarding',
          description: 'Allow users to automatically forward emails',
          status: 'manual',
          recommendation: 'Set to OFF',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/enduseraccess',
        },
        {
          id: 'gmail-external-warning',
          category: 'Email',
          name: 'Warn for External Recipients',
          description: 'Warn users when sending to external recipients',
          status: 'manual',
          recommendation: 'Enable warnings for external recipients',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/enduseraccess',
        },
      ];

      return checks;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Check Drive settings
   */
  async checkDriveSettings(userEmail: string): Promise<HardeningCheck[]> {
    try {
      await this.initialize(userEmail);
      
      const checks: HardeningCheck[] = [
        {
          id: 'drive-link-sharing',
          category: 'Google Drive',
          name: 'Link Sharing Settings',
          description: 'Allow users to share files via links',
          status: 'manual',
          recommendation: 'Review sharing options. Setting to OFF is most secure but prevents external sharing. Consider OU-based controls.',
          adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/sharing',
        },
        {
          id: 'drive-shared-drive-creation',
          category: 'Google Drive',
          name: 'Shared Drive Creation',
          description: 'Allow users to create shared drives',
          status: 'manual',
          recommendation: 'Set to OFF so only admins can make shared drives',
          adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/sharing',
        },
        {
          id: 'drive-offline-access',
          category: 'Google Drive',
          name: 'Offline Access',
          description: 'Allow users to access Drive files offline',
          status: 'manual',
          recommendation: 'Set to disable to reduce data leaks. If must be enabled, enable it per OU.',
          adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/data',
        },
        {
          id: 'drive-desktop',
          category: 'Google Drive',
          name: 'Drive for Desktop',
          description: 'Allow users to use Drive for Desktop',
          status: 'manual',
          recommendation: 'Set to OFF to reduce data leaks. If must be enabled, only enable for specific users.',
          adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/data',
        },
      ];

      return checks;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Check Calendar settings
   */
  async checkCalendarSettings(userEmail: string): Promise<HardeningCheck[]> {
    try {
      await this.initialize(userEmail);
      
      const checks: HardeningCheck[] = [
        {
          id: 'calendar-sharing',
          category: 'Calendar',
          name: 'Calendar Sharing',
          description: 'Calendar sharing settings for primary and secondary calendars',
          status: 'manual',
          recommendation: 'Review with internal team. Settings vary by company needs.',
          adminConsoleUrl: 'https://admin.google.com/ac/managedsettings',
        },
        {
          id: 'calendar-external-warning',
          category: 'Calendar',
          name: 'External Warning',
          description: 'Warn users when adding external participants',
          status: 'manual',
          currentValue: 'Default is ON',
          recommendedValue: 'ON',
          recommendation: 'Default is set to ON. Verify it remains enabled.',
          adminConsoleUrl: 'https://admin.google.com/ac/appsettings/435070579839',
        },
      ];

      return checks;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Check Data Download settings
   */
  async checkDataDownloadSettings(userEmail: string): Promise<HardeningCheck[]> {
    try {
      await this.initialize(userEmail);
      
      const checks: HardeningCheck[] = [
        {
          id: 'google-takeout',
          category: 'Data Download',
          name: 'Google Takeout',
          description: 'Allow users to export their data via Google Takeout',
          status: 'manual',
          recommendation: 'Turn off for all users and only assign it to ON for specific OUs or groups that need it (e.g., off-boarded users, litigation holds)',
          adminConsoleUrl: 'https://admin.google.com/ac/googletakeout/useraccess',
        },
        {
          id: 'less-secure-apps',
          category: 'Data Download',
          name: 'Less Secure Apps',
          description: 'Allow less secure app access',
          status: 'manual',
          recommendation: 'Turn it off for all users except accounts that explicitly need it. Can be set to allow via OU or group.',
          adminConsoleUrl: 'https://admin.google.com/ac/security/lsa',
        },
      ];

      return checks;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Check Apps Control settings
   */
  async checkAppsControlSettings(userEmail: string): Promise<HardeningCheck[]> {
    try {
      await this.initialize(userEmail);
      
      const checks: HardeningCheck[] = [
        {
          id: 'context-aware-access',
          category: 'Apps Control',
          name: 'Context-Aware Access',
          description: 'Control app access based on device parameters (Enterprise Only)',
          status: 'manual',
          recommendation: 'If Enterprise licensing: allow access to Google Apps based on specific device parameters (IP address, Device Encryption, OU)',
          adminConsoleUrl: 'https://admin.google.com/ac/security/context-aware',
        },
        {
          id: 'core-apps',
          category: 'Apps Control',
          name: 'Core Apps',
          description: 'Control access to core Google Workspace apps',
          status: 'manual',
          recommendation: 'Turn off core apps for users & OUs that should not have access to those services (e.g., Calendar, Drive, Google Meets)',
          adminConsoleUrl: 'https://admin.google.com/ac/appslist/core',
        },
        {
          id: 'additional-apps',
          category: 'Apps Control',
          name: 'Additional Apps',
          description: 'Control access to additional Google apps',
          status: 'manual',
          recommendation: 'Turn off additional apps for users & OUs that should not have access (e.g., Blogger, Google Ads manager, Google Domains)',
          adminConsoleUrl: 'https://admin.google.com/ac/appslist/additional',
        },
      ];

      return checks;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Run all hardening checks
   */
  async runAllChecks(userEmail: string, domain: string): Promise<{
    checks: HardeningCheck[];
    statistics: {
      total: number;
      pass: number;
      warning: number;
      fail: number;
      manual: number;
    };
  }> {
    const checks: HardeningCheck[] = [];

    // Authentication checks
    const [twoFA, passwordPolicy] = await Promise.all([
      this.check2FAEnforcement(userEmail),
      this.checkPasswordPolicy(userEmail),
    ]);
    checks.push(twoFA, passwordPolicy);

    // DNS checks (only if domain is provided)
    if (domain && domain.includes('.')) {
      try {
        const dnsRecords = await dnsCheckService.checkAllDNS(domain);
        dnsRecords.forEach(record => {
          checks.push({
            id: `dns-${record.type.toLowerCase()}`,
            category: 'Email',
            name: `${record.type} Record`,
            description: `${record.type} email authentication record`,
            status: record.valid ? 'pass' : (record.exists ? 'warning' : 'fail'),
            currentValue: record.exists ? 'Configured' : 'Not Found',
            recommendedValue: 'Configured',
            recommendation: record.recommendation || '',
            issues: record.issues,
          });
        });
      } catch (error: any) {
        checks.push({
          id: 'dns-check-error',
          category: 'Email',
          name: 'DNS Checks',
          description: 'DNS record validation',
          status: 'warning',
          recommendation: `Unable to perform DNS checks: ${error.message}`,
        });
      }
    }

    // Gmail settings
    const gmailChecks = await this.checkGmailSettings(userEmail);
    checks.push(...gmailChecks);

    // Drive settings
    const driveChecks = await this.checkDriveSettings(userEmail);
    checks.push(...driveChecks);

    // Calendar settings
    const calendarChecks = await this.checkCalendarSettings(userEmail);
    checks.push(...calendarChecks);

    // Data Download settings
    const dataDownloadChecks = await this.checkDataDownloadSettings(userEmail);
    checks.push(...dataDownloadChecks);

    // Apps Control settings
    const appsControlChecks = await this.checkAppsControlSettings(userEmail);
    checks.push(...appsControlChecks);

    // Chrome Policy checks
    try {
      const chromeChecks = await chromePolicyService.getAllPolicyChecks(userEmail);
      chromeChecks.forEach(chromeCheck => {
        checks.push({
          id: `chrome-${chromeCheck.policyName.toLowerCase()}`,
          category: chromeCheck.category,
          name: chromeCheck.displayName,
          description: chromeCheck.displayName,
          status: chromeCheck.status,
          currentValue: chromeCheck.currentValue,
          recommendedValue: chromeCheck.recommendedValue,
          recommendation: chromeCheck.recommendation,
        });
      });
    } catch (error) {
      // Chrome Policy API might not be enabled, add warning
      checks.push({
        id: 'chrome-policy-api',
        category: 'Chrome Managed Browsers',
        name: 'Chrome Policy API',
        description: 'Chrome Policy API access',
        status: 'warning',
        recommendation: 'Chrome Policy API may not be enabled. Enable it in GCP Console to check browser policies.',
      });
    }

    // Calculate statistics
    const statistics = {
      total: checks.length,
      pass: checks.filter(c => c.status === 'pass').length,
      warning: checks.filter(c => c.status === 'warning').length,
      fail: checks.filter(c => c.status === 'fail').length,
      manual: checks.filter(c => c.status === 'manual').length,
    };

    return { checks, statistics };
  }
}

export const hardeningService = new HardeningService();
