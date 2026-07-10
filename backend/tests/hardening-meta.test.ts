import { humanizeApiFailure, policyApiMetaFromSnapshot } from '../src/services/hardening.service';
import { PolicySnapshot } from '../src/services/policy.service';

describe('hardening humanizeApiFailure', () => {
  test('maps 403 without dumping JSON bodies', () => {
    const raw = 'Policy API HTTP 403: {"error":{"code":403,"message":"The caller does not have permission"}}';
    const msg = humanizeApiFailure(raw, 'Cloud Identity Policy API');
    expect(msg).toMatch(/permission denied/i);
    expect(msg).not.toMatch(/\{/);
    expect(msg).not.toMatch(/caller does not have permission/i);
  });

  test('maps 429 rate limits clearly', () => {
    const msg = humanizeApiFailure('Policy API HTTP 429', 'Cloud Identity Policy API');
    expect(msg).toMatch(/rate-limited/i);
    expect(msg).toMatch(/run the audit again/i);
  });

  test('maps generic long/JSON payloads to stable copy', () => {
    const msg = humanizeApiFailure('something went wrong ' + '{'.repeat(5) + 'x'.repeat(200), 'Directory');
    expect(msg).toMatch(/request failed/i);
    expect(msg.length).toBeLessThan(200);
  });
});

describe('policyApiMetaFromSnapshot', () => {
  test('available snapshot has no error fields', () => {
    const snap = new PolicySnapshot([], true);
    expect(policyApiMetaFromSnapshot(snap)).toEqual({ available: true });
  });

  test('403 becomes http_403 with human message', () => {
    const snap = new PolicySnapshot([], false, 'Policy API HTTP 403');
    const meta = policyApiMetaFromSnapshot(snap);
    expect(meta.available).toBe(false);
    expect(meta.code).toBe('http_403');
    expect(meta.message).toMatch(/permission denied/i);
  });

  test('429 becomes http_429 with retry guidance', () => {
    const snap = new PolicySnapshot([], false, 'Policy API HTTP 429');
    const meta = policyApiMetaFromSnapshot(snap);
    expect(meta.code).toBe('http_429');
    expect(meta.message).toMatch(/rate-limited/i);
  });
});
