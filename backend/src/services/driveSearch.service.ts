/**
 * Org-wide Drive search.
 *
 * Google exposes no cross-domain "search all files" API, so an admin search
 * must fan out per user via domain-wide delegation. The key insight vs. a full
 * enumeration is that the query is *selective*: cost scales with the number of
 * users (each returns 0..few matches), not the total file count. Two fast paths
 * collapse the fan-out entirely:
 *   - owner specified  → impersonate that one user, one query.
 *   - shared drive     → query just that drive's corpus with the requesting admin.
 * Otherwise we scatter the query across all active users (bounded concurrency)
 * plus every shared drive, gather + dedupe matches, and cap the result set.
 */
import { google } from 'googleapis';
import { getDelegatedAuthClient } from '../config/google.config';
import { mapWithConcurrency } from '../utils/concurrency';

const SEARCH_CONCURRENCY = Number(process.env.DRIVE_SEARCH_CONCURRENCY) || 20;
const DEFAULT_MAX_RESULTS = Number(process.env.DRIVE_SEARCH_MAX_RESULTS) || 300;
const HARD_MAX_RESULTS = 1000;
const FILE_FIELDS =
  'nextPageToken, files(id, name, mimeType, owners(emailAddress, displayName), driveId, webViewLink, modifiedTime, createdTime, size, shared)';

export interface DriveSearchCriteria {
  /** Free text matched against file name OR full-text content. */
  text?: string;
  /** Restrict to a single owner (email). Triggers the one-user fast path. */
  owner?: string;
  /** Restrict to a single shared drive id. Triggers the shared-drive fast path. */
  driveId?: string;
  mimeType?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
  /** Include trashed files (default false). */
  includeTrashed?: boolean;
  /** Cap on returned files (default 300, hard max 1000). */
  maxResults?: number;
}

export interface DriveSearchResultFile {
  id: string;
  name: string;
  mimeType: string;
  owners: Array<{ emailAddress: string; displayName: string }>;
  driveId?: string;
  driveName?: string;
  webViewLink: string;
  modifiedTime: string;
  createdTime?: string;
  size?: string;
  shared: boolean;
  path: string;
}

export interface DriveSearchResponse {
  files: DriveSearchResultFile[];
  matched: number;
  truncated: boolean;
  scope: 'owner' | 'shared-drive' | 'org';
  usersTotal?: number;
  usersScanned?: number;
  sharedDrivesScanned?: number;
  durationMs: number;
}

function driveClientFor(subject: string): Promise<any> {
  return getDelegatedAuthClient(subject).then((auth) => google.drive({ version: 'v3', auth }));
}

function adminClientFor(subject: string): Promise<any> {
  return getDelegatedAuthClient(subject).then((auth) => google.admin({ version: 'directory_v1', auth }));
}

/** Escape a value for safe interpolation inside a Drive `q` string literal. */
function escapeQ(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toRfc3339(value: string): string | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Build the Drive `q` from structured criteria (never from raw client input). */
export function buildQuery(c: DriveSearchCriteria): string {
  const parts: string[] = [];
  if (!c.includeTrashed) parts.push('trashed = false');
  if (c.text) {
    const t = escapeQ(c.text.trim());
    if (t) parts.push(`(name contains '${t}' or fullText contains '${t}')`);
  }
  if (c.mimeType) parts.push(`mimeType = '${escapeQ(c.mimeType)}'`);
  const modAfter = c.modifiedAfter && toRfc3339(c.modifiedAfter);
  const modBefore = c.modifiedBefore && toRfc3339(c.modifiedBefore);
  const crAfter = c.createdAfter && toRfc3339(c.createdAfter);
  const crBefore = c.createdBefore && toRfc3339(c.createdBefore);
  if (modAfter) parts.push(`modifiedTime >= '${modAfter}'`);
  if (modBefore) parts.push(`modifiedTime <= '${modBefore}'`);
  if (crAfter) parts.push(`createdTime >= '${crAfter}'`);
  if (crBefore) parts.push(`createdTime <= '${crBefore}'`);
  return parts.join(' and ');
}

function mapFile(file: any, path: string, driveName?: string): DriveSearchResultFile {
  return {
    id: file.id,
    name: file.name || 'Untitled',
    mimeType: file.mimeType || '',
    owners: (file.owners || []).map((o: any) => ({
      emailAddress: o.emailAddress || '',
      displayName: o.displayName || o.emailAddress || '',
    })),
    driveId: file.driveId || undefined,
    driveName,
    webViewLink: file.webViewLink || '',
    modifiedTime: file.modifiedTime || '',
    createdTime: file.createdTime || undefined,
    size: file.size || undefined,
    shared: file.shared === true,
    path,
  };
}

/** Search one user's owned My Drive files (impersonated). */
async function searchUserOwned(userEmail: string, baseQuery: string, limit: number): Promise<DriveSearchResultFile[]> {
  const drive = await driveClientFor(userEmail);
  const q = baseQuery ? `${baseQuery} and 'me' in owners` : `'me' in owners`;
  const out: DriveSearchResultFile[] = [];
  const path = `/Users/${userEmail}/My Drive`;
  let pageToken: string | undefined;
  do {
    const resp: any = await drive.files.list({
      q,
      corpora: 'user',
      fields: FILE_FIELDS,
      pageSize: Math.min(1000, limit),
      pageToken,
    });
    for (const f of resp.data.files || []) out.push(mapFile(f, path));
    if (out.length >= limit) break;
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/** Search one shared drive's files (as the requesting admin). */
async function searchSharedDrive(
  adminEmail: string,
  driveId: string,
  driveName: string | undefined,
  baseQuery: string,
  limit: number
): Promise<DriveSearchResultFile[]> {
  const drive = await driveClientFor(adminEmail);
  const out: DriveSearchResultFile[] = [];
  const path = `/Shared Drives/${driveName || driveId}`;
  let pageToken: string | undefined;
  do {
    const resp: any = await drive.files.list({
      q: baseQuery || 'trashed = false',
      corpora: 'drive',
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: FILE_FIELDS,
      pageSize: Math.min(1000, limit),
      pageToken,
    });
    for (const f of resp.data.files || []) out.push(mapFile({ ...f, driveId }, path, driveName));
    if (out.length >= limit) break;
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function listAllUsers(adminEmail: string): Promise<string[]> {
  const admin = await adminClientFor(adminEmail);
  const emails: string[] = [];
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
      if (u.primaryEmail && u.suspended !== true) emails.push(u.primaryEmail);
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return emails;
}

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

/**
 * Run an org-wide Drive search. `adminEmail` is the requesting admin (used to
 * enumerate users and read shared drives).
 */
export async function searchOrgFiles(
  adminEmail: string,
  criteria: DriveSearchCriteria
): Promise<DriveSearchResponse> {
  const started = Date.now();
  const limit = Math.min(HARD_MAX_RESULTS, Math.max(1, criteria.maxResults || DEFAULT_MAX_RESULTS));
  const baseQuery = buildQuery(criteria);

  // Fast path: a specific owner — one impersonated query, no fan-out.
  if (criteria.owner && criteria.owner.trim()) {
    const files = await searchUserOwned(criteria.owner.trim(), baseQuery, limit + 1);
    const truncated = files.length > limit;
    return {
      files: files.slice(0, limit),
      matched: Math.min(files.length, limit),
      truncated,
      scope: 'owner',
      durationMs: Date.now() - started,
    };
  }

  // Fast path: a specific shared drive — one admin query, no fan-out.
  if (criteria.driveId && criteria.driveId.trim()) {
    let driveName: string | undefined;
    try {
      const drives = await listSharedDrives(adminEmail);
      driveName = drives.find((d) => d.id === criteria.driveId)?.name;
    } catch {
      /* name is best-effort */
    }
    const files = await searchSharedDrive(adminEmail, criteria.driveId.trim(), driveName, baseQuery, limit + 1);
    const truncated = files.length > limit;
    return {
      files: files.slice(0, limit),
      matched: Math.min(files.length, limit),
      truncated,
      scope: 'shared-drive',
      sharedDrivesScanned: 1,
      durationMs: Date.now() - started,
    };
  }

  // General fan-out: scatter the query across all users + shared drives.
  const [users, drives] = await Promise.all([
    listAllUsers(adminEmail),
    listSharedDrives(adminEmail).catch(() => [] as Array<{ id: string; name: string }>),
  ]);

  const byId = new Map<string, DriveSearchResultFile>();
  let usersScanned = 0;
  let truncated = false;
  const capReached = () => byId.size >= limit;

  await mapWithConcurrency(users, SEARCH_CONCURRENCY, async (email) => {
    if (capReached()) return;
    usersScanned += 1;
    try {
      const matches = await searchUserOwned(email, baseQuery, limit);
      for (const f of matches) {
        if (!byId.has(f.id)) {
          if (byId.size >= limit) { truncated = true; break; }
          byId.set(f.id, f);
        }
      }
    } catch {
      // Skip users we can't impersonate/list (suspended mid-scan, etc.).
    }
  });

  let sharedDrivesScanned = 0;
  for (const drv of drives) {
    if (capReached()) { truncated = true; break; }
    sharedDrivesScanned += 1;
    try {
      const matches = await searchSharedDrive(adminEmail, drv.id, drv.name, baseQuery, limit);
      for (const f of matches) {
        if (!byId.has(f.id)) {
          if (byId.size >= limit) { truncated = true; break; }
          byId.set(f.id, f);
        }
      }
    } catch {
      // Shared drives the admin can't read are skipped.
    }
  }

  return {
    files: Array.from(byId.values()),
    matched: byId.size,
    truncated,
    scope: 'org',
    usersTotal: users.length,
    usersScanned,
    sharedDrivesScanned,
    durationMs: Date.now() - started,
  };
}
