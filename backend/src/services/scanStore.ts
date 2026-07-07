import fs from 'fs';
import path from 'path';
import type { Exposure } from '../utils/externalSharing';

/**
 * Durable storage for external-sharing scan reports.
 *
 * The scan runs asynchronously in a Cloud Run Job and can produce large
 * reports, so results are persisted as JSON objects in Google Cloud Storage
 * (bucket from `SCAN_BUCKET`). The web app reads the cached `latest.json`
 * instantly and shows "Last scan {date}". Local disk is used as a fallback for
 * development when no bucket is configured.
 *
 * Layout under the bucket:
 *   external-scans/status.json          — small, frequently-updated progress
 *   external-scans/latest.json          — most recent completed/among report
 *   external-scans/history/<scanId>.json — immutable per-scan snapshots
 */

export interface ScanFile {
  id: string;
  name: string;
  mimeType: string;
  owner: string;
  ownerName?: string;
  path: string;
  driveId?: string;
  driveName?: string;
  webViewLink: string;
  modifiedTime: string;
}

export interface ScanRecord {
  file: ScanFile;
  /** Primary exposure (public preferred when a file is both). */
  exposure: Exposure;
  isPublic: boolean;
  /** Roles granted to `anyone` (e.g. reader/writer) — informs public-link risk. */
  publicRoles: string[];
  externalDomains: string[];
  externalEmails: string[];
  externalGroups: string[];
}

export type ScanStatusState = 'running' | 'completed' | 'failed';

export interface ScanCoverage {
  usersTotal: number;
  usersDone: number;
  sharedDrivesTotal: number;
  sharedDrivesDone: number;
}

export interface ScanCounts {
  public: number;
  external: number;
  total: number;
}

/** Small progress document polled by the UI (no records). */
export interface ScanStatus {
  scanId: string;
  status: ScanStatusState;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  coverage: ScanCoverage;
  counts: ScanCounts;
  error?: string;
}

/** Full report including per-file records. */
export interface ScanReport extends ScanStatus {
  records: ScanRecord[];
}

const BUCKET_NAME = process.env.SCAN_BUCKET || '';
const PREFIX = process.env.SCAN_OBJECT_PREFIX || 'external-scans';
const STATUS_OBJECT = `${PREFIX}/status.json`;
const LATEST_OBJECT = `${PREFIX}/latest.json`;

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'scans');

let storageBucket: any = null;
async function getBucket(): Promise<any | null> {
  if (!BUCKET_NAME) return null;
  if (!storageBucket) {
    const { Storage } = await import('@google-cloud/storage');
    storageBucket = new Storage().bucket(BUCKET_NAME);
  }
  return storageBucket;
}

function localPath(object: string): string {
  return path.join(DATA_DIR, object.replace(`${PREFIX}/`, ''));
}

async function writeObject(object: string, payload: string): Promise<void> {
  const bucket = await getBucket();
  if (bucket) {
    await bucket.file(object).save(payload, {
      contentType: 'application/json',
      resumable: false,
    });
    return;
  }
  const filePath = localPath(object);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload, 'utf-8');
}

async function readObject(object: string): Promise<string | null> {
  const bucket = await getBucket();
  if (bucket) {
    const file = bucket.file(object);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return contents.toString('utf-8');
  }
  try {
    return fs.readFileSync(localPath(object), 'utf-8');
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function putStatus(status: ScanStatus): Promise<void> {
  await writeObject(STATUS_OBJECT, JSON.stringify(status));
}

export async function getStatus(): Promise<ScanStatus | null> {
  return parse<ScanStatus>(await readObject(STATUS_OBJECT));
}

/** Persist a full report: overwrite latest.json and write an immutable history snapshot. */
export async function putReport(report: ScanReport): Promise<void> {
  const payload = JSON.stringify(report);
  await writeObject(LATEST_OBJECT, payload);
  await writeObject(`${PREFIX}/history/${report.scanId}.json`, payload);
  // Keep the lightweight status in sync with the latest report.
  const { records, ...status } = report;
  void records;
  await putStatus(status);
}

export async function getLatest(): Promise<ScanReport | null> {
  return parse<ScanReport>(await readObject(LATEST_OBJECT));
}
