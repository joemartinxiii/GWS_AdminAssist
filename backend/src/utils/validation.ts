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

export function validateDelegationDomain(userEmail: string, delegateEmail: string): { valid: boolean; error?: string } {
  const userDomain = userEmail.split('@')[1];
  const delegateDomain = delegateEmail.split('@')[1];

  // Get allowed domains from environment (comma-separated)
  const allowedDomains = process.env.GWS_ALLOWED_DOMAINS?.split(',').map(d => d.trim()) || [userDomain];

  if (!allowedDomains.includes(delegateDomain)) {
    return {
      valid: false,
      error: `Delegate domain '${delegateDomain}' not allowed. Allowed domains: ${allowedDomains.join(', ')}`
    };
  }

  return { valid: true };
}

export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return '';

  // Basic XSS prevention - escape HTML
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}