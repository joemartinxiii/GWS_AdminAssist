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
import type { PolicyApiMeta, Severity, HardeningStatistics } from './securityAuditStore';

export type { Severity };

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
  /** MSP prioritization for client findings lists. */
  severity: Severity;
  currentValue?: any;
  recommendedValue?: any;
  /** Business risk in plain language (why this matters to the client). */
  rationale: string;
  /** Advisory guidance: what to do, when to bend, how to scope. */
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

/** Static definition of a checklist item, mirroring GWS_HARDENING.md. */
interface CheckMeta {
  id: string;
  category: string;
  name: string;
  description: string;
  severity: Severity;
  /** Short target state, shown in the "Recommended" column. */
  recommendedValue: string;
  /** Why this matters in a client conversation. */
  rationale: string;
  /** Actionable guidance (how / exceptions). */
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

/** Map raw errors to stable operator/client copy — never surface Google JSON. */
export function humanizeApiFailure(error: unknown, context: string): string {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (/429|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return `${context}: temporarily rate-limited by Google. Wait a minute and run the audit again.`;
  }
  if (/403|PERMISSION_DENIED|forbidden/i.test(msg)) {
    return `${context}: permission denied. Run as a super admin with the required API scopes enabled.`;
  }
  if (/401|UNAUTHENTICATED/i.test(msg)) {
    return `${context}: authentication failed. Check domain-wide delegation and service account setup.`;
  }
  if (/404|NOT_FOUND/i.test(msg)) {
    return `${context}: API not found. Enable the API in Google Cloud for this project.`;
  }
  const http = msg.match(/HTTP\s+(\d{3})/i) || msg.match(/\b(\d{3})\b/);
  if (http) {
    return `${context}: request failed (HTTP ${http[1]}). Verify API enablement and admin privileges.`;
  }
  if (msg.includes('{') || msg.length > 160) {
    return `${context}: request failed. Verify API enablement, scopes, and super-admin access.`;
  }
  return msg ? `${context}: ${msg}` : `${context}: request failed.`;
}

export function policyApiMetaFromSnapshot(snapshot: PolicySnapshot): PolicyApiMeta {
  if (snapshot.available) {
    return { available: true };
  }
  const raw = snapshot.error || '';
  let code = 'unavailable';
  if (/HTTP\s*429|429|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw)) code = 'http_429';
  else if (/HTTP\s*403|403/i.test(raw)) code = 'http_403';
  else if (/HTTP\s*401|401/i.test(raw)) code = 'http_401';
  else if (/HTTP\s*404|404/i.test(raw)) code = 'http_404';

  return {
    available: false,
    code,
    message: humanizeApiFailure(raw || 'unavailable', 'Cloud Identity Policy API'),
  };
}

export class HardeningService extends WorkspaceService {
  // --- Generic builders -----------------------------------------------------

  private baseFrom(meta: CheckMeta): Omit<HardeningCheck, 'status' | 'source'> {
    return {
      id: meta.id,
      category: meta.category,
      name: meta.name,
      description: meta.description,
      severity: meta.severity,
      recommendedValue: meta.recommendedValue,
      rationale: meta.rationale,
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
        issues: [
          'Automated read unavailable — verify this setting in the Admin console until Policy API access is restored.',
        ],
      };
    }

    const lookup = snapshot.get(settingType);
    if (!lookup.found && !options.evaluateOnMissing) {
      return {
        ...base,
        status: 'manual',
        source: 'manual',
        currentValue: 'Not explicitly configured',
        issues: [
          'No org policy returned — a Google default likely applies. Confirm the intended setting in the Admin console.',
        ],
      };
    }

    const result = evaluate(lookup.value ?? {}, lookup);
    const issues = result.issues ? [...result.issues] : [];
    if (lookup.scopeCount > 1) {
      issues.push(
        `Overridden across ${lookup.scopeCount} org units — showing one scope; review OU differences with the client.`
      );
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
      severity: 'critical',
      recommendedValue: 'Enforced for all users',
      rationale:
        'Account takeover is the most common path into a Workspace tenant. Without enforced 2-Step Verification, a phished password is often enough to read mail, reset other accounts, and move data.',
      recommendation:
        'Enforce 2-Step Verification org-wide (or by OU with a short grace period for onboarding). Prioritize admins and externally facing roles first. This check samples Directory enforcement flags — confirm the org 2SV schedule in Admin console if numbers look off.',
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
        currentValue: `${Math.round(rate * 100)}% of users enforced (${usersWith2FA}/${totalUsers} sample)`,
      };
    } catch (error: unknown) {
      return {
        ...this.baseFrom(meta),
        status: 'warning',
        source: 'auto',
        currentValue: 'Unable to measure',
        issues: [humanizeApiFailure(error, 'Directory user list')],
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
          severity: 'high',
          recommendedValue: 'Strong, enforced at login',
          rationale:
            'Weak or reused passwords remain a major breach vector, especially for accounts that are not yet on hardware keys or strong 2SV methods.',
          recommendation:
            'Require strong passwords (minimum length 12+ is a practical baseline) and enforce requirements at next sign-in. Pair with 2SV rather than relying on password strength alone.',
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
          severity: 'medium',
          recommendedValue: 'Enrollment enabled',
          rationale:
            'Advanced Protection adds phishing-resistant controls for high-risk users (executives, finance, admins). Allowing self-enrollment makes that path available without forcing it on everyone.',
          recommendation:
            'Leave self-enrollment on. For VIP / admin cohorts, consider requiring Advanced Protection or security keys as a separate engagement item.',
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
          severity: 'low',
          recommendedValue: 'Do not allow',
          rationale:
            'Read receipts can leak when a message was opened and are rarely required for SMB operations. They add little business value and some privacy friction.',
          recommendation:
            'Set to Do not allow unless the client has a documented workflow that depends on receipts. Confirm in Admin console (not available via Policy API).',
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
          severity: 'medium',
          recommendedValue: 'OFF unless there is a business need',
          rationale:
            'Delegation grants another person full mailbox access. That is appropriate for executive assistants or shared inboxes, but org-wide enablement expands the blast radius of compromised accounts.',
          recommendation:
            'Prefer OFF by default. Where needed (EA support, shared roles), enable only for specific OUs/groups and document owners. This is a business choice — not an automatic fail when on.',
          adminConsoleUrl: gmailUserSettings,
        },
        'gmail.mail_delegation',
        (value) => {
          const enabled = readBool(value, 'enableMailDelegation');
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
          severity: 'low',
          recommendedValue: 'ON',
          rationale:
            'Confidential mode gives users expiring links and copy/download restrictions for sensitive messages — a lightweight control when full DLP is unavailable.',
          recommendation:
            'Keep ON for most tenants. Educate users that it is not a substitute for classification/DLP on regulated data.',
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
          severity: 'medium',
          recommendedValue: 'Allowlist trusted domains when appropriate',
          rationale:
            'Restricting who can deliver mail into the tenant reduces spam and spoofed-partner noise. Over-restriction can break legitimate suppliers — apply only when the business model fits.',
          recommendation:
            'For closed partner ecosystems, add restrict-delivery rules for trusted domains. For typical SMBs that receive mail from the public internet, leave open and rely on SPF/DKIM/DMARC + phishing protections instead.',
          adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/compliance',
        },
        'gmail.restrict_delivery',
        (value) => {
          const rules = value['restrictDeliveryRules'];
          const count = Array.isArray(rules) ? rules.length : 0;
          return {
            status: count > 0 ? 'pass' : 'info',
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
          severity: 'medium',
          recommendedValue: 'ON',
          rationale:
            'A simple banner before sending outside the organization reduces accidental disclosure of internal threads and attachments — a frequent SMB incident pattern.',
          recommendation:
            'Turn the external-recipient warning ON. Low user friction for meaningful risk reduction. Confirm in Admin console (not available via Policy API).',
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
          severity: 'high',
          recommendedValue: 'ON',
          rationale:
            'Pre-delivery scanning improves detection of malicious content before it lands in the inbox — one of the highest-value free mail defenses Google offers.',
          recommendation:
            'Keep enhanced pre-delivery message scanning ON for all users. There is rarely a valid reason to disable it for an SMB.',
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
          severity: 'high',
          recommendedValue: 'No broad bypasses',
          rationale:
            'Bypassing spam filters for “trusted” senders is a common attacker pivot: once an allowlisted address is compromised or spoofed, malicious mail skips controls.',
          recommendation:
            'Avoid org-wide warning-banner hides and broad bypass lists. Prefer narrow exceptions with an owner and review date. Never hide warnings for all senders.',
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
          severity: 'critical',
          recommendedValue: 'OFF',
          rationale:
            'Automatic forwarding is a classic post-compromise exfiltration path: an attacker (or malware) silently copies all inbound mail to an external address.',
          recommendation:
            'Set auto-forwarding to OFF for the organization. If a business process truly requires it, allow only via a controlled group/OU and document the owner — then re-check periodically.',
          adminConsoleUrl: gmailEndUser,
        },
        'gmail.auto_forwarding',
        (value) => {
          const enabled = readBool(value, 'enableAutoForwarding');
          return {
            status: enabled ? 'fail' : 'pass',
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
          severity: 'critical',
          recommendedValue: 'All protections on',
          rationale:
            'Malicious attachments remain a primary malware delivery method. Google’s attachment safety controls block encrypted, scripted, and anomalous file types from untrusted senders.',
          recommendation:
            'Enable all attachment protections (encrypted attachments, scripts, anomalous types). Exceptions for known partners should be rare and time-bound.',
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
          severity: 'critical',
          recommendedValue: 'All protections on',
          rationale:
            'Credential-harvesting and malware links often hide behind shorteners or untrusted hosts. Scanning links/images and warning on untrusted URLs reduces successful phishing.',
          recommendation:
            'Enable shortener scanning, external image scanning, and aggressive warnings on untrusted links for all users.',
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
          severity: 'critical',
          recommendedValue: 'All protections on',
          rationale:
            'Domain and executive-name spoofing drive BEC (business email compromise) losses. Detecting unauthenticated and spoofed senders is essential for finance and leadership protection.',
          recommendation:
            'Enable all spoofing and authentication detections (domain, employee name, unauthenticated senders, groups). Pair with SPF/DKIM/DMARC at the DNS layer.',
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
          description: 'External sharing level for users’ primary calendars',
          severity: 'medium',
          recommendedValue: 'Org-dependent (free/busy is most private)',
          rationale:
            'Broad external calendar detail can reveal travel, meetings with counsel, M&A activity, or customer names. Free/busy is usually enough for external scheduling.',
          recommendation:
            'Discuss with the client: free/busy-only is the most private default. Broader sharing may be intentional for sales or support teams — document the choice rather than forcing a fail.',
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
          severity: 'medium',
          recommendedValue: 'Org-dependent (free/busy is most private)',
          rationale:
            'Secondary calendars (rooms, projects, team schedules) can still leak operational detail outside the organization.',
          recommendation:
            'Align with primary calendar policy unless a specific secondary calendar type needs more openness. Prefer free/busy for external guests.',
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
          severity: 'low',
          recommendedValue: 'ON',
          rationale:
            'A warning when adding external guests reduces accidental invites that expose meeting titles and attachments.',
          recommendation:
            'Keep the external-guest warning ON (Google’s default). Minimal friction for a useful safeguard.',
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
          severity: 'critical',
          recommendedValue: 'Off or allowlisted domains',
          rationale:
            'Unrestricted external sharing is the leading cause of Drive data exposure. “Anyone with the link” and open external sharing make accidental (or malicious) leakage trivial.',
          recommendation:
            'Prefer OFF for high-sensitivity orgs. If partners need access, use allowlisted domains and specific OUs rather than open external sharing. Pair with the external-sharing scan in this app for live file risk.',
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
          severity: 'high',
          recommendedValue: 'Private to owner',
          rationale:
            'Defaulting new files to org-wide link access causes silent oversharing — people create files assuming privacy while the link is already broadly usable.',
          recommendation:
            'Set the default for new items to Private to owner. Users can still share intentionally; they should not share by accident.',
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
          severity: 'medium',
          recommendedValue: 'Restricted to admins',
          rationale:
            'Uncontrolled shared-drive sprawl creates orphaned data owners, inconsistent permissions, and harder offboarding. Admin-gated creation keeps structure intentional.',
          recommendation:
            'For most SMBs, restrict creation to admins (or a small IT/ops group). Self-service can be right for larger orgs with a naming/ownership standard — document that exception.',
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
          severity: 'low',
          recommendedValue: 'Org-dependent tradeoff',
          rationale:
            'Access suggestions speed collaboration but can nudge users toward broader sharing than intended. Risk tolerance varies by culture and data sensitivity.',
          recommendation:
            'Discuss with the client: keep suggestions if productivity is the priority; tighten if oversharing has been a problem. No universal right answer — record the decision.',
          adminConsoleUrl: sharing,
        },
        'drive_and_docs.external_sharing',
        (value) => {
          const suggestions = readString(value, 'accessCheckerSuggestions');
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
          severity: 'medium',
          recommendedValue: 'Disabled (or per-OU)',
          rationale:
            'Offline copies on laptops increase data-at-rest exposure if a device is lost or stolen without strong disk encryption and MDM.',
          recommendation:
            'Disable offline access org-wide when possible. If field staff need it, enable per OU and ensure device encryption/MDM. Confirm in Admin console (not via Policy API).',
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
          severity: 'medium',
          recommendedValue: 'OFF (or specific users)',
          rationale:
            'Drive for desktop syncs cloud files to endpoints, which improves UX but expands the local data footprint and complicates offboarding/lost-device scenarios.',
          recommendation:
            'Default OFF for highly sensitive environments. Where hybrid work requires it, allow for approved OUs only and require encrypted, managed devices.',
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
          severity: 'medium',
          recommendedValue: 'OFF (deploy approved add-ons)',
          rationale:
            'Marketplace add-ons receive document access and can become a supply-chain or data-exfiltration path if users install freely.',
          recommendation:
            'Block open add-on installs; deploy only reviewed add-ons. Confirm in Admin console (not via Policy API).',
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
          severity: 'high',
          recommendedValue: 'Rules configured when licensed',
          rationale:
            'DLP detects and can block sensitive data (SSN, cards, health identifiers) leaving via Drive or Gmail — critical for regulated or high-value IP clients.',
          recommendation:
            'If the SKU includes data protection, configure block/report rules for high-risk detectors. If not licensed, waive with reason “SKU — not applicable” rather than treating as a security failure.',
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
            issues: [
              'Enterprise / add-on feature. Configure DLP if licensed; otherwise document as not applicable.',
            ],
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
          severity: 'low',
          recommendedValue: 'Optional (employee ID / recovery email)',
          rationale:
            'Extra login challenges slow account recovery abuse. Value depends on whether the org maintains accurate employee IDs and recovery emails.',
          recommendation:
            'Enable employee-ID or recovery-email challenges if HR data is accurate. Optional for many SMBs — record the decision; off is valid when 2SV is strong.',
          adminConsoleUrl: 'https://admin.google.com/ac/security/lc',
        },
        'security.login_challenges',
        (value) => {
          const enabled = readBool(value, 'enableEmployeeIdChallenge');
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
          severity: 'high',
          recommendedValue: 'Enabled when SSO is in use',
          rationale:
            'SSO consolidates access: if the IdP session is weak or stolen, high-risk Google apps need an additional check. Post-SSO verification closes that gap.',
          recommendation:
            'If the client uses SSO, enable post-SSO verification for high-risk apps. If no SSO, mark not applicable. Confirm in Admin console (not via Policy API).',
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
          severity: 'high',
          recommendedValue: 'OFF (allow per-OU as needed)',
          rationale:
            'Takeout lets users bulk-export mail, Drive, and more. Useful for offboarding/legal, but dangerous if every user can self-serve large extracts — especially after compromise or insider risk.',
          recommendation:
            'Disable Takeout for general users. Enable only for approved OUs/groups (HR/legal/offboarding) with a request process.',
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
              currentValue: 'Unknown',
              issues: ['Could not parse service status — verify in Admin console.'],
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
          severity: 'critical',
          recommendedValue: 'Disabled',
          rationale:
            'Less secure apps use password-based access that bypasses modern OAuth and often 2SV. They are obsolete and high-risk for account takeover.',
          recommendation:
            'Disable for all users. Migrate any remaining integrations to OAuth or service accounts. Temporary exceptions should be time-boxed and tracked as waivers.',
          adminConsoleUrl: 'https://admin.google.com/ac/security/lsa',
        },
        'security.less_secure_apps',
        (value) => {
          const allow = readBool(value, 'allowLessSecureApps');
          return {
            status: allow === false ? 'pass' : allow === true ? 'fail' : 'manual',
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
          severity: 'high',
          recommendedValue: 'Configured when licensed',
          rationale:
            'Context-Aware Access gates apps by device posture, IP, and identity context — stopping access from unmanaged or high-risk environments.',
          recommendation:
            'If Enterprise-licensed, define levels for sensitive apps (Admin console, finance systems). If not licensed, waive as “SKU — not applicable.”',
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
          severity: 'medium',
          recommendedValue: 'Off where not needed',
          rationale:
            'Every enabled app expands the attack and data surface. Contractors, kiosks, and limited-role staff often need only a subset of Workspace.',
          recommendation:
            'Turn off core apps (Drive, Gmail, Meet, etc.) for OUs that should not have them. Document the service catalog with the client.',
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
          severity: 'medium',
          recommendedValue: 'Off where not needed',
          rationale:
            'Consumer-oriented Google services (Blogger, Ads, etc.) are rarely required for business tenants and create shadow IT and data-storage surprises.',
          recommendation:
            'Disable additional Google services org-wide unless a specific OU has an approved need. Review annually with the client.',
          adminConsoleUrl: 'https://admin.google.com/ac/appslist/additional',
        },
        'Per-OU/service decision — verify in Admin console.'
      ),
    ];
  }

  private dnsCheckToHardening(record: {
    type: string;
    exists: boolean;
    valid: boolean;
    recommendation?: string;
    issues?: string[];
    record?: string;
  }): HardeningCheck {
    const severity: Severity =
      record.type === 'DMARC' || record.type === 'SPF' ? 'critical' : 'high';
    const rationaleByType: Record<string, string> = {
      SPF: 'SPF tells receiving servers which hosts may send mail for your domain. Without it (or with a soft fail), spoofed mail from your domain is far easier.',
      DKIM:
        'DKIM cryptographically signs outbound mail so receivers can detect tampering and trust your domain’s messages.',
      DMARC:
        'DMARC ties SPF/DKIM together and tells receivers what to do with failures. Without enforcement, spoofed CEO/finance mail remains easy.',
    };
    const recByType: Record<string, string> = {
      SPF: 'Publish a single SPF record covering all legitimate senders and end with -all (hard fail). Avoid +all or overly broad includes.',
      DKIM:
        'Enable Google DKIM in Admin console and publish the TXT record. Prefer 2048-bit keys when the DNS provider allows it.',
      DMARC:
        'Start with p=none + reporting if needed, then move to p=quarantine or p=reject once legitimate mail paths are clean. BEC-prone orgs should not stay on p=none long-term.',
    };

    let status: HardeningCheck['status'];
    if (!record.exists) status = 'fail';
    else if (!record.valid) status = 'warning';
    else status = 'pass';

    // Soft issues from DNS lookup failures shouldn't look like raw stack traces
    const issues = (record.issues || []).map((i) =>
      /DNS lookup failed/i.test(i)
        ? `DNS lookup could not complete for ${record.type}. Confirm public DNS resolution from this environment.`
        : i
    );

    return {
      id: `dns-${record.type.toLowerCase()}`,
      category: 'Email',
      name: `${record.type} Record`,
      description: `${record.type} email authentication record`,
      status,
      source: 'auto',
      severity,
      currentValue: record.exists
        ? record.valid
          ? 'Configured'
          : 'Configured with issues'
        : 'Not found',
      recommendedValue: 'Configured and enforcing',
      rationale: rationaleByType[record.type] || `${record.type} email authentication`,
      recommendation: record.recommendation || recByType[record.type] || '',
      issues: issues.length ? issues : undefined,
    };
  }

  // --- Orchestration --------------------------------------------------------

  async runAllChecks(
    userEmail: string,
    domain: string
  ): Promise<{
    checks: HardeningCheck[];
    statistics: HardeningStatistics;
    policyApi: PolicyApiMeta;
  }> {
    const checks: HardeningCheck[] = [];

    // Load org policies once (super-admin subject, keyless DWD). Never throws.
    const snapshot = await policyService.loadOrgPolicies(userEmail);
    const policyApi = policyApiMetaFromSnapshot(snapshot);
    // Note: we intentionally do NOT inject a synthetic "Policy API 403" checklist
    // row. Unavailability is returned as policyApi meta for a UI banner; individual
    // policy-backed checks degrade to manual with stable copy.

    // Authentication
    checks.push(await this.check2FAEnforcement(userEmail));
    checks.push(...this.authenticationChecks(snapshot));

    // Email — DNS (SPF/DKIM/DMARC)
    if (domain && domain.includes('.')) {
      try {
        const dnsRecords = await dnsCheckService.checkAllDNS(domain);
        dnsRecords.forEach((record) => {
          checks.push(this.dnsCheckToHardening(record));
        });
      } catch (error: unknown) {
        checks.push({
          id: 'dns-check-error',
          category: 'Email',
          name: 'DNS Checks',
          description: 'DNS record validation for SPF, DKIM, and DMARC',
          status: 'warning',
          source: 'auto',
          severity: 'high',
          currentValue: 'Unable to check',
          recommendedValue: 'Configured and enforcing',
          rationale:
            'Without SPF, DKIM, and DMARC, attackers can more easily spoof the client’s domain in phishing and BEC campaigns.',
          recommendation:
            'Re-run the audit when DNS is reachable, or verify SPF/DKIM/DMARC records manually in the client’s DNS host.',
          issues: [humanizeApiFailure(error, 'DNS checks')],
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
        const isUpdates = chromeCheck.policyName === 'BrowserUpdateEnabled';
        checks.push({
          id: `chrome-${chromeCheck.policyName.toLowerCase()}`,
          category: chromeCheck.category,
          name: chromeCheck.displayName,
          description: chromeCheck.displayName,
          status: chromeCheck.status,
          source: 'auto',
          severity: isUpdates ? 'high' : 'medium',
          currentValue: chromeCheck.currentValue,
          recommendedValue: chromeCheck.recommendedValue,
          rationale: isUpdates
            ? 'Outdated browsers are a primary malware entry point. Enforcing Chrome updates keeps the managed fleet patched.'
            : 'Forced extensions let IT ship password managers, blockers, or security tools consistently instead of relying on user choice.',
          recommendation: isUpdates
            ? 'Ensure browser updates are enabled for managed Chrome. Investigate unknown status if Chrome Policy API access is missing.'
            : 'Deploy a small allowlist of security-relevant extensions (e.g. password manager). Unknown status usually means Chrome Policy API is not enabled or authorized.',
        });
      });
    } catch (error: unknown) {
      checks.push({
        id: 'chrome-policy-api',
        category: 'Chrome Managed Browsers',
        name: 'Chrome Policy API',
        description: 'Ability to read managed Chrome browser policies',
        status: 'warning',
        source: 'auto',
        severity: 'medium',
        currentValue: 'Unavailable',
        recommendedValue: 'API enabled for audits',
        rationale:
          'Without Chrome Policy API access we cannot confirm browser update and extension posture automatically.',
        recommendation:
          'Enable chromepolicy.googleapis.com and grant the chrome.management.policy DWD scope, then re-run the audit.',
        issues: [humanizeApiFailure(error, 'Chrome Policy API')],
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
          severity: 'high',
          recommendedValue: 'Alerts on',
          rationale:
            'Admin password resets and new super admins are high-impact events. Without alerts, compromise of an admin account can go unnoticed.',
          recommendation:
            'Turn on alert rules for admin password resets, new admin assignments, and other sensitive actions. Route to a monitored MSP/client mailbox.',
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

    const statistics: HardeningStatistics = {
      total: checks.length,
      pass: checks.filter((c) => c.status === 'pass').length,
      warning: checks.filter((c) => c.status === 'warning').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      manual: checks.filter((c) => c.status === 'manual').length,
      info: checks.filter((c) => c.status === 'info').length,
    };

    return { checks, statistics, policyApi };
  }
}

export const hardeningService = new HardeningService();
