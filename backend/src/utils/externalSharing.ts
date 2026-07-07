import { getAllowedDomains } from './validation';

/**
 * Minimal shape of a Drive permission used for external-sharing classification.
 * Matches the fields returned by the Drive API `permissions` collection that we
 * care about; other fields are ignored.
 */
export interface PermissionLite {
  id?: string;
  type?: string; // 'user' | 'group' | 'domain' | 'anyone'
  role?: string; // 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader'
  emailAddress?: string;
  domain?: string;
  displayName?: string;
}

/**
 * Exposure category for a shared file:
 * - `public`   → has an "anyone / anyone with the link" permission.
 * - `external` → shared to a specific domain, user, or group outside the
 *   organization's allowed domains.
 * A file can be both; `primaryExposure` prefers `public` because it is the
 * higher-severity, one-click-remediable case.
 */
export type Exposure = 'public' | 'external';

export interface Classification {
  /** True when an `anyone`/`anyoneWithLink` permission is present. */
  isPublic: boolean;
  /** The `anyone` permissions themselves (for targeted removal). */
  publicPermissions: PermissionLite[];
  /** External domains (domain-type perms + domains derived from external emails), lowercased + deduped. */
  externalDomains: string[];
  /** External individual user emails. */
  externalEmails: string[];
  /** External group emails. */
  externalGroups: string[];
  /** All non-owner permissions that point outside the allowed domains (user/group/domain, excludes `anyone`). */
  externalPermissions: PermissionLite[];
}

/**
 * Resolve the set of allowed (internal) domains, lowercased. Falls back to
 * getAllowedDomains() (WORKSPACE_DOMAIN + GWS_ALLOWED_DOMAINS) when not supplied.
 * Note: if no domains are configured this returns [], and every domained/email
 * principal is then treated as external (fail-closed / over-report for an audit).
 */
export function resolveAllowedDomains(allowedDomains?: string[]): string[] {
  const source = allowedDomains && allowedDomains.length ? allowedDomains : getAllowedDomains();
  return source.map((d) => d.trim().toLowerCase()).filter(Boolean);
}

function domainOfEmail(email?: string): string | undefined {
  return String(email || '').split('@')[1]?.toLowerCase() || undefined;
}

/**
 * Classify a file's permissions into public vs external exposure. This is the
 * single source of truth for "what counts as externally shared", reused by the
 * scan worker, the audit routes, and remediation so they never disagree.
 */
export function classifyPermissions(
  permissions: PermissionLite[] = [],
  allowedDomains?: string[]
): Classification {
  const allowed = resolveAllowedDomains(allowedDomains);

  const publicPermissions: PermissionLite[] = [];
  const externalDomainSet = new Set<string>();
  const externalEmails: string[] = [];
  const externalGroups: string[] = [];
  const externalPermissions: PermissionLite[] = [];

  for (const perm of permissions) {
    const type = String(perm.type || '').toLowerCase();

    if (type === 'anyone') {
      publicPermissions.push(perm);
      continue;
    }

    // Owner is always the file owner (internal); never treat as external.
    if (String(perm.role || '').toLowerCase() === 'owner') continue;

    if (type === 'domain' && perm.domain) {
      const d = perm.domain.toLowerCase();
      if (!allowed.includes(d)) {
        externalDomainSet.add(d);
        externalPermissions.push(perm);
      }
    } else if ((type === 'user' || type === 'group') && perm.emailAddress) {
      const d = domainOfEmail(perm.emailAddress);
      if (d && !allowed.includes(d)) {
        if (type === 'group') {
          externalGroups.push(perm.emailAddress);
        } else {
          externalEmails.push(perm.emailAddress);
        }
        externalDomainSet.add(d);
        externalPermissions.push(perm);
      }
    }
  }

  return {
    isPublic: publicPermissions.length > 0,
    publicPermissions,
    externalDomains: Array.from(externalDomainSet),
    externalEmails,
    externalGroups,
    externalPermissions,
  };
}

/** True if a file has any external OR public exposure. */
export function hasAnyExposure(c: Classification): boolean {
  return c.isPublic || c.externalPermissions.length > 0;
}

/** Prefer `public` (higher severity) when a file is both public and external. */
export function primaryExposure(c: Classification): Exposure | null {
  if (c.isPublic) return 'public';
  if (c.externalPermissions.length > 0) return 'external';
  return null;
}
