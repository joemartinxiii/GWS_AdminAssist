import {
  classifyPermissions,
  resolveAllowedDomains,
  hasAnyExposure,
  primaryExposure,
  PermissionLite,
  Classification,
} from '../src/utils/externalSharing';

/**
 * Mirrors the mode -> target-permission selection inside
 * DriveService.removeExternalShares so remediation scope is covered without
 * needing live Drive/auth. `targets` is the exact set of permissions the
 * service attempts to delete for a given remediation mode.
 */
type RemediationMode = 'all' | 'public' | 'external';
function remediationTargets(c: Classification, mode: RemediationMode): PermissionLite[] {
  const targets: PermissionLite[] = [];
  if (mode === 'all' || mode === 'public') targets.push(...c.publicPermissions);
  if (mode === 'all' || mode === 'external') targets.push(...c.externalPermissions);
  return targets.filter((p) => String(p.role || '').toLowerCase() !== 'owner');
}

describe('classifyPermissions', () => {
  const allowed = ['company.com', 'eu.company.com'];

  test('treats "anyone" permissions as public, not external', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'anyone', role: 'reader' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.isPublic).toBe(true);
    expect(c.publicPermissions).toHaveLength(1);
    expect(c.externalPermissions).toHaveLength(0);
    expect(c.externalDomains).toEqual([]);
    expect(primaryExposure(c)).toBe('public');
  });

  test('flags external domain-type permissions', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'domain', role: 'reader', domain: 'partner.org' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.externalDomains).toEqual(['partner.org']);
    expect(c.externalPermissions).toHaveLength(1);
    expect(c.isPublic).toBe(false);
    expect(primaryExposure(c)).toBe('external');
  });

  test('keeps internal users/domains out of the external buckets', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'user', role: 'writer', emailAddress: 'alice@company.com' },
      { id: 'p2', type: 'domain', role: 'reader', domain: 'eu.company.com' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.externalDomains).toEqual([]);
    expect(c.externalEmails).toEqual([]);
    expect(c.externalPermissions).toHaveLength(0);
    expect(hasAnyExposure(c)).toBe(false);
    expect(primaryExposure(c)).toBeNull();
  });

  test('separates external users, groups, and domains', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'user', role: 'writer', emailAddress: 'bob@outside.com' },
      { id: 'p2', type: 'group', role: 'reader', emailAddress: 'team@vendor.io' },
      { id: 'p3', type: 'domain', role: 'reader', domain: 'partner.org' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.externalEmails).toEqual(['bob@outside.com']);
    expect(c.externalGroups).toEqual(['team@vendor.io']);
    expect(c.externalDomains.sort()).toEqual(['outside.com', 'partner.org', 'vendor.io']);
    expect(c.externalPermissions).toHaveLength(3);
  });

  test('never treats owners as external', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'user', role: 'owner', emailAddress: 'ceo@external-owner.com' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.externalPermissions).toHaveLength(0);
    expect(c.externalEmails).toEqual([]);
  });

  test('is case-insensitive for domains and allowlist', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'user', role: 'reader', emailAddress: 'Carol@Company.com' },
      { id: 'p2', type: 'domain', role: 'reader', domain: 'Partner.ORG' },
    ];
    const c = classifyPermissions(perms, ['COMPANY.com']);
    expect(c.externalEmails).toEqual([]); // internal despite mixed case
    expect(c.externalDomains).toEqual(['partner.org']);
  });

  test('dedupes external domains derived from multiple principals', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'user', role: 'reader', emailAddress: 'a@vendor.io' },
      { id: 'p2', type: 'user', role: 'reader', emailAddress: 'b@vendor.io' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.externalDomains).toEqual(['vendor.io']);
    expect(c.externalEmails).toEqual(['a@vendor.io', 'b@vendor.io']);
  });

  test('handles a file that is both public and external', () => {
    const perms: PermissionLite[] = [
      { id: 'p1', type: 'anyone', role: 'reader' },
      { id: 'p2', type: 'user', role: 'writer', emailAddress: 'x@outside.com' },
    ];
    const c = classifyPermissions(perms, allowed);
    expect(c.isPublic).toBe(true);
    expect(c.externalPermissions).toHaveLength(1);
    expect(hasAnyExposure(c)).toBe(true);
    expect(primaryExposure(c)).toBe('public'); // public preferred (higher severity)
  });

  test('empty / undefined permissions classify as no exposure', () => {
    expect(hasAnyExposure(classifyPermissions([], allowed))).toBe(false);
    expect(hasAnyExposure(classifyPermissions(undefined, allowed))).toBe(false);
  });
});

describe('resolveAllowedDomains', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('uses explicit list when provided (trimmed + lowercased)', () => {
    expect(resolveAllowedDomains([' Company.com ', 'EU.company.com'])).toEqual([
      'company.com',
      'eu.company.com',
    ]);
  });

  test('falls back to WORKSPACE_DOMAIN + GWS_ALLOWED_DOMAINS union', () => {
    process.env.WORKSPACE_DOMAIN = 'company.com';
    process.env.GWS_ALLOWED_DOMAINS = 'eu.company.com, sub.company.com';
    expect(resolveAllowedDomains().sort()).toEqual([
      'company.com',
      'eu.company.com',
      'sub.company.com',
    ]);
  });

  test('returns [] when nothing configured (fail-closed: everything external)', () => {
    delete process.env.WORKSPACE_DOMAIN;
    delete process.env.GWS_ALLOWED_DOMAINS;
    expect(resolveAllowedDomains()).toEqual([]);
    const c = classifyPermissions(
      [{ id: 'p1', type: 'user', role: 'reader', emailAddress: 'anyone@anywhere.com' }],
    );
    expect(c.externalPermissions).toHaveLength(1);
  });
});

describe('remediation scope (mode -> target permissions)', () => {
  const allowed = ['company.com'];
  const perms: PermissionLite[] = [
    { id: 'owner', type: 'user', role: 'owner', emailAddress: 'me@company.com' },
    { id: 'internal', type: 'user', role: 'writer', emailAddress: 'teammate@company.com' },
    { id: 'anyone', type: 'anyone', role: 'reader' },
    { id: 'extUser', type: 'user', role: 'writer', emailAddress: 'partner@outside.com' },
    { id: 'extGroup', type: 'group', role: 'reader', emailAddress: 'team@vendor.io' },
  ];
  const c = classifyPermissions(perms, allowed);

  test('public mode removes only the anyone permission', () => {
    const ids = remediationTargets(c, 'public').map((p) => p.id);
    expect(ids).toEqual(['anyone']);
  });

  test('external mode removes external user + group but not public/internal/owner', () => {
    const ids = remediationTargets(c, 'external').map((p) => p.id).sort();
    expect(ids).toEqual(['extGroup', 'extUser']);
  });

  test('all mode removes public + all external, skipping owner and internal', () => {
    const ids = remediationTargets(c, 'all').map((p) => p.id).sort();
    expect(ids).toEqual(['anyone', 'extGroup', 'extUser']);
    expect(ids).not.toContain('owner');
    expect(ids).not.toContain('internal');
  });
});
