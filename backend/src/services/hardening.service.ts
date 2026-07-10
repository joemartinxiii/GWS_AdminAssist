import { WorkspaceService } from './workspace.service';
import { dnsCheckService } from './dns-check.service';
import { chromePolicyService } from './chrome-policy.service';
import {
  policyService,
  PolicySnapshot,
  PolicyLookup,
  readBool,
  readString,
} from './policy.service';

export interface HardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  /**
   * `info` marks org-dependent settings that have no universal "right" answer
   * (e.g. mail delegation, calendar sharing) — surfaced for awareness, not
   * graded against a target.
   */
  status: 'pass' | 'warning' | 'fail' | 'manual' | 'info';
  /** How this check was resolved — used by the UI to explain manual items. */
  source: 'auto' | 'manual';
  currentValue?: any;
  recommendedValue?: any;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

/** Static definition of a checklist item, mirroring GWS_HARDENING.md / the source PDF. */
interface CheckMeta {
  id: string;
  category: string;
  name: string;
  description: string;
  /** Short target state, shown in the "Recommended" column. */
  recommendedValue: string;
  /** Actionable guidance (the "why/how"). */
  recommendation: string;
  adminConsoleUrl?: string;
}

type EvalResult = {
  status: HardeningCheck['status'];
  currentValue: string;
  issues?: string[];
};

type Evaluator = (value: Record<string, unknown>, lookup: PolicyLookup) => EvalResult;

const HUMAN_ENUM: Record<string, string> = {
  EXTERNAL_FREE_BUSY_ONLY: 'Free/busy only',
  EXTERNAL_ALL_INFO_READ_ONLY: 'See all info',
  EXTERNAL_ALL_INFO_READ_WRITE: 'See + change',
  EXTERNAL_ALL_INFO_READ_WRITE_MANAGE: 'Manage sharing',
  DISALLOWED: 'Off (internal only)',
  ALLOWLISTED_DOMAINS: 'Allowlisted domains only',
  ALLOWED: 'On (anyone external)',
  PRIVATE_TO_OWNER: 'Private to owner',
  PRIMARY_AUDIENCE_WITH_LINK: 'Anyone in org with link',
  PRIMARY_AUDIENCE_WITH_LINK_OR_SEARCH: 'Org with link or search',
  ALL_ELIGIBLE_USERS: 'All users',
  ELIGIBLE_INTERNAL_USERS: 'Internal users',
  NONE: 'None',
};

function humanEnum(v: string | undefined): string {
  if (!v) return 'Unknown';
  return HUMAN_ENUM[v] ?? v;
}

export class HardeningService extends WorkspaceService {
  // --- Generic builders -----------------------------------------------------

  private baseFrom(meta: CheckMeta): Omit<HardeningCheck, 'status' | 'source'> {
    return {
      id: meta.id,
      category: meta.category,
      name: meta.name,
      description: meta.description,
      recommendedValue: meta.recommendedValue,
      recommendation: meta.recommendation,
      adminConsoleUrl: meta.adminConsoleUrl,
    };
  }

  /** A check that cannot be read via API and must be verified in the console. */
  private manualCheck(meta: CheckMeta, reason: string): HardeningCheck {
    return {
      ...this.baseFrom(meta),
      status: 'manual',
      source: 'manual',
      currentValue: 'Manual review',
      issues: [reason],
    };
  }

  /**
   * A check resolved from a Cloud Identity policy value. Falls back to a manual
   * result when the Policy API is unavailable or the setting isn't returned
   * (unless `evaluateOnMissing` is set, for array/presence-based checks where an
   * absent policy is itself meaningful).
   */
  private policyCheck(
    snapshot: PolicySnapshot,
    meta: CheckMeta,
    settingType: string,
    evaluate: Evaluator,
    options: { evaluateOnMissing?: boolean } = {}
  ): HardeningCheck {
    const base = this.baseFrom(meta);

    if (!snapshot.available) {
      return {
        ...base,
        status: 'manual',
        source: 'manual',
        currentValue: 'Manual review',
        issues: ['Cloud Identity Policy API unavailable — verify in Admin console'],
      };
    }

    const lookup = snapshot.get(settingType);
    if (!lookup.found && !options.evaluateOnMissing) {
      return {
        ...base,
        status: 'manual',
        source: 'manual',
        currentValue: 'Not explicitly configured',
        issues: ['No org policy returned — a Google default likely applies. Confirm in console.'],
      };
    }

    const result = evaluate(lookup.value ?? {}, lookup);
    const issues = result.issues ? [...result.issues] : [];
    if (lookup.scopeCount > 1) {
      issues.push(`Overridden across ${lookup.scopeCount} org units — showing one scope`);
    }

    return {
      ...base,
      status: result.status,
      source: 'auto',
      currentValue: result.currentValue,
      issues: issues.length ? issues : undefined,
    };
  }

  // --- Authentication -------------------------------------------------------

  /**
   * 2FA enforcement — inferred from the share of users flagged as enforced,
   * since there is no single org-level read for the enforcement schedule.
   */
  async check2FAEnforcement(userEmail: string): Promise<HardeningCheck> {
    const meta: CheckMeta = {
      id: '2fa-enforcement',
      category: 'Authentication',
      name: '2-Step Verification',
      description: 'Two-step verification enforcement across users',
      recommendedValue: 'Enforced for all users',
      recommendation: 'Enforcement should be ON for all users.',
      adminConsoleUrl: 'https://admin.google.com/ac/security/2sv',
    };
    try {
      const admin = await this.adminFor(userEmail);
      const usersResponse = await this.withRetry(() =>
        admin.users.list({ customer: 'my_customer', maxResults: 100 })
      );
      const users = usersResponse.data.users || [];
      const usersWith2FA = users.filter((u: any) => u.isEnforcedIn2Sv === true).length;
      const totalUsers = users.length;
      const rate = totalUsers > 0 ? usersWith2FA / totalUsers : 0;
      return {
        ...this.baseFrom(meta),
        status: rate > 0.8 ? 'pass' : rate > 0.5 ? 'warning' : 'fail',
        source: 'auto',
        currentValue: `${Math.round(rate * 100)}% of users enforced (${usersWith2FA}/${totalUsers})`,
      };
    } catch (error: any) {
      return {
        ...this.baseFrom(meta),
        status: 'warning',
        source: 'auto',
        currentValue: 'Unknown',
        issues: [error.message],
      };
    }
  }

  private authenticationChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    return [
      this.policyCheck(
        snapshot,
        {
          id: 'password-policy',
          category: 'Authentication',
          name: 'Strong Password Policy',
          description: 'Password strength and enforcement requirements',
          recommendedValue: 'Strong, enforced at login',
          recommendation: 'Set to enforce a strong password (minimum length ≥ 12 recommended).',
          adminConsoleUrl: 'https://admin.google.com/ac/security/passwordmanagement',
        },
        'security.password',
        (value) => {
          const strength = readString(value, 'allowedStrength');
          const enforced = readBool(value, 'enforceRequirementsAtLogin');
          const min = value['minimumLength'];
          const isStrong = strength === 'STRONG';
          const parts = [
            `Strength: ${strength ?? 'unknown'}`,
            typeof min === 'number' ? `min length: ${min}` : null,
            `enforced at login: ${enforced ? 'yes' : 'no'}`,
          ].filter(Boolean);
          return {
            status: isStrong && enforced ? 'pass' : isStrong || enforced ? 'warning' : 'fail',
            currentValue: parts.join(', '),
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'advanced-protection',
          category: 'Authentication',
          name: 'Advanced Protection Program',
          description: 'User self-enrollment in the Advanced Protection Program',
          recommendedValue: 'Enrollment enabled',
          recommendation: 'Enable user enrollment (if not turned on by default).',
          adminConsoleUrl: 'https://admin.google.com/ac/security/advanced-protection',
        },
        'security.advanced_protection_program',
        (value) => {
          const enabled = readBool(value, 'enableAdvancedProtectionSelfEnrollment');
          return {
            status: enabled ? 'pass' : 'warning',
            currentValue: enabled ? 'Enrollment enabled' : 'Enrollment disabled',
          };
        }
      ),
    ];
  }

  // --- Email ----------------------------------------------------------------

  private emailChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    const gmailUserSettings = 'https://admin.google.com/ac/apps/gmail/usersettings';
    const gmailEndUser = 'https://admin.google.com/ac/apps/gmail/enduseraccess';
    const gmailSafety = 'https://admin.google.com/ac/apps/gmail/safety';
    const gmailSpam = 'https://admin.google.com/ac/apps/gmail/spam';

    return [
      this.manualCheck(
        {
          id: 'gmail-read-receipts',
          category: 'Email',
          name: 'Email Read Receipts',
          description: 'Whether users can request read receipts',
          recommendedValue: 'Do not allow',
          recommendation: 'Set to Do Not Allow.',
          adminConsoleUrl: gmailUserSettings,
        },
        'Not exposed by the Policy API — verify in Admin console.'
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-delegation',
          category: 'Email',
          name: 'Mail Delegation',
          description: 'Whether users can delegate mailbox access to others',
          recommendedValue: 'OFF unless there is a business need',
          recommendation:
            'Keep OFF unless a business need requires mailbox delegation (e.g. shared/assistant mailboxes). Enable narrowly by OU if so.',
          adminConsoleUrl: gmailUserSettings,
        },
        'gmail.mail_delegation',
        (value) => {
          const enabled = readBool(value, 'enableMailDelegation');
          // Org-dependent: "on" is a deliberate choice, not a failure.
          return {
            status: enabled ? 'info' : 'pass',
            currentValue: enabled ? 'Delegation allowed' : 'Delegation off',
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-confidential-mode',
          category: 'Email',
          name: 'Confidential Mode',
          description: 'Whether users can send confidential-mode email',
          recommendedValue: 'ON',
          recommendation: 'Set to ON.',
          adminConsoleUrl: gmailUserSettings,
        },
        'gmail.confidential_mode',
        (value) => {
          const enabled = readBool(value, 'enableConfidentialMode');
          return {
            status: enabled ? 'pass' : 'warning',
            currentValue: enabled ? 'On' : 'Off',
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-restrict-delivery',
          category: 'Email',
          name: 'Email Receiving Security',
          description: 'Restrict inbound delivery to allowlisted domains',
          recommendedValue: 'Whitelist trusted domains',
          recommendation: 'Utilize whitelisting of domains for inbound delivery.',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/compliance',
        },
        'gmail.restrict_delivery',
        (value) => {
          const rules = value['restrictDeliveryRules'];
          const count = Array.isArray(rules) ? rules.length : 0;
          return {
            status: count > 0 ? 'pass' : 'warning',
            currentValue: count > 0 ? `${count} restrict-delivery rule(s)` : 'No inbound restrictions',
          };
        },
        { evaluateOnMissing: true }
      ),
      this.manualCheck(
        {
          id: 'gmail-external-warning',
          category: 'Email',
          name: 'Warn for External Recipients',
          description: 'Warn users before replying to external recipients / sending externally',
          recommendedValue: 'ON',
          recommendation: 'Turn on the external-recipient warning so users are alerted when sending outside the org.',
          adminConsoleUrl: gmailEndUser,
        },
        'Not exposed by the Policy API — verify in Admin console.'
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-enhanced-scanning',
          category: 'Email',
          name: 'Enhanced Pre-Delivery Scanning',
          description: 'Improved detection of suspicious content before delivery',
          recommendedValue: 'ON',
          recommendation: 'Set enhanced pre-delivery message scanning to ON.',
          adminConsoleUrl: gmailSafety,
        },
        'gmail.enhanced_pre_delivery_message_scanning',
        (value) => {
          const enabled = readBool(value, 'enableImprovedSuspiciousContentDetection');
          return {
            status: enabled ? 'pass' : 'warning',
            currentValue: enabled ? 'On' : 'Off',
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-spam-bypass',
          category: 'Email',
          name: 'Spam Filter Bypass',
          description: 'Approved-sender lists that bypass spam filtering',
          recommendedValue: 'No bypasses',
          recommendation: "Don't bypass internal spam filters; avoid hiding warnings for all senders.",
          adminConsoleUrl: gmailSpam,
        },
        'gmail.spam_override_lists',
        (value) => {
          const rules = value['spamOverride'];
          const list = Array.isArray(rules) ? (rules as Record<string, unknown>[]) : [];
          const hidesAll = list.some((r) => readBool(r, 'hideWarningBannerForAll') === true);
          const bypasses = list.some(
            (r) =>
              readBool(r, 'bypassInternalSenders') === true ||
              readBool(r, 'bypassSelectedSenders') === true ||
              readBool(r, 'hideWarningBannerFromSelectedSenders') === true
          );
          if (hidesAll) {
            return { status: 'fail', currentValue: 'Warnings hidden for all senders' };
          }
          if (bypasses) {
            return { status: 'warning', currentValue: 'Some spam bypass configured' };
          }
          return { status: 'pass', currentValue: 'No spam bypasses' };
        },
        { evaluateOnMissing: true }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'gmail-auto-forwarding',
          category: 'Email',
          name: 'Automatic Forwarding',
          description: 'Whether users can auto-forward incoming mail externally',
          recommendedValue: 'OFF',
          recommendation: 'Set to OFF to stop users automatically forwarding incoming email.',
          adminConsoleUrl: gmailEndUser,
        },
        'gmail.auto_forwarding',
        (value) => {
          const enabled = readBool(value, 'enableAutoForwarding');
          return {
            status: enabled ? 'warning' : 'pass',
            currentValue: enabled ? 'Allowed' : 'Off',
          };
        }
      ),
    ];
  }

  // --- Advanced Phishing & Malware -----------------------------------------

  private phishingMalwareChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    const gmailSafety = 'https://admin.google.com/ac/apps/gmail/safety';
    const allSomeNone = (flags: (boolean | undefined)[]): HardeningCheck['status'] => {
      const on = flags.filter((f) => f === true).length;
      if (on === flags.length) return 'pass';
      if (on === 0) return 'fail';
      return 'warning';
    };

    return [
      this.policyCheck(
        snapshot,
        {
          id: 'phishing-attachments',
          category: 'Advanced Phishing & Malware',
          name: 'Attachments',
          description: 'Protection against unsafe attachments from untrusted senders',
          recommendedValue: 'All protections on',
          recommendation: 'Protect against unwanted attachments per Google (encrypted, scripts, anomalous types).',
          adminConsoleUrl: gmailSafety,
        },
        'gmail.email_attachment_safety',
        (value) => {
          const enc = readBool(value, 'enableEncryptedAttachmentProtection');
          const scr = readBool(value, 'enableAttachmentWithScriptsProtection');
          const anom = readBool(value, 'enableAnomalousAttachmentProtection');
          return {
            status: allSomeNone([enc, scr, anom]),
            currentValue: `Encrypted: ${enc ? 'on' : 'off'}, scripts: ${scr ? 'on' : 'off'}, anomalous: ${anom ? 'on' : 'off'}`,
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'phishing-links',
          category: 'Advanced Phishing & Malware',
          name: 'External Links & Images',
          description: 'Protection against unsafe links and external images',
          recommendedValue: 'All protections on',
          recommendation: 'Protect against unwanted external links and images per Google.',
          adminConsoleUrl: gmailSafety,
        },
        'gmail.links_and_external_images',
        (value) => {
          const shortener = readBool(value, 'enableShortenerScanning');
          const images = readBool(value, 'enableExternalImageScanning');
          const aggressive = readBool(value, 'enableAggressiveWarningsOnUntrustedLinks');
          return {
            status: allSomeNone([shortener, images, aggressive]),
            currentValue: `Shortener scan: ${shortener ? 'on' : 'off'}, image scan: ${images ? 'on' : 'off'}, link warnings: ${aggressive ? 'on' : 'off'}`,
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'phishing-spoofing',
          category: 'Advanced Phishing & Malware',
          name: 'Spoofing & Authentication',
          description: 'Protection against spoofing and unauthenticated senders',
          recommendedValue: 'All protections on',
          recommendation: 'Protect against spoofing and malicious email authentication per Google.',
          adminConsoleUrl: gmailSafety,
        },
        'gmail.spoofing_and_authentication',
        (value) => {
          const flags = [
            readBool(value, 'detectDomainNameSpoofing'),
            readBool(value, 'detectEmployeeNameSpoofing'),
            readBool(value, 'detectDomainSpoofingFromUnauthenticatedSenders'),
            readBool(value, 'detectUnauthenticatedEmails'),
            readBool(value, 'detectGroupsSpoofing'),
          ];
          const on = flags.filter((f) => f === true).length;
          return {
            status: allSomeNone(flags),
            currentValue: `${on}/${flags.length} spoofing protections on`,
          };
        }
      ),
    ];
  }

  // --- Calendar -------------------------------------------------------------

  private calendarChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    const calSharing = 'https://admin.google.com/ac/apps/calendar';
    const externalSharingEval = (value: Record<string, unknown>): EvalResult => {
      const mode = readString(value, 'maxAllowedExternalSharing');
      const secure = mode === 'EXTERNAL_FREE_BUSY_ONLY';
      // Sharing breadth is a business decision — flag broader-than-free/busy as
      // info (for review) rather than a warning.
      return {
        status: secure ? 'pass' : 'info',
        currentValue: humanEnum(mode),
      };
    };

    return [
      this.policyCheck(
        snapshot,
        {
          id: 'calendar-primary-sharing',
          category: 'Calendar',
          name: 'Primary Calendar Sharing',
          description: 'External sharing level for users\u2019 primary calendars',
          recommendedValue: 'Org-dependent (free/busy is most secure)',
          recommendation: 'Review with the internal team — every company differs. Free/busy only is the most private.',
          adminConsoleUrl: calSharing,
        },
        'calendar.primary_calendar_max_allowed_external_sharing',
        externalSharingEval
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'calendar-secondary-sharing',
          category: 'Calendar',
          name: 'Secondary Calendar Sharing',
          description: 'External sharing level for secondary calendars',
          recommendedValue: 'Org-dependent (free/busy is most secure)',
          recommendation: 'Review with the internal team — every company differs. Free/busy only is the most private.',
          adminConsoleUrl: calSharing,
        },
        'calendar.secondary_calendar_max_allowed_external_sharing',
        externalSharingEval
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'calendar-external-warning',
          category: 'Calendar',
          name: 'External Invitation Warning',
          description: 'Warn users when inviting guests outside the domain',
          recommendedValue: 'ON',
          recommendation: 'Keep the external-guest warning ON (this is the default).',
          adminConsoleUrl: calSharing,
        },
        'calendar.external_invitations',
        (value) => {
          const warn = readBool(value, 'warnOnInvite');
          return {
            status: warn ? 'pass' : 'warning',
            currentValue: warn ? 'On' : 'Off',
          };
        }
      ),
    ];
  }

  // --- Google Drive ---------------------------------------------------------

  private driveChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    const sharing = 'https://admin.google.com/ac/appsettings/55656082996/sharing';
    const features = 'https://admin.google.com/ac/appsettings/55656082996/data';

    return [
      this.policyCheck(
        snapshot,
        {
          id: 'drive-link-sharing',
          category: 'Google Drive',
          name: 'Link Sharing (external)',
          description: 'Highest level of sharing allowed outside the organization',
          recommendedValue: 'Off or allowlisted domains',
          recommendation: 'OFF is most secure. If external sharing is needed, restrict it to allowlisted domains / specific OUs.',
          adminConsoleUrl: sharing,
        },
        'drive_and_docs.external_sharing',
        (value) => {
          const mode = readString(value, 'externalSharingMode');
          return {
            status: mode === 'DISALLOWED' || mode === 'ALLOWLISTED_DOMAINS' ? 'pass' : 'warning',
            currentValue: humanEnum(mode),
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'drive-general-access',
          category: 'Google Drive',
          name: 'General Access Default',
          description: 'Default visibility applied to newly created items',
          recommendedValue: 'Private to owner',
          recommendation: 'Default new items to Private to owner to avoid oversharing.',
          adminConsoleUrl: sharing,
        },
        'drive_and_docs.general_access_default',
        (value) => {
          const access = readString(value, 'defaultFileAccess');
          return {
            status: access === 'PRIVATE_TO_OWNER' ? 'pass' : 'warning',
            currentValue: humanEnum(access),
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'drive-shared-drive-creation',
          category: 'Google Drive',
          name: 'Shared Drive Creation',
          description: 'Whether members can create new shared drives',
          recommendedValue: 'Restricted to admins',
          recommendation: 'Set to OFF so only admins can create shared drives.',
          adminConsoleUrl: sharing,
        },
        'drive_and_docs.shared_drive_creation',
        (value) => {
          const allow = readBool(value, 'allowSharedDriveCreation');
          return {
            status: allow === false ? 'pass' : 'warning',
            currentValue: allow === false ? 'Admins only' : 'Users can create',
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'drive-sharing-suggestions',
          category: 'Google Drive',
          name: 'Sharing Suggestions',
          description: 'Access-checker suggestions when sharing files',
          recommendedValue: 'Org-dependent tradeoff',
          recommendation:
            'Improves sharing efficiency but can lead to accidental sharing. Choose per your risk tolerance — no universal right answer.',
          adminConsoleUrl: sharing,
        },
        'drive_and_docs.external_sharing',
        (value) => {
          const suggestions = readString(value, 'accessCheckerSuggestions');
          // Pure convenience-vs-oversharing tradeoff — informational, no target.
          return {
            status: 'info',
            currentValue: humanEnum(suggestions),
          };
        }
      ),
      this.manualCheck(
        {
          id: 'drive-offline-access',
          category: 'Google Drive',
          name: 'Offline Access',
          description: 'Whether Drive files are available offline',
          recommendedValue: 'Disabled (or per-OU)',
          recommendation: 'Disable to reduce data leaks. If required, enable per OU.',
          adminConsoleUrl: features,
        },
        'Not exposed by the Policy API — verify in Admin console.'
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'drive-desktop',
          category: 'Google Drive',
          name: 'Drive for Desktop',
          description: 'Whether Google Drive for desktop is allowed',
          recommendedValue: 'OFF (or specific users)',
          recommendation: 'Set to OFF to reduce data leaks. If needed, enable only for specific users.',
          adminConsoleUrl: features,
        },
        'drive_and_docs.drive_for_desktop',
        (value) => {
          const allow = readBool(value, 'allowDriveForDesktop');
          return {
            status: allow === false ? 'pass' : 'warning',
            currentValue: allow === false ? 'Off' : 'Allowed',
          };
        }
      ),
      this.manualCheck(
        {
          id: 'drive-addons',
          category: 'Google Drive',
          name: 'Docs/Sheets Add-ons',
          description: 'Whether Editor add-ons are allowed',
          recommendedValue: 'OFF (deploy approved add-ons)',
          recommendation: 'Set to OFF to reduce data leaks; deploy only specific approved add-ons where needed.',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/editors',
        },
        'Not exposed by the Policy API — verify in Admin console.'
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'drive-dlp',
          category: 'Google Drive',
          name: 'DLP (Enterprise)',
          description: 'Data Loss Prevention rules for Drive/Gmail',
          recommendedValue: 'Rules configured (Enterprise)',
          recommendation: 'Set DLP to block and/or report based on parameters (e.g. SSN, credit card, employee ID).',
          adminConsoleUrl: 'https://admin.google.com/ac/dp',
        },
        'rule.dlp',
        (_value, lookup) => {
          const count = snapshot.all('rule.dlp').length || (lookup.found ? 1 : 0);
          if (count > 0) {
            return { status: 'pass', currentValue: `${count} data protection rule(s)` };
          }
          return {
            status: 'manual',
            currentValue: 'None configured',
            issues: ['Enterprise-only. Configure DLP rules if licensed, otherwise not applicable.'],
          };
        },
        { evaluateOnMissing: true }
      ),
    ];
  }

  // --- Login challenges -----------------------------------------------------

  private loginChallengeChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    return [
      this.policyCheck(
        snapshot,
        {
          id: 'login-challenges',
          category: 'Login Challenges',
          name: 'Additional Verification',
          description: 'Employee ID login challenge for extra verification',
          recommendedValue: 'Optional (employee ID / recovery email)',
          recommendation:
            'Optional extra verification. Enable the employee ID or recovery-email challenge if it fits your workflow.',
          adminConsoleUrl: 'https://admin.google.com/ac/security/lc',
        },
        'security.login_challenges',
        (value) => {
          const enabled = readBool(value, 'enableEmployeeIdChallenge');
          // Optional hardening — "off" is a valid choice, so surface as info.
          return {
            status: enabled ? 'pass' : 'info',
            currentValue: enabled ? 'Employee ID challenge on' : 'Not configured',
          };
        }
      ),
      this.manualCheck(
        {
          id: 'login-post-sso',
          category: 'Login Challenges',
          name: 'Post-SSO Verification',
          description: 'Extra verification for high-risk apps when SSO is enabled',
          recommendedValue: 'Enabled (with SSO)',
          recommendation: 'Enable Post-SSO verification so high-risk apps require another form of verification.',
          adminConsoleUrl: 'https://admin.google.com/ac/security/sso',
        },
        'Not exposed by the Policy API — verify in Admin console.'
      ),
    ];
  }

  // --- Data Download --------------------------------------------------------

  private dataDownloadChecks(snapshot: PolicySnapshot): HardeningCheck[] {
    return [
      this.policyCheck(
        snapshot,
        {
          id: 'google-takeout',
          category: 'Data Download',
          name: 'Google Takeout',
          description: 'Whether users can export data via Google Takeout',
          recommendedValue: 'OFF (allow per-OU as needed)',
          recommendation: 'Turn off for all users; enable only for OUs/groups that need it (e.g. off-boarding, legal holds).',
          adminConsoleUrl: 'https://admin.google.com/ac/googletakeout/useraccess',
        },
        'takeout.service_status',
        (value) => {
          const state = readString(value, 'serviceState');
          let enabled: boolean | undefined;
          if (state) {
            enabled = state.toUpperCase().includes('ENABLED') || state.toUpperCase() === 'ON';
          } else {
            enabled = readBool(value, 'serviceStatus', 'enabled', 'enableService');
          }
          if (enabled === undefined) {
            return {
              status: 'manual',
              currentValue: JSON.stringify(value).slice(0, 80) || 'Unknown',
              issues: ['Could not parse service status — verify in console.'],
            };
          }
          return {
            status: enabled ? 'warning' : 'pass',
            currentValue: enabled ? 'Enabled for all' : 'Disabled',
          };
        }
      ),
      this.policyCheck(
        snapshot,
        {
          id: 'less-secure-apps',
          category: 'Data Download',
          name: 'Less Secure Apps',
          description: 'Access for apps using less secure sign-in technology',
          recommendedValue: 'Disabled',
          recommendation: 'Turn off for all users except accounts that explicitly require it (allow via OU/group).',
          adminConsoleUrl: 'https://admin.google.com/ac/security/lsa',
        },
        'security.less_secure_apps',
        (value) => {
          const allow = readBool(value, 'allowLessSecureApps');
          return {
            status: allow === false ? 'pass' : allow === true ? 'warning' : 'manual',
            currentValue: allow === false ? 'Disabled' : allow === true ? 'Allowed' : 'Unknown',
          };
        }
      ),
    ];
  }

  // --- Apps Control ---------------------------------------------------------

  private appsControlChecks(): HardeningCheck[] {
    return [
      this.manualCheck(
        {
          id: 'context-aware-access',
          category: 'Apps Control',
          name: 'Context-Aware Access',
          description: 'Access control based on device/context (Enterprise)',
          recommendedValue: 'Configured (Enterprise)',
          recommendation: 'If Enterprise-licensed, gate app access on device parameters (IP, encryption, OU).',
          adminConsoleUrl: 'https://admin.google.com/ac/security/caa',
        },
        'Enterprise-only and context-specific — verify in Admin console.'
      ),
      this.manualCheck(
        {
          id: 'core-apps',
          category: 'Apps Control',
          name: 'Core Apps',
          description: 'Access to core Workspace services per OU/group',
          recommendedValue: 'Off where not needed',
          recommendation: 'Turn off core apps for users/OUs that should not have access (e.g. Calendar, Drive, Meet).',
          adminConsoleUrl: 'https://admin.google.com/ac/appslist/core',
        },
        'Per-OU/service decision — verify in Admin console.'
      ),
      this.manualCheck(
        {
          id: 'additional-apps',
          category: 'Apps Control',
          name: 'Additional Apps',
          description: 'Access to additional Google services per OU/group',
          recommendedValue: 'Off where not needed',
          recommendation: 'Turn off additional apps for users/OUs that should not have access (e.g. Blogger, Ads, Domains).',
          adminConsoleUrl: 'https://admin.google.com/ac/appslist/additional',
        },
        'Per-OU/service decision — verify in Admin console.'
      ),
    ];
  }

  // --- Orchestration --------------------------------------------------------

  async runAllChecks(
    userEmail: string,
    domain: string
  ): Promise<{
    checks: HardeningCheck[];
    statistics: { total: number; pass: number; warning: number; fail: number; manual: number; info: number };
    policyApi: { available: boolean; error?: string };
  }> {
    const checks: HardeningCheck[] = [];

    // Load org policies once (super-admin subject, keyless DWD). Never throws.
    const snapshot = await policyService.loadOrgPolicies(userEmail);

    if (!snapshot.available) {
      checks.push({
        id: 'policy-api-availability',
        category: 'Authentication',
        name: 'Automated Policy Checks',
        description: 'Cloud Identity Policy API access for automated verification',
        status: 'warning',
        source: 'auto',
        currentValue: 'Unavailable',
        recommendedValue: 'Enabled',
        recommendation:
          'Enable cloudidentity.googleapis.com, grant the super admin the cloud-identity.policies.readonly DWD scope, and run the audit as a super admin. Checks below fall back to manual until then.',
        issues: snapshot.error ? [snapshot.error] : undefined,
      });
    }

    // Authentication
    checks.push(await this.check2FAEnforcement(userEmail));
    checks.push(...this.authenticationChecks(snapshot));

    // Email — DNS (SPF/DKIM/DMARC)
    if (domain && domain.includes('.')) {
      try {
        const dnsRecords = await dnsCheckService.checkAllDNS(domain);
        dnsRecords.forEach((record) => {
          checks.push({
            id: `dns-${record.type.toLowerCase()}`,
            category: 'Email',
            name: `${record.type} Record`,
            description: `${record.type} email authentication record`,
            status: record.valid ? 'pass' : record.exists ? 'warning' : 'fail',
            source: 'auto',
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
          source: 'auto',
          recommendation: `Unable to perform DNS checks: ${error.message}`,
        });
      }
    }

    // Email — Gmail policy checks
    checks.push(...this.emailChecks(snapshot));

    // Advanced Phishing & Malware
    checks.push(...this.phishingMalwareChecks(snapshot));

    // Calendar
    checks.push(...this.calendarChecks(snapshot));

    // Google Drive
    checks.push(...this.driveChecks(snapshot));

    // Chrome managed browsers
    try {
      const chromeChecks = await chromePolicyService.getAllPolicyChecks(userEmail);
      chromeChecks.forEach((chromeCheck) => {
        checks.push({
          id: `chrome-${chromeCheck.policyName.toLowerCase()}`,
          category: chromeCheck.category,
          name: chromeCheck.displayName,
          description: chromeCheck.displayName,
          status: chromeCheck.status,
          source: 'auto',
          currentValue: chromeCheck.currentValue,
          recommendedValue: chromeCheck.recommendedValue,
          recommendation: chromeCheck.recommendation,
        });
      });
    } catch (error) {
      checks.push({
        id: 'chrome-policy-api',
        category: 'Chrome Managed Browsers',
        name: 'Chrome Policy API',
        description: 'Chrome Policy API access',
        status: 'warning',
        source: 'auto',
        recommendation:
          'Chrome Policy API may not be enabled. Enable it in the GCP Console to check browser policies.',
      });
    }

    // Chrome — Admin alerts (manual)
    checks.push(
      this.manualCheck(
        {
          id: 'chrome-admin-alerts',
          category: 'Chrome Managed Browsers',
          name: 'Admin Alerts',
          description: 'Alerting for sensitive admin changes',
          recommendedValue: 'Alerts on',
          recommendation: 'Turn on alerts for admin password resets and for new admins added.',
          adminConsoleUrl: 'https://admin.google.com/ac/reporting/rules',
        },
        'Alert-rule config is not exposed by the Policy API — verify in Admin console.'
      )
    );

    // Login challenges
    checks.push(...this.loginChallengeChecks(snapshot));

    // Data Download
    checks.push(...this.dataDownloadChecks(snapshot));

    // Apps Control
    checks.push(...this.appsControlChecks());

    const statistics = {
      total: checks.length,
      pass: checks.filter((c) => c.status === 'pass').length,
      warning: checks.filter((c) => c.status === 'warning').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      manual: checks.filter((c) => c.status === 'manual').length,
      info: checks.filter((c) => c.status === 'info').length,
    };

    return { checks, statistics, policyApi: { available: snapshot.available, error: snapshot.error } };
  }
}

export const hardeningService = new HardeningService();
