/**
 * External-sharing scan worker (Cloud Run Job).
 *
 * Google exposes no domain-wide "list every file" API, so full-org coverage
 * requires impersonating each user via domain-wide delegation and listing the
 * files they own, plus scanning every Shared Drive with domain admin access.
 * This is slow and bursty, so it runs as an on-demand Cloud Run Job (bills only
 * while running, scales to zero) rather than inside the request-serving web
 * container. Results are written to GCS via scanStore and read back instantly
 * by the web app.
 *
 * Entry point: `node dist/jobs/externalScan.js`
 * Env:
 *   SCAN_ID                — unique id for this run (from the triggering API)
 *   SCAN_TRIGGERED_BY      — admin email to impersonate for Directory + drives
 *   SCAN_USER_CONCURRENCY  — parallel per-user scans (default 15)
 *   SCAN_BUCKET            — GCS bucket for reports (see scanStore)
 *   WORKSPACE_DOMAIN / GWS_ALLOWED_DOMAINS — internal domains (allowlist)
 */
import { google } from 'googleapis';
import { getDelegatedAuthClient } from '../config/google.config';
import { mapWithConcurrency } from '../utils/concurrency';
import {
  classifyPermissions,
  hasAnyExposure,
  primaryExposure,
  PermissionLite,
} from '../utils/externalSharing';
import {
  putStatus,
  putReport,
  ScanRecord,
  ScanReport,
  ScanStatus,
  ScanCoverage,
} from '../services/scanStore';

const USER_CONCURRENCY = Number(process.env.SCAN_USER_CONCURRENCY) || 15;
const STATUS_FLUSH_MS = 3000;
const PERMISSION_FIELDS =
  'id, type, role, emailAddress, domain, displayName, deleted';
const FILE_FIELDS = `nextPageToken, files(id, name, mimeType, owners, driveId, webViewLink, modifiedTime, permissions(${PERMISSION_FIELDS}))`;

// Clients are intentionally `any`: the googleapis typings reject some params
// the API accepts in practice (e.g. useDomainAdminAccess), matching how the
// rest of this codebase uses the Drive/Admin clients.
async function driveClientFor(subject: string): Promise<any> {
  const auth = await getDelegatedAuthClient(subject);
  return google.drive({ version: 'v3', auth });
}

async function adminClientFor(subject: string): Promise<any> {
  const auth = await getDelegatedAuthClient(subject);
  return google.admin({ version: 'directory_v1', auth });
}

function activePermissions(raw: any[]): PermissionLite[] {
  return (raw || [])
    .filter((p) => !p.deleted)
    .map((p) => ({
      id: p.id || undefined,
      type: p.type || undefined,
      role: p.role || undefined,
      emailAddress: p.emailAddress || undefined,
      domain: p.domain || undefined,
      displayName: p.displayName || undefined,
    }));
}

function toRecord(file: any, perms: PermissionLite[], pathInfo: { path: string; driveName?: string }): ScanRecord | null {
  const classification = classifyPermissions(perms);
  if (!hasAnyExposure(classification)) return null;
  const exposure = primaryExposure(classification);
  if (!exposure) return null;

  const owner = (file.owners || [])[0];
  return {
    file: {
      id: file.id,
      name: file.name || 'Untitled',
      mimeType: file.mimeType || '',
      owner: owner?.emailAddress || '',
      ownerName: owner?.displayName || undefined,
      path: pathInfo.path,
      driveId: file.driveId || undefined,
      driveName: pathInfo.driveName,
      webViewLink: file.webViewLink || '',
      modifiedTime: file.modifiedTime || '',
    },
    exposure,
    isPublic: classification.isPublic,
    publicRoles: classification.publicPermissions.map((p) => String(p.role || 'reader')),
    externalDomains: classification.externalDomains,
    externalEmails: classification.externalEmails,
    externalGroups: classification.externalGroups,
  };
}

/** List every user in the account (all domains) via the Directory API. */
async function listAllUsers(adminEmail: string): Promise<Array<{ email: string; suspended: boolean }>> {
  const admin = await adminClientFor(adminEmail);
  const users: Array<{ email: string; suspended: boolean }> = [];
  let pageToken: string | undefined;
  do {
    const resp: any = await admin.users.list({
      customer: 'my_customer',
      maxResults: 500,
      pageToken,
      projection: 'basic',
      fields: 'nextPageToken, users(primaryEmail, suspended)',
    });
    for (const u of resp.data.users || []) {
      if (u.primaryEmail) users.push({ email: u.primaryEmail, suspended: u.suspended === true });
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return users;
}

/** Scan a single user's owned (My Drive) files. */
async function scanUserFiles(userEmail: string): Promise<ScanRecord[]> {
  const drive = await driveClientFor(userEmail);
  const records: ScanRecord[] = [];
  const pathInfo = { path: `/Users/${userEmail}/My Drive` };
  let pageToken: string | undefined;
  do {
    const resp: any = await drive.files.list({
      q: "'me' in owners and trashed=false",
      fields: FILE_FIELDS,
      pageSize: 1000,
      pageToken,
      corpora: 'user',
    });
    for (const file of resp.data.files || []) {
      const rec = toRecord(file, activePermissions(file.permissions), pathInfo);
      if (rec) records.push(rec);
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return records;
}

/** List all Shared Drives (id + name) via domain admin access. */
async function listSharedDrives(adminEmail: string): Promise<Array<{ id: string; name: string }>> {
  const drive = await driveClientFor(adminEmail);
  const drives: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;
  do {
    const resp: any = await drive.drives.list({
      pageSize: 100,
      pageToken,
      useDomainAdminAccess: true,
      fields: 'nextPageToken, drives(id, name)',
    });
    for (const d of resp.data.drives || []) {
      if (d.id) drives.push({ id: d.id, name: d.name || d.id });
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return drives;
}

/** Fetch a shared drive's own permissions (inherited by all its files). */
async function sharedDrivePermissions(driveClient: any, driveId: string): Promise<PermissionLite[]> {
  const perms: PermissionLite[] = [];
  let pageToken: string | undefined;
  do {
    const resp: any = await driveClient.permissions.list({
      fileId: driveId,
      supportsAllDrives: true,
      useDomainAdminAccess: true,
      fields: `nextPageToken, permissions(${PERMISSION_FIELDS})`,
      pageSize: 100,
      pageToken,
    });
    perms.push(...activePermissions(resp.data.permissions));
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return perms;
}

function mergePermissions(a: PermissionLite[], b: PermissionLite[]): PermissionLite[] {
  const merged = new Map<string, PermissionLite>();
  for (const perm of [...a, ...b]) {
    const identity = perm.emailAddress || perm.domain || perm.id || 'anyone';
    const key = `${perm.type}|${identity}|${perm.role}`;
    if (!merged.has(key)) merged.set(key, perm);
  }
  return Array.from(merged.values());
}

/** Scan a single Shared Drive's files, merging drive-level permissions. */
async function scanSharedDrive(adminEmail: string, drv: { id: string; name: string }): Promise<ScanRecord[]> {
  const drive = await driveClientFor(adminEmail);
  const records: ScanRecord[] = [];
  const drivePerms = await sharedDrivePermissions(drive, drv.id).catch(() => [] as PermissionLite[]);
  const pathInfo = { path: `/Shared Drives/${drv.name}`, driveName: drv.name };
  let pageToken: string | undefined;
  do {
    const resp: any = await drive.files.list({
      q: 'trashed=false',
      corpora: 'drive',
      driveId: drv.id,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: FILE_FIELDS,
      pageSize: 1000,
      pageToken,
    });
    for (const file of resp.data.files || []) {
      const perms = mergePermissions(activePermissions(file.permissions), drivePerms);
      const rec = toRecord({ ...file, driveId: drv.id }, perms, pathInfo);
      if (rec) records.push(rec);
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return records;
}

async function main(): Promise<void> {
  const scanId = process.env.SCAN_ID || `scan-${Date.now()}`;
  const triggeredBy = process.env.SCAN_TRIGGERED_BY || '';
  const startedAt = new Date().toISOString();

  if (!triggeredBy) {
    throw new Error('SCAN_TRIGGERED_BY (admin email) is required');
  }

  const coverage: ScanCoverage = { usersTotal: 0, usersDone: 0, sharedDrivesTotal: 0, sharedDrivesDone: 0 };
  const counts = { public: 0, external: 0, total: 0 };
  const records: ScanRecord[] = [];

  const baseStatus = (): ScanStatus => ({
    scanId,
    status: 'running',
    startedAt,
    finishedAt: null,
    triggeredBy,
    coverage: { ...coverage },
    counts: { ...counts },
  });

  let lastFlush = 0;
  const flushStatus = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < STATUS_FLUSH_MS) return;
    lastFlush = now;
    await putStatus(baseStatus()).catch((e) => console.error('putStatus failed:', e?.message || e));
  };

  // Cloud Run sends SIGTERM before killing a task that hits its task-timeout
  // (or on any managed shutdown). Without this handler, status.json would stay
  // "running" forever, blocking future scans with a 409 until the stale window
  // expires. Persist a terminal "failed" status (records so far preserved).
  let settled = false;
  const handleTermination = async (signal: NodeJS.Signals) => {
    if (settled) return;
    settled = true;
    console.error(`[externalScan] ${scanId} received ${signal}; marking scan failed`);
    await putStatus({
      ...baseStatus(),
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `Scan terminated by ${signal} (task timeout or shutdown)`,
    }).catch((e) => console.error('putStatus(failed) on termination failed:', e?.message || e));
    process.exit(1);
  };
  process.once('SIGTERM', (s) => void handleTermination(s));
  process.once('SIGINT', (s) => void handleTermination(s));

  const addRecords = (recs: ScanRecord[]) => {
    for (const r of recs) {
      records.push(r);
      counts.total += 1;
      if (r.exposure === 'public') counts.public += 1;
      else counts.external += 1;
    }
  };

  console.log(`[externalScan] ${scanId} starting (triggeredBy=${triggeredBy})`);
  await flushStatus(true);

  try {
    const [users, drives] = await Promise.all([
      listAllUsers(triggeredBy),
      listSharedDrives(triggeredBy),
    ]);
    const activeUsers = users.filter((u) => !u.suspended);
    coverage.usersTotal = activeUsers.length;
    coverage.sharedDrivesTotal = drives.length;
    await flushStatus(true);

    await mapWithConcurrency(activeUsers, USER_CONCURRENCY, async (user) => {
      try {
        const recs = await scanUserFiles(user.email);
        addRecords(recs);
      } catch (e: any) {
        console.error(`[externalScan] user ${user.email} failed:`, e?.message || e);
      } finally {
        coverage.usersDone += 1;
        await flushStatus();
      }
    });

    // Shared drives: lower concurrency (per-drive listing is already heavy).
    await mapWithConcurrency(drives, Math.max(2, Math.floor(USER_CONCURRENCY / 3)), async (drv) => {
      try {
        const recs = await scanSharedDrive(triggeredBy, drv);
        addRecords(recs);
      } catch (e: any) {
        console.error(`[externalScan] shared drive ${drv.name} failed:`, e?.message || e);
      } finally {
        coverage.sharedDrivesDone += 1;
        await flushStatus();
      }
    });

    const report: ScanReport = {
      ...baseStatus(),
      status: 'completed',
      finishedAt: new Date().toISOString(),
      records,
    };
    settled = true;
    await putReport(report);
    console.log(
      `[externalScan] ${scanId} completed: ${counts.total} exposed files (${counts.public} public, ${counts.external} external)`
    );
  } catch (error: any) {
    settled = true;
    console.error(`[externalScan] ${scanId} failed:`, error?.message || error);
    const failed: ScanReport = {
      ...baseStatus(),
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: error?.message || String(error),
      records,
    };
    await putReport(failed).catch((e) => console.error('putReport(failed) failed:', e?.message || e));
    process.exitCode = 1;
  }
}

main().then(() => {
  // Ensure the container exits promptly once the scan is persisted.
  process.exit(process.exitCode || 0);
});
