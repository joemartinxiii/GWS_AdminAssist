export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (email.length > 254) {
    return { valid: false, error: 'Email too long' };
  }

  return { valid: true };
}

export function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain is required' };
  }

  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, error: 'Invalid domain format' };
  }

  if (domain.length > 253) {
    return { valid: false, error: 'Domain too long' };
  }

  return { valid: true };
}

/**
 * Domains permitted for this install: WORKSPACE_DOMAIN plus GWS_ALLOWED_DOMAINS.
 * Used for login, external-share classification, and mutation gates.
 */
export function getAllowedDomains(): string[] {
  const domains = new Set<string>();
  const primary = process.env.WORKSPACE_DOMAIN?.trim().toLowerCase();
  if (primary) domains.add(primary);
  for (const d of process.env.GWS_ALLOWED_DOMAINS?.split(',') || []) {
    const trimmed = d.trim().toLowerCase();
    if (trimmed) domains.add(trimmed);
  }
  return Array.from(domains);
}

/**
 * Allowlist for checks when env may be empty (unit tests): fall back to a
 * single domain derived from `fallbackEmail` so same-domain ops still work.
 */
function allowedDomainsWithFallback(fallbackEmail?: string): string[] {
  const allowed = getAllowedDomains();
  if (allowed.length > 0) return allowed;
  const fb = String(fallbackEmail || '')
    .split('@')[1]
    ?.toLowerCase();
  return fb ? [fb] : [];
}

/**
 * True if the email belongs to a permitted Workspace domain. If no domains are
 * configured (misconfiguration), returns false so we fail closed in production.
 */
export function isEmailInAllowedDomain(email: string): boolean {
  const domain = String(email || '')
    .split('@')[1]
    ?.toLowerCase();
  if (!domain) return false;
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return false;
  return allowed.includes(domain);
}

export function isDomainAllowed(domain: string): boolean {
  const d = String(domain || '')
    .trim()
    .toLowerCase();
  if (!d) return false;
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return false;
  return allowed.includes(d);
}

/**
 * Format + allowlist check for mutation targets (create user, add member, etc.).
 * Fail closed when allowlist is empty (misconfigured production).
 */
export function requireAllowedEmail(email: string): { valid: boolean; error?: string } {
  const format = validateEmail(email);
  if (!format.valid) return format;
  if (!isEmailInAllowedDomain(email)) {
    const allowed = getAllowedDomains();
    return {
      valid: false,
      error:
        allowed.length === 0
          ? 'Domain allowlist is not configured (WORKSPACE_DOMAIN / GWS_ALLOWED_DOMAINS).'
          : `Email domain is not in the allowed domain list. Allowed: ${allowed.join(', ')}`,
    };
  }
  return { valid: true };
}

/** True if two emails are the same mailbox (case-insensitive). */
export function emailsEqual(a: string, b: string): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Both parties for delegation should be on the org allowlist (or same domain
 * when env is unset in tests).
 */
export function validateDelegationDomain(
  userEmail: string,
  delegateEmail: string
): { valid: boolean; error?: string } {
  const userCheck = validateEmail(userEmail);
  if (!userCheck.valid) return userCheck;
  const delegateCheck = validateEmail(delegateEmail);
  if (!delegateCheck.valid) return delegateCheck;

  const allowed = allowedDomainsWithFallback(userEmail);
  const userDomain = userEmail.split('@')[1]?.toLowerCase();
  const delegateDomain = delegateEmail.split('@')[1]?.toLowerCase();

  if (!userDomain || !allowed.includes(userDomain)) {
    return {
      valid: false,
      error: `User domain '${userDomain || '?'}' not allowed. Allowed domains: ${allowed.join(', ')}`,
    };
  }
  if (!delegateDomain || !allowed.includes(delegateDomain)) {
    return {
      valid: false,
      error: `Delegate domain '${delegateDomain || '?'}' not allowed. Allowed domains: ${allowed.join(', ')}`,
    };
  }

  return { valid: true };
}

export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
