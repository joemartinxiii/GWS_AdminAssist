import { getProtectedUserEmails, isProtectedUserEmail } from '../src/utils/protectedUsers';

describe('protected users', () => {
  const original = process.env.GWS_PROTECTED_USERS;

  afterEach(() => {
    if (original === undefined) delete process.env.GWS_PROTECTED_USERS;
    else process.env.GWS_PROTECTED_USERS = original;
  });

  it('returns empty list by default (no hard-coded tenants)', () => {
    delete process.env.GWS_PROTECTED_USERS;
    expect(getProtectedUserEmails()).toEqual([]);
    expect(isProtectedUserEmail('anyone@example.com')).toBe(false);
  });

  it('parses comma-separated emails case-insensitively', () => {
    process.env.GWS_PROTECTED_USERS = ' Admin@Example.com , backup@example.com ';
    expect(getProtectedUserEmails()).toEqual(['admin@example.com', 'backup@example.com']);
    expect(isProtectedUserEmail('admin@example.com')).toBe(true);
    expect(isProtectedUserEmail('BACKUP@example.com')).toBe(true);
    expect(isProtectedUserEmail('other@example.com')).toBe(false);
  });
});

/** Policy: admins are never deleted from this app (enforced in users.routes DELETE). */
describe('admin delete policy (documented)', () => {
  it('documents that super and delegated admins must not be deleted here', () => {
    // Runtime enforcement is in users.routes.ts via Directory isAdmin / isDelegatedAdmin.
    expect(true).toBe(true);
  });
});
