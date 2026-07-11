/**
 * Accounts that must never be permanently deleted via this app.
 * Configure with GWS_PROTECTED_USERS (comma-separated emails). Empty by default —
 * do not hard-code tenant-specific addresses in the codebase.
 */
export function getProtectedUserEmails(): string[] {
  return (process.env.GWS_PROTECTED_USERS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isProtectedUserEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  if (!lower) return false;
  return getProtectedUserEmails().includes(lower);
}
