import { validateEmail, validateDomain, validateDelegationDomain, sanitizeText } from '../src/utils/validation';

describe('Security Validation Tests', () => {
  describe('Input Sanitization', () => {
    test('should prevent basic XSS in text sanitization', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = sanitizeText(maliciousInput);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });

    test('should escape HTML characters', () => {
      const htmlInput = '<b>Bold</b> & "quotes" \'apostrophes\'';
      const sanitized = sanitizeText(htmlInput);

      expect(sanitized).toContain('&lt;b&gt;');
      expect(sanitized).toContain('&amp;');
      expect(sanitized).toContain('&quot;');
      expect(sanitized).toContain('&#x27;');
    });
  });

  describe('Email Security Validation', () => {
    test('should reject malformed email formats', () => {
      const invalidEmails = [
        'invalid-email-format',
        '@domain.com',
        'user@',
        'user@@domain.com',
        'user name@domain.com' // Spaces not allowed
      ];

      invalidEmails.forEach(email => {
        const result = validateEmail(email);
        expect(result.valid).toBe(false);
      });
    });

    test('should validate legitimate business emails', () => {
      const validEmails = [
        'john.doe@company.com',
        'admin@subsidiary.example.org',
        'user+tag@domain.co.uk',
        'test.email@sub.domain.com'
      ];

      validEmails.forEach(email => {
        const result = validateEmail(email);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Domain Security Validation', () => {
    test('should reject potentially malicious domains', () => {
      const maliciousDomains = [
        'evil.com; DROP TABLE domains--',
        'malicious.com<script>',
        'bad.com\' OR \'1\'=\'1',
        'evil.com; rm -rf / --'
      ];

      maliciousDomains.forEach(domain => {
        const result = validateDomain(domain);
        expect(result.valid).toBe(false);
      });
    });

    test('should validate legitimate business domains', () => {
      const validDomains = [
        'company.com',
        'subsidiary.example.org',
        'sub.domain.co.uk',
        'my-org.com'
      ];

      validDomains.forEach(domain => {
        const result = validateDomain(domain);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Cross-Domain Security', () => {
    test('should prevent delegation to unauthorized domains', () => {
      // Default behavior - only same domain
      delete process.env.GWS_ALLOWED_DOMAINS;
      const result = validateDelegationDomain('user@company.com', 'delegate@evil.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    test('should allow delegation within configured multi-domain setup', () => {
      process.env.GWS_ALLOWED_DOMAINS = 'company.com,eu.company.com,subsidiary.com';

      const validDelegations = [
        ['user@company.com', 'delegate@eu.company.com'],
        ['admin@subsidiary.com', 'assistant@company.com'],
        ['user@eu.company.com', 'manager@subsidiary.com']
      ];

      validDelegations.forEach(([userEmail, delegateEmail]) => {
        const result = validateDelegationDomain(userEmail, delegateEmail);
        expect(result.valid).toBe(true);
      });

      // Should still reject external domains
      const invalidResult = validateDelegationDomain('user@company.com', 'attacker@external.com');
      expect(invalidResult.valid).toBe(false);
    });
  });

  describe('Security Boundary Testing', () => {
    test('should enforce strict domain boundaries', () => {
      // Test various domain spoofing attempts
      const spoofingAttempts = [
        ['admin@company.com', 'admin@company.com.evil.com'],
        ['user@domain.com', 'user@domain.co.m'],
        ['test@org.com', 'test@orgg.com'],
        ['admin@corp.com', 'admin@corp.com.evil.org']
      ];

      spoofingAttempts.forEach(([userEmail, delegateEmail]) => {
        const result = validateDelegationDomain(userEmail, delegateEmail);
        expect(result.valid).toBe(false);
      });
    });

    test('should handle edge cases securely', () => {
      // Test undefined/null inputs
      expect(() => validateEmail(null as any)).not.toThrow();
      expect(() => validateDomain(undefined as any)).not.toThrow();
      expect(() => sanitizeText(null as any)).not.toThrow();

      // Test extremely long inputs
      const longInput = 'a'.repeat(10000);
      const result = sanitizeText(longInput);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });
  });
});