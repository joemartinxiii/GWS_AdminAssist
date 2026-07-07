import { normalizeApiError } from '../src/utils/apiError';
import { getAllowedDomains, isEmailInAllowedDomain } from '../src/utils/validation';
import { PermissionsService } from '../src/services/permissions.service';

describe('normalizeApiError', () => {
  it('resolves status from googleapis error.code', () => {
    const n = normalizeApiError({ code: 403, message: 'Forbidden' });
    expect(n.status).toBe(403);
    expect(n.hint).toBeDefined();
  });

  it('resolves status and message from a gaxios-style response', () => {
    const n = normalizeApiError({
      response: { status: 404, data: { error: { message: 'Not found', status: 'NOT_FOUND' } } },
    });
    expect(n.status).toBe(404);
    expect(n.message).toBe('Not found');
    expect(n.code).toBe('NOT_FOUND');
  });

  it('extracts nested Google errors[] message', () => {
    const n = normalizeApiError({ errors: [{ message: 'Insufficient permission', reason: 'insufficientPermissions' }], code: 403 });
    expect(n.status).toBe(403);
    expect(n.message).toBe('Insufficient permission');
  });

  it('defaults to 500 with a generic message when nothing is present', () => {
    const n = normalizeApiError(new Error('boom'));
    expect(n.status).toBe(500);
    expect(n.message).toBe('boom');
  });

  it('adds a rate-limit hint for 429', () => {
    const n = normalizeApiError({ code: 429 });
    expect(n.status).toBe(429);
    expect(n.hint).toMatch(/rate limit/i);
  });
});

describe('allowed-domain login gate helpers', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env.WORKSPACE_DOMAIN = original.WORKSPACE_DOMAIN;
    process.env.GWS_ALLOWED_DOMAINS = original.GWS_ALLOWED_DOMAINS;
  });

  it('includes WORKSPACE_DOMAIN and GWS_ALLOWED_DOMAINS (deduped, lowercased)', () => {
    process.env.WORKSPACE_DOMAIN = 'Company.com';
    process.env.GWS_ALLOWED_DOMAINS = 'company.com, Subsidiary.com';
    expect(getAllowedDomains().sort()).toEqual(['company.com', 'subsidiary.com']);
  });

  it('accepts in-domain emails and rejects out-of-domain', () => {
    process.env.WORKSPACE_DOMAIN = 'company.com';
    process.env.GWS_ALLOWED_DOMAINS = '';
    expect(isEmailInAllowedDomain('admin@company.com')).toBe(true);
    expect(isEmailInAllowedDomain('attacker@evil.com')).toBe(false);
  });

  it('fails closed when no domains are configured', () => {
    process.env.WORKSPACE_DOMAIN = '';
    process.env.GWS_ALLOWED_DOMAINS = '';
    expect(isEmailInAllowedDomain('anyone@anywhere.com')).toBe(false);
  });
});

describe('PermissionsService.getPermissions role mapping', () => {
  const svc = new PermissionsService();

  it('grants full management permissions to super admins', () => {
    const perms = svc.getPermissions({ isSuperAdmin: true, isDelegatedAdmin: false });
    expect(perms).toContain('users.delete');
    expect(perms).toContain('gmail.delegation.manage');
    expect(perms).toContain('audit.export');
  });

  it('grants delegated admins view-only (no mutations/exports)', () => {
    const perms = svc.getPermissions({ isSuperAdmin: false, isDelegatedAdmin: true });
    expect(perms).toContain('users.view');
    expect(perms).toContain('audit.view');
    expect(perms).not.toContain('users.delete');
    expect(perms).not.toContain('gmail.delegation.manage');
    expect(perms).not.toContain('audit.export');
  });

  it('grants nothing to non-admins', () => {
    expect(svc.getPermissions({ isSuperAdmin: false, isDelegatedAdmin: false })).toEqual([]);
  });
});
