import * as dns from 'dns';
import { promisify } from 'util';

const resolveTxt = promisify(dns.resolveTxt);

export interface DNSRecord {
  type: 'SPF' | 'DKIM' | 'DMARC';
  exists: boolean;
  record?: string;
  valid: boolean;
  recommendation?: string;
  issues?: string[];
}

export class DNSCheckService {
  /**
   * Check SPF record for a domain
   */
  async checkSPF(domain: string): Promise<DNSRecord> {
    try {
      const records = await resolveTxt(domain);
      const spfRecord = records
        .flat()
        .find(record => record.startsWith('v=spf1'));

      if (!spfRecord) {
        return {
          type: 'SPF',
          exists: false,
          valid: false,
          recommendation: 'Add SPF record. Recommendation: Set to hard fail (-all)',
          issues: ['SPF record not found'],
        };
      }

      const issues: string[] = [];
      const hasHardFail = spfRecord.includes('-all');
      
      if (!hasHardFail) {
        issues.push('SPF record does not use hard fail (-all). Consider using -all for better security.');
      }

      return {
        type: 'SPF',
        exists: true,
        record: spfRecord,
        valid: hasHardFail,
        recommendation: hasHardFail 
          ? 'SPF record is properly configured with hard fail'
          : 'Consider setting SPF to hard fail (-all)',
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error: any) {
      return {
        type: 'SPF',
        exists: false,
        valid: false,
        recommendation: 'Add SPF record. Recommendation: Set to hard fail (-all)',
        issues: [`DNS lookup failed: ${error.message}`],
      };
    }
  }

  /**
   * Check DKIM record for a domain
   */
  async checkDKIM(domain: string, selector: string = 'google'): Promise<DNSRecord> {
    try {
      const dkimDomain = `${selector}._domainkey.${domain}`;
      const records = await resolveTxt(dkimDomain);
      const dkimRecord = records.flat().join('');

      if (!dkimRecord || !dkimRecord.includes('v=DKIM1')) {
        return {
          type: 'DKIM',
          exists: false,
          valid: false,
          recommendation: 'Add DKIM record. Recommendation: Use 2048-bit encryption (if DNS provider supports it, otherwise 1024-bit)',
          issues: ['DKIM record not found'],
        };
      }

      const issues: string[] = [];
      // Check for key size (k=rsa; p= indicates public key, longer = better)
      const keySizeMatch = dkimRecord.match(/p=([A-Za-z0-9+/=]+)/);
      if (keySizeMatch) {
        const keyLength = keySizeMatch[1].length;
        // 2048-bit RSA key is ~344 chars, 1024-bit is ~172 chars
        if (keyLength < 300) {
          issues.push('DKIM key appears to be less than 2048-bit. Consider upgrading to 2048-bit if DNS provider supports it.');
        }
      }

      return {
        type: 'DKIM',
        exists: true,
        record: dkimRecord.substring(0, 100) + '...', // Truncate for display
        valid: issues.length === 0,
        recommendation: issues.length === 0
          ? 'DKIM is properly configured'
          : 'Consider upgrading to 2048-bit encryption if DNS provider supports it',
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error: any) {
      return {
        type: 'DKIM',
        exists: false,
        valid: false,
        recommendation: 'Add DKIM record. Recommendation: Use 2048-bit encryption (if DNS provider supports it, otherwise 1024-bit)',
        issues: [`DNS lookup failed: ${error.message}`],
      };
    }
  }

  /**
   * Check DMARC record for a domain
   */
  async checkDMARC(domain: string): Promise<DNSRecord> {
    try {
      const dmarcDomain = `_dmarc.${domain}`;
      const records = await resolveTxt(dmarcDomain);
      const dmarcRecord = records.flat().join('');

      if (!dmarcRecord || !dmarcRecord.includes('v=DMARC1')) {
        return {
          type: 'DMARC',
          exists: false,
          valid: false,
          recommendation: 'Add DMARC record. Recommendation: At minimum set to p=none, if spam/spoofing is a problem consider p=quarantine',
          issues: ['DMARC record not found'],
        };
      }

      const issues: string[] = [];
      const policyMatch = dmarcRecord.match(/p=([^;]+)/);
      
      if (!policyMatch) {
        issues.push('DMARC record missing policy (p=)');
      } else {
        const policy = policyMatch[1].toLowerCase();
        if (policy === 'none') {
          // This is acceptable as minimum
        } else if (policy === 'quarantine' || policy === 'reject') {
          // These are better
        } else {
          issues.push(`Unknown DMARC policy: ${policy}`);
        }
      }

      return {
        type: 'DMARC',
        exists: true,
        record: dmarcRecord,
        valid: issues.length === 0,
        recommendation: policyMatch && policyMatch[1].toLowerCase() === 'none'
          ? 'DMARC is set to p=none (minimum). Consider p=quarantine if spam/spoofing is a problem'
          : 'DMARC is properly configured',
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error: any) {
      return {
        type: 'DMARC',
        exists: false,
        valid: false,
        recommendation: 'Add DMARC record. Recommendation: At minimum set to p=none, if spam/spoofing is a problem consider p=quarantine',
        issues: [`DNS lookup failed: ${error.message}`],
      };
    }
  }

  /**
   * Check all DNS records for a domain
   */
  async checkAllDNS(domain: string): Promise<DNSRecord[]> {
    const [spf, dkim, dmarc] = await Promise.all([
      this.checkSPF(domain),
      this.checkDKIM(domain),
      this.checkDMARC(domain),
    ]);

    return [spf, dkim, dmarc];
  }
}

export const dnsCheckService = new DNSCheckService();
