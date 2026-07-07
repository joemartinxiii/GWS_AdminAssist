import fs from 'fs';
import path from 'path';
import {
  putReport,
  getLatest,
  getStatus,
  putStatus,
  ScanReport,
  ScanStatus,
} from '../src/services/scanStore';

// With SCAN_BUCKET unset (see tests/setup.ts) scanStore uses the local-disk
// fallback under backend/data/scans, so this exercises the real serialize ->
// persist -> parse round trip without touching GCS.
const DATA_DIR = path.join(__dirname, '..', 'data', 'scans');

function makeReport(scanId: string): ScanReport {
  return {
    scanId,
    status: 'completed',
    startedAt: '2026-07-06T00:00:00.000Z',
    finishedAt: '2026-07-06T00:05:00.000Z',
    triggeredBy: 'admin@example.com',
    coverage: { usersTotal: 3, usersDone: 3, sharedDrivesTotal: 1, sharedDrivesDone: 1 },
    counts: { public: 1, external: 1, total: 2 },
    records: [
      {
        file: {
          id: 'file1',
          name: 'Public Doc',
          mimeType: 'application/vnd.google-apps.document',
          owner: 'alice@example.com',
          path: 'My Drive/Public Doc',
          webViewLink: 'https://docs.example/1',
          modifiedTime: '2026-07-01T00:00:00.000Z',
        },
        exposure: 'public',
        isPublic: true,
        publicRoles: ['reader'],
        externalDomains: [],
        externalEmails: [],
        externalGroups: [],
      },
      {
        file: {
          id: 'file2',
          name: 'Shared With Partner',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          owner: 'bob@example.com',
          path: 'My Drive/Shared With Partner',
          webViewLink: 'https://docs.example/2',
          modifiedTime: '2026-07-02T00:00:00.000Z',
        },
        exposure: 'external',
        isPublic: false,
        publicRoles: [],
        externalDomains: ['partner.org'],
        externalEmails: ['x@partner.org'],
        externalGroups: [],
      },
    ],
  };
}

describe('scanStore round-trip (local-disk fallback)', () => {
  afterAll(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  test('putReport then getLatest returns an identical report', async () => {
    const report = makeReport('scan-roundtrip-1');
    await putReport(report);
    const loaded = await getLatest();
    expect(loaded).toEqual(report);
  });

  test('putReport keeps a lightweight status (without records) in sync', async () => {
    const report = makeReport('scan-roundtrip-2');
    await putReport(report);
    const status = await getStatus();
    expect(status).not.toBeNull();
    expect(status?.scanId).toBe('scan-roundtrip-2');
    expect(status?.counts.total).toBe(2);
    expect((status as unknown as { records?: unknown }).records).toBeUndefined();
  });

  test('putReport writes an immutable per-scan history snapshot', async () => {
    const report = makeReport('scan-history-1');
    await putReport(report);
    const historyFile = path.join(DATA_DIR, 'history', 'scan-history-1.json');
    expect(fs.existsSync(historyFile)).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(snapshot.scanId).toBe('scan-history-1');
    expect(snapshot.records).toHaveLength(2);
  });

  test('putStatus / getStatus round-trip for in-progress scans', async () => {
    const status: ScanStatus = {
      scanId: 'scan-progress-1',
      status: 'running',
      startedAt: '2026-07-06T01:00:00.000Z',
      finishedAt: null,
      triggeredBy: 'admin@example.com',
      coverage: { usersTotal: 10, usersDone: 4, sharedDrivesTotal: 2, sharedDrivesDone: 0 },
      counts: { public: 0, external: 0, total: 0 },
    };
    await putStatus(status);
    const loaded = await getStatus();
    expect(loaded).toEqual(status);
  });
});
