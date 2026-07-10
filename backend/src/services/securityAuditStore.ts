import fs from 'fs';
import path from 'path';

/**
 * Durable storage for Security Audit last-run results and org-level waivers.
 *
 * Same free-tier pattern as external-sharing scans (`scanStore`): JSON objects
 * in GCS when `SCAN_BUCKET` is set, local disk under `backend/data/` otherwise.
 *
 * Layout:
 *   security-audit/latest.json   — most recent completed audit snapshot
 *   security-audit/waivers.json  — durable check waivers (outlive individual runs)
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface PolicyApiMeta {
  available: boolean;
  /** Short machine-friendly code when unavailable, e.g. "http_403". */
  code?: string;
  /** Human-readable explanation — never a raw Google JSON body. */
  message?: string;
}

export interface HardeningStatistics {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  manual: number;
  info: number;
}

/** Serialized check shape (matches hardening.service HardeningCheck). */
export interface StoredHardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'warning' | 'fail' | 'manual' | 'info';
  source: 'auto' | 'manual';
  severity: Severity;
  currentValue?: unknown;
  recommendedValue?: unknown;
  rationale: string;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

/** Full snapshot written after each successful Run. */
export interface SecurityAuditReport {
  ranAt: string;
  triggeredBy: string;
  durationMs: number;
  checks: StoredHardeningCheck[];
  statistics: HardeningStatistics;
  policyApi: PolicyApiMeta;
}

export interface WaiverEntry {
  reason: string;
  waivedBy: string;
  waivedAt: string;
}

/** Map of checkId → waiver. Unknown check IDs are retained (orphans). */
export type WaiversMap = Record<string, WaiverEntry>;

const BUCKET_NAME = process.env.SCAN_BUCKET || '';
const PREFIX = process.env.SECURITY_AUDIT_PREFIX || 'security-audit';
const LATEST_OBJECT = `${PREFIX}/latest.json`;
const WAIVERS_OBJECT = `${PREFIX}/waivers.json`;

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'security-audit');

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

export async function putLatest(report: SecurityAuditReport): Promise<void> {
  await writeObject(LATEST_OBJECT, JSON.stringify(report));
}

export async function getLatest(): Promise<SecurityAuditReport | null> {
  const parsed = parse<SecurityAuditReport>(await readObject(LATEST_OBJECT));
  if (!parsed || !Array.isArray(parsed.checks)) return null;
  return parsed;
}

export async function getWaivers(): Promise<WaiversMap> {
  const parsed = parse<WaiversMap>(await readObject(WAIVERS_OBJECT));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  // Normalize entries; drop garbage.
  const out: WaiversMap = {};
  for (const [id, entry] of Object.entries(parsed)) {
    if (!id || typeof id !== 'string') continue;
    if (!entry || typeof entry !== 'object') continue;
    const reason = typeof (entry as WaiverEntry).reason === 'string' ? (entry as WaiverEntry).reason : '';
    const waivedBy =
      typeof (entry as WaiverEntry).waivedBy === 'string' ? (entry as WaiverEntry).waivedBy : '';
    const waivedAt =
      typeof (entry as WaiverEntry).waivedAt === 'string'
        ? (entry as WaiverEntry).waivedAt
        : new Date(0).toISOString();
    out[id] = { reason, waivedBy, waivedAt };
  }
  return out;
}

export async function putWaivers(waivers: WaiversMap): Promise<void> {
  await writeObject(WAIVERS_OBJECT, JSON.stringify(waivers));
}

export async function setWaiver(
  checkId: string,
  reason: string,
  waivedBy: string
): Promise<WaiversMap> {
  const current = await getWaivers();
  current[checkId] = {
    reason: reason.trim(),
    waivedBy,
    waivedAt: new Date().toISOString(),
  };
  await putWaivers(current);
  return current;
}

export async function removeWaiver(checkId: string): Promise<WaiversMap> {
  const current = await getWaivers();
  if (checkId in current) {
    delete current[checkId];
    await putWaivers(current);
  }
  return current;
}

/** Merge a full map (used for browser→cloud one-time import). */
export async function mergeWaivers(
  incoming: Record<string, string>,
  waivedBy: string
): Promise<WaiversMap> {
  const current = await getWaivers();
  const now = new Date().toISOString();
  for (const [id, reason] of Object.entries(incoming)) {
    if (!id || typeof id !== 'string') continue;
    if (id in current) continue; // never overwrite an existing org waiver
    current[id] = {
      reason: typeof reason === 'string' ? reason.trim() : '',
      waivedBy,
      waivedAt: now,
    };
  }
  await putWaivers(current);
  return current;
}
