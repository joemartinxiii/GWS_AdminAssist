import fs from 'fs';
import path from 'path';
import {
  putLatest,
  getLatest,
  getWaivers,
  putWaivers,
  setWaiver,
  removeWaiver,
  mergeWaivers,
  SecurityAuditReport,
} from '../src/services/securityAuditStore';

const DATA_DIR = path.join(__dirname, '..', 'data', 'security-audit');

function makeReport(): SecurityAuditReport {
  return {
    ranAt: '2026-07-10T12:00:00.000Z',
    triggeredBy: 'admin@example.com',
    durationMs: 1500,
    statistics: { total: 2, pass: 1, warning: 1, fail: 0, manual: 0, info: 0 },
    policyApi: { available: true },
    checks: [
      {
        id: '2fa-enforcement',
        category: 'Authentication',
        name: '2-Step Verification',
        description: 'Test',
        status: 'pass',
        source: 'auto',
        severity: 'critical',
        rationale: 'Why',
        recommendation: 'How',
        currentValue: '100%',
        recommendedValue: 'Enforced',
      },
      {
        id: 'gmail-auto-forwarding',
        category: 'Email',
        name: 'Automatic Forwarding',
        description: 'Test',
        status: 'warning',
        source: 'auto',
        severity: 'critical',
        rationale: 'Why',
        recommendation: 'How',
        currentValue: 'Allowed',
        recommendedValue: 'OFF',
      },
    ],
  };
}

describe('securityAuditStore round-trip (local-disk fallback)', () => {
  afterAll(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  test('putLatest then getLatest returns an identical report', async () => {
    const report = makeReport();
    await putLatest(report);
    const loaded = await getLatest();
    expect(loaded).toEqual(report);
  });

  test('waivers outlive report rewrites and support set/remove/merge', async () => {
    await putWaivers({});
    await setWaiver('2fa-enforcement', 'VIP exception', 'admin@example.com');
    let waivers = await getWaivers();
    expect(waivers['2fa-enforcement'].reason).toBe('VIP exception');
    expect(waivers['2fa-enforcement'].waivedBy).toBe('admin@example.com');

    // New audit snapshot must not clear waivers
    await putLatest(makeReport());
    waivers = await getWaivers();
    expect(waivers['2fa-enforcement']).toBeDefined();

    // Merge does not overwrite existing
    await mergeWaivers(
      { '2fa-enforcement': 'should not replace', 'gmail-auto-forwarding': 'client accepted' },
      'admin@example.com'
    );
    waivers = await getWaivers();
    expect(waivers['2fa-enforcement'].reason).toBe('VIP exception');
    expect(waivers['gmail-auto-forwarding'].reason).toBe('client accepted');

    await removeWaiver('2fa-enforcement');
    waivers = await getWaivers();
    expect(waivers['2fa-enforcement']).toBeUndefined();
    expect(waivers['gmail-auto-forwarding']).toBeDefined();
  });
});
