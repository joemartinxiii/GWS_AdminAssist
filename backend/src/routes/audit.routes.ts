import { Router, Response } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { driveService } from '../services/drive.service';
import { userService } from '../services/user.service';
import { groupsService } from '../services/groups.service';
import { auditLogService } from '../services/audit-log.service';
import { hardeningService } from '../services/hardening.service';
import { gmailService } from '../services/gmail.service';
import { sendApiError } from '../utils/apiError';
import { convertToCSV } from '../utils/csv';
import { classifyPermissions } from '../utils/externalSharing';
import { getLatest, getStatus, putStatus, ScanRecord } from '../services/scanStore';
import { triggerScanJob, isScanJobConfigured } from '../services/scanTrigger';
import {
  getLatest as getSecurityAuditLatest,
  putLatest as putSecurityAuditLatest,
  getWaivers as getSecurityAuditWaivers,
  setWaiver as setSecurityAuditWaiver,
  removeWaiver as removeSecurityAuditWaiver,
  mergeWaivers as mergeSecurityAuditWaivers,
  type SecurityAuditReport,
  type WaiversMap,
} from '../services/securityAuditStore';

const router = Router();

// All routes require authentication
router.use(authenticateSession);

// A scan is considered stale (safe to re-trigger) after this long "running".
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

type ScanCategory = 'public' | 'external' | 'all';

function filterRecords(records: ScanRecord[], category: ScanCategory, search?: string): ScanRecord[] {
  let recs = records;
  if (category === 'public') recs = recs.filter((r) => r.exposure === 'public');
  else if (category === 'external') recs = recs.filter((r) => r.exposure === 'external');

  const q = (search || '').trim().toLowerCase();
  if (q) {
    recs = recs.filter((r) =>
      r.file.name.toLowerCase().includes(q) ||
      r.file.owner.toLowerCase().includes(q) ||
      r.file.path.toLowerCase().includes(q) ||
      r.externalDomains.some((d) => d.toLowerCase().includes(q)) ||
      r.externalEmails.some((e) => e.toLowerCase().includes(q)) ||
      r.externalGroups.some((g) => g.toLowerCase().includes(q))
    );
  }
  return recs;
}

function recordToCsvRow(r: ScanRecord): Record<string, string> {
  return {
    'File Name': r.file.name,
    'Owner': r.file.owner,
    'Location': r.file.path,
    'Exposure': r.exposure === 'public' ? 'Public (Anyone with link)' : 'External',
    'Public Access': r.isPublic ? `Yes (${r.publicRoles.join('/') || 'reader'})` : 'No',
    'External Domains': r.externalDomains.join('; '),
    'External Users': r.externalEmails.join('; '),
    'External Groups': r.externalGroups.join('; '),
    'Modified': r.file.modifiedTime,
    'Link': r.file.webViewLink,
  };
}

/**
 * GET /api/audit/external-sharing
 * Cached external-sharing summary (reads the last scan; does not scan live).
 */
router.get('/external-sharing', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const report = await getLatest();
    if (!report) {
      return res.json({ status: 'never-scanned', lastScan: null, counts: { public: 0, external: 0, total: 0 } });
    }

    const uniqueDomains = new Set<string>();
    const uniqueEmails = new Set<string>();
    const filesByDomain: Record<string, number> = {};
    for (const r of report.records) {
      r.externalDomains.forEach((d) => {
        uniqueDomains.add(d);
        filesByDomain[d] = (filesByDomain[d] || 0) + 1;
      });
      r.externalEmails.forEach((e) => uniqueEmails.add(e));
      r.externalGroups.forEach((g) => uniqueEmails.add(g));
    }

    res.json({
      status: report.status,
      lastScan: report.finishedAt || report.startedAt,
      scanId: report.scanId,
      coverage: report.coverage,
      counts: report.counts,
      statistics: {
        totalFiles: report.counts.total,
        uniqueExternalDomains: Array.from(uniqueDomains),
        uniqueExternalEmails: Array.from(uniqueEmails),
        filesByDomain,
        totalUniqueDomains: uniqueDomains.size,
        totalUniqueEmails: uniqueEmails.size,
      },
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to read external sharing report', 'audit.external');
  }
});

/**
 * POST /api/audit/external-scan/run
 * Trigger a new full-org external-sharing scan (async Cloud Run Job).
 */
router.post('/external-scan/run', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!isScanJobConfigured()) {
      return res.status(501).json({
        error:
          'Asynchronous scanning is not configured on this deployment. See docs/DEPLOY.md (SCAN_JOB_NAME / SCAN_BUCKET).',
      });
    }

    const existing = await getStatus();
    if (existing && existing.status === 'running') {
      const age = Date.now() - new Date(existing.startedAt).getTime();
      if (age < STALE_RUNNING_MS) {
        return res.status(409).json({
          error: 'A scan is already running.',
          scanId: existing.scanId,
          startedAt: existing.startedAt,
        });
      }
    }

    const scanId = `scan-${Date.now()}`;
    const triggeredBy = req.user!.email;

    // Publish an immediate "running" status so the UI reflects the trigger
    // before the job container starts writing progress.
    await putStatus({
      scanId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      triggeredBy,
      coverage: { usersTotal: 0, usersDone: 0, sharedDrivesTotal: 0, sharedDrivesDone: 0 },
      counts: { public: 0, external: 0, total: 0 },
    });

    try {
      await triggerScanJob({ scanId, triggeredBy });
    } catch (triggerError: any) {
      // The job never started, so revert the optimistic "running" status —
      // otherwise it stays stuck until the stale window expires and blocks
      // new scans with a 409.
      await putStatus({
        scanId,
        status: 'failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        triggeredBy,
        coverage: { usersTotal: 0, usersDone: 0, sharedDrivesTotal: 0, sharedDrivesDone: 0 },
        counts: { public: 0, external: 0, total: 0 },
        error: triggerError?.message || 'Failed to start scan job',
      }).catch(() => {});
      throw triggerError;
    }

    res.json({ scanId, status: 'running' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to start external-sharing scan', 'audit.external.scan');
  }
});

/**
 * GET /api/audit/external-scan/status
 * Progress + last scan time for the UI to poll.
 */
router.get('/external-scan/status', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const status = await getStatus();
    if (!status) {
      return res.json({ status: 'never-scanned', lastScan: null });
    }
    res.json({ ...status, lastScan: status.finishedAt || status.startedAt });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to read scan status', 'audit.external.status');
  }
});

/**
 * GET /api/audit/external-scan/report?category=public|external|all&search=&page=&pageSize=
 * Server-side filtered + paginated view of the cached report.
 */
router.get('/external-scan/report', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Read both: latest.json holds the records (the last *completed* report),
    // while status.json is the authoritative live progress document. During an
    // in-progress scan these disagree, so surface status/coverage/counts from
    // status.json to avoid flipping the UI from "running" to "completed" and
    // stopping the progress poll on a report/tab refresh.
    const [report, status] = await Promise.all([getLatest(), getStatus()]);
    if (!report && !status) {
      return res.json({
        status: 'never-scanned',
        lastScan: null,
        records: [],
        total: 0,
        page: 1,
        pageSize: 0,
        counts: { public: 0, external: 0, total: 0 },
      });
    }

    const category = (String(req.query.category || 'all').toLowerCase() as ScanCategory);
    const search = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10) || 50));

    const records = report?.records ?? [];
    const filtered = filterRecords(records, category, search);
    const start = (page - 1) * pageSize;
    const pageRecords = filtered.slice(start, start + pageSize);

    // Prefer the live status doc for progress fields; fall back to the report.
    const live = status ?? report!;
    res.json({
      status: live.status,
      lastScan: live.finishedAt || live.startedAt,
      scanId: live.scanId,
      coverage: live.coverage,
      counts: report?.counts ?? live.counts,
      total: filtered.length,
      page,
      pageSize,
      records: pageRecords,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to read scan report', 'audit.external.report');
  }
});

/**
 * GET /api/audit/external-scan/report/export?category=public|external|all&search=
 * Export the (filtered) cached report as CSV.
 */
router.get('/external-scan/report/export', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const report = await getLatest();
    const category = (String(req.query.category || 'all').toLowerCase() as ScanCategory);
    const search = req.query.search as string | undefined;
    const records = report ? filterRecords(report.records, category, search) : [];
    const csv = convertToCSV(records.map(recordToCsvRow));
    const label = category === 'all' ? 'external-sharing' : `external-sharing-${category}`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${label}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export scan report', 'audit.external.export');
  }
});

/**
 * POST /api/audit/external-scan/report/export/drive
 * Export the (filtered) cached report to Google Drive as a CSV.
 */
router.post('/external-scan/report/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const report = await getLatest();
    const category = (String(req.body?.category || 'all').toLowerCase() as ScanCategory);
    const search = req.body?.search as string | undefined;
    const records = report ? filterRecords(report.records, category, search) : [];
    const csv = convertToCSV(records.map(recordToCsvRow));
    const label = category === 'all' ? 'external-sharing' : `external-sharing-${category}`;
    const fileName = `${label}-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'External sharing report exported to Google Drive' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export scan report to Drive', 'audit.external.export');
  }
});

/**
 * POST /api/audit/external-scan/remediate
 * Bulk-remediate selected files: strip public and/or external access.
 * mode: 'public' | 'external' | 'all'
 */
router.post('/external-scan/remediate', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { fileIds, mode } = req.body as { fileIds?: string[]; mode?: 'public' | 'external' | 'all' };
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }
    const remediationMode = mode === 'public' || mode === 'external' ? mode : 'all';
    const result = await driveService.bulkRemoveExternalShares(req.user!.email, fileIds, remediationMode);
    res.json(result);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to remediate external shares', 'audit.external.remediate');
  }
});

/**
 * GET /api/audit/permissions
 * Permission audit report
 */
router.get('/permissions', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { fileId, userEmail } = req.query;

    if (fileId) {
      // Audit specific file
      const file = await driveService.getFile(req.user!.email, fileId as string);
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const classification = classifyPermissions(file.permissions);
      // External collaborators plus any public ("anyone") permissions.
      const externalPermissions = [
        ...classification.externalPermissions,
        ...classification.publicPermissions,
      ];

      res.json({
        file,
        externalPermissions,
        classification: {
          isPublic: classification.isPublic,
          externalDomains: classification.externalDomains,
          externalEmails: classification.externalEmails,
          externalGroups: classification.externalGroups,
        },
        summary: {
          totalPermissions: file.permissions.length,
          externalPermissions: externalPermissions.length,
          internalPermissions: file.permissions.length - externalPermissions.length,
        },
      });
    } else if (userEmail) {
      // Audit user's files
      const reports = await driveService.getFilesSharedWithExternalDomains(
        req.user!.email,
        undefined
      );

      const userFiles = reports.filter(report => 
        report.file.owners.some(owner => owner.emailAddress === userEmail)
      );

      res.json({
        userEmail,
        files: userFiles,
        summary: {
          totalFiles: userFiles.length,
          filesWithExternalSharing: userFiles.length,
        },
      });
    } else {
      return res.status(400).json({ 
        error: 'Missing required query parameter: fileId or userEmail' 
      });
    }
  } catch (error: any) {
    sendApiError(res, error, 'Failed to perform audit', 'audit.permissions');
  }
});

/**
 * GET /api/audit/users
 * User audit report
 */
router.get('/users', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await userService.listUsers(req.user!.email, 1000);
    
    const stats = {
      total: users.length,
      admins: users.filter(u => u.isAdmin).length,
      suspended: users.filter(u => u.suspended).length,
      active: users.filter(u => !u.suspended).length,
      withLastLogin: users.filter(u => u.lastLoginTime).length,
      withoutLastLogin: users.filter(u => !u.lastLoginTime).length,
    };

    res.json({
      users,
      statistics: stats,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to perform audit', 'audit.users');
  }
});

/**
 * GET /api/audit/groups
 * Groups audit report
 */
router.get('/groups', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const groups = await groupsService.listGroups(req.user!.email, 1000);

    const stats = {
      total: groups.length,
      adminCreated: groups.filter(g => g.adminCreated).length,
      withMembers: groups.filter(g => (g.directMembersCount || 0) > 0).length,
      empty: groups.filter(g => (g.directMembersCount || 0) === 0).length,
    };

    res.json({
      groups,
      statistics: stats,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to perform audit', 'audit.groups');
  }
});

/**
 * GET /api/audit/users-without-2fa
 * Get users without 2FA enrolled
 */
router.get('/users-without-2fa', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await userService.listUsers(req.user!.email, 1000);
    
    const usersWithout2FA = users.filter(
      user => !user.isEnrolledIn2Sv && !user.isEnforcedIn2Sv
    );

    const usersEnforcedButNotEnrolled = users.filter(
      user => user.isEnforcedIn2Sv && !user.isEnrolledIn2Sv
    );

    const stats = {
      total: users.length,
      without2FA: usersWithout2FA.length,
      enforcedButNotEnrolled: usersEnforcedButNotEnrolled.length,
      with2FA: users.filter(user => user.isEnrolledIn2Sv).length,
    };

    res.json({
      usersWithout2FA,
      usersEnforcedButNotEnrolled,
      statistics: stats,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to perform audit', 'audit.2fa');
  }
});

/**
 * GET /api/audit/users-without-2fa/export
 * Export users without 2FA to CSV
 */
router.get('/users-without-2fa/export', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await userService.listUsers(req.user!.email, 1000);
    
    const usersWithout2FA = users.filter(
      user => !user.isEnrolledIn2Sv && !user.isEnforcedIn2Sv
    );

    const usersEnforcedButNotEnrolled = users.filter(
      user => user.isEnforcedIn2Sv && !user.isEnrolledIn2Sv
    );

    // Combine both lists for export
    const allUsersToExport = [
      ...usersWithout2FA.map(user => ({
        'Name': user.name.fullName,
        'Email': user.primaryEmail,
        '2FA Status': 'Not Enrolled',
        'Enforced': 'No',
        'Admin': user.isAdmin ? 'Yes' : 'No',
        'Suspended': user.suspended ? 'Yes' : 'No',
        'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
        'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
      })),
      ...usersEnforcedButNotEnrolled.map(user => ({
        'Name': user.name.fullName,
        'Email': user.primaryEmail,
        '2FA Status': 'Not Enrolled',
        'Enforced': 'Yes',
        'Admin': user.isAdmin ? 'Yes' : 'No',
        'Suspended': user.suspended ? 'Yes' : 'No',
        'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
        'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
      })),
    ];

    // Convert to CSV
    const csv = convertToCSV(allUsersToExport);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="users-without-2fa-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export users without 2FA', 'audit.export');
  }
});

/**
 * POST /api/audit/users-without-2fa/export/drive
 * Export users without 2FA to Google Drive
 */
router.post('/users-without-2fa/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await userService.listUsers(req.user!.email, 10000);

    const usersWithout2FA = users.filter(
      user => !user.isEnrolledIn2Sv && !user.isEnforcedIn2Sv
    );

    const usersEnforcedButNotEnrolled = users.filter(
      user => user.isEnforcedIn2Sv && !user.isEnrolledIn2Sv
    );

    const allUsersToExport = [
      ...usersWithout2FA.map(user => ({
        'Name': user.name.fullName,
        'Email': user.primaryEmail,
        '2FA Status': 'Not Enrolled',
        'Enforced': 'No',
        'Admin': user.isAdmin ? 'Yes' : 'No',
        'Suspended': user.suspended ? 'Yes' : 'No',
        'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
        'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
      })),
      ...usersEnforcedButNotEnrolled.map(user => ({
        'Name': user.name.fullName,
        'Email': user.primaryEmail,
        '2FA Status': 'Not Enrolled',
        'Enforced': 'Yes',
        'Admin': user.isAdmin ? 'Yes' : 'No',
        'Suspended': user.suspended ? 'Yes' : 'No',
        'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
        'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
      })),
    ];

    const csv = convertToCSV(allUsersToExport);
    const fileName = `users-without-2fa-${new Date().toISOString().split('T')[0]}.csv`;

    const result = await driveService.uploadFile(
      req.user!.email,
      fileName,
      csv,
      'text/csv',
      req.body.folderId
    );

    res.json({ 
      fileId: result.id, 
      webViewLink: result.webViewLink,
      message: 'Users without 2FA exported to Google Drive successfully'
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export users without 2FA to Google Drive', 'audit.export');
  }
});

/**
 * POST /api/audit/users-without-2fa/export/selected
 * Export selected users without 2FA to CSV
 */
router.post('/users-without-2fa/export/selected', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userEmails } = req.body as { userEmails?: string[] };

    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(400).json({ error: 'userEmails array is required' });
    }

    const users = await userService.listUsers(req.user!.email, 10000);

    const usersWithout2FA = users.filter(
      user => !user.isEnrolledIn2Sv && !user.isEnforcedIn2Sv
    );

    const usersEnforcedButNotEnrolled = users.filter(
      user => user.isEnforcedIn2Sv && !user.isEnrolledIn2Sv
    );

    const emailSet = new Set(userEmails.map(e => e.toLowerCase()));

    const selectedUsers = [
      ...usersWithout2FA,
      ...usersEnforcedButNotEnrolled,
    ].filter(user => emailSet.has((user.primaryEmail || '').toLowerCase()));

    const dataToExport = selectedUsers.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      '2FA Status': 'Not Enrolled',
      'Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Admin': user.isAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const csv = convertToCSV(dataToExport);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="users-without-2fa-selected-${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export selected users without 2FA', 'audit.export');
  }
});

/**
 * POST /api/audit/users-without-2fa/export/selected/drive
 * Export selected users without 2FA to Google Drive
 */
router.post('/users-without-2fa/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userEmails, folderId } = req.body as { userEmails?: string[]; folderId?: string };

    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(400).json({ error: 'userEmails array is required' });
    }

    const users = await userService.listUsers(req.user!.email, 10000);

    const usersWithout2FA = users.filter(
      user => !user.isEnrolledIn2Sv && !user.isEnforcedIn2Sv
    );

    const usersEnforcedButNotEnrolled = users.filter(
      user => user.isEnforcedIn2Sv && !user.isEnrolledIn2Sv
    );

    const emailSet = new Set(userEmails.map(e => e.toLowerCase()));

    const selectedUsers = [
      ...usersWithout2FA,
      ...usersEnforcedButNotEnrolled,
    ].filter(user => emailSet.has((user.primaryEmail || '').toLowerCase()));

    const dataToExport = selectedUsers.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      '2FA Status': 'Not Enrolled',
      'Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Admin': user.isAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const csv = convertToCSV(dataToExport);
    const fileName = `users-without-2fa-selected-${new Date().toISOString().split('T')[0]}.csv`;

    const result = await driveService.uploadFile(
      req.user!.email,
      fileName,
      csv,
      'text/csv',
      folderId
    );

    res.json({
      fileId: result.id,
      webViewLink: result.webViewLink,
      message: 'Selected users without 2FA exported to Google Drive successfully',
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export selected users without 2FA to Google Drive', 'audit.export');
  }
});

/**
 * POST /api/audit/users-without-2fa/notify
 * Send 2FA reminder emails to one or more users
 */
router.post('/users-without-2fa/notify', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userEmails } = req.body as { userEmails?: string[] };

    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(400).json({ error: 'userEmails array is required' });
    }

    const adminEmail = req.user!.email;
    const domain = process.env.WORKSPACE_DOMAIN || adminEmail.split('@')[1] || 'your organization';

    const subject = 'Action Required: Enable Two-Factor Authentication (2FA)';

    const bodyTemplate = (recipientEmail: string) => {
      return (
`Dear user,

This is an important security reminder from your IT team at ${domain}.

Our records show that Two-Factor Authentication (2FA) is not yet enabled on your Google Workspace account (${recipientEmail}). Enabling 2FA helps protect your account and our organization’s data from unauthorized access.

To enable 2-Step Verification on your Google account, please follow the steps in Google’s official guide:
https://support.google.com/accounts/answer/185839

If you need assistance, please contact the IT help desk.

Thank you for helping keep ${domain} secure.

Sincerely,
IT Administration
${domain}`
      );
    };

    let success = 0;
    let failed = 0;
    const results: Array<{ email: string; status: 'success' | 'failed'; error?: string }> = [];

    for (const email of userEmails) {
      try {
        await gmailService.sendEmail(adminEmail, email, subject, bodyTemplate(email), false);
        success += 1;
        results.push({ email, status: 'success' });
      } catch (error: any) {
        console.error(`Error sending 2FA reminder to ${email}:`, error);
        failed += 1;
        results.push({
          email,
          status: 'failed',
          error: error?.message || 'Failed to send email',
        });
      }
    }

    res.json({
      message: `Sent ${success} email(s) successfully${failed ? `, ${failed} failed` : ''}`,
      total: userEmails.length,
      success,
      failed,
      results,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to send 2FA reminder emails', 'audit.2fa');
  }
});

/**
 * GET /api/audit/logs/export
 * Export audit logs to CSV
 */
router.get('/logs/export', requirePermission('audit.export'), async (req: AuthRequest, res: Response) => {
  try {
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
    
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : new Date();
    
    const csv = await auditLogService.exportToCSV({
      userId: req.query.userId as string | undefined,
      action: req.query.action as string | undefined,
      resourceType: req.query.resourceType as string | undefined,
      startDate,
      endDate,
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: error.message || 'Failed to export audit logs' });
  }
});

// ---------------------------------------------------------------------------
// Security Audit (hardening) — cloud last-run + durable waivers
// ---------------------------------------------------------------------------

function buildHardeningPayload(report: SecurityAuditReport | null, waivers: WaiversMap) {
  if (!report) {
    return {
      status: 'never-run' as const,
      ranAt: null,
      triggeredBy: null,
      durationMs: null,
      checks: [] as SecurityAuditReport['checks'],
      statistics: { total: 0, pass: 0, warning: 0, fail: 0, manual: 0, info: 0 },
      policyApi: { available: true },
      waivers,
    };
  }
  return {
    status: 'ready' as const,
    ranAt: report.ranAt,
    triggeredBy: report.triggeredBy,
    durationMs: report.durationMs,
    checks: report.checks,
    statistics: report.statistics,
    policyApi: report.policyApi,
    waivers,
  };
}

function hardeningRowsForExport(report: SecurityAuditReport, waivers: WaiversMap) {
  return report.checks.map((check) => {
    const waiver = waivers[check.id];
    return {
      Category: check.category,
      Name: check.name,
      Description: check.description,
      Severity: (check.severity || 'medium').toUpperCase(),
      Status: check.status.toUpperCase(),
      Waived: waiver ? 'Yes' : 'No',
      'Waive Reason': waiver?.reason || '',
      'Current Value': check.currentValue != null ? String(check.currentValue) : '',
      'Recommended Value': check.recommendedValue != null ? String(check.recommendedValue) : '',
      Rationale: check.rationale || '',
      Recommendation: check.recommendation || '',
      'Admin Console URL': check.adminConsoleUrl || '',
    };
  });
}

/**
 * GET /api/audit/hardening
 * Cached last-run + durable waivers (does not re-evaluate policies).
 * Alias of /hardening/latest for backwards compatibility with live tests / clients.
 */
router.get('/hardening', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [report, waivers] = await Promise.all([getSecurityAuditLatest(), getSecurityAuditWaivers()]);
    res.json(buildHardeningPayload(report, waivers));
  } catch (error: any) {
    sendApiError(res, error, 'Failed to load security audit', 'audit.hardening');
  }
});

/**
 * GET /api/audit/hardening/latest
 * Explicit latest snapshot endpoint (same payload as GET /hardening).
 */
router.get('/hardening/latest', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [report, waivers] = await Promise.all([getSecurityAuditLatest(), getSecurityAuditWaivers()]);
    res.json(buildHardeningPayload(report, waivers));
  } catch (error: any) {
    sendApiError(res, error, 'Failed to load security audit', 'audit.hardening.latest');
  }
});

/**
 * POST /api/audit/hardening/run
 * Sync re-evaluate all checks, persist latest.json, return snapshot + waivers.
 * Super admin only (Policy API requires super-admin subject).
 */
router.post('/hardening/run', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1];
    const started = Date.now();
    const result = await hardeningService.runAllChecks(req.user!.email, domain);
    const report: SecurityAuditReport = {
      ranAt: new Date().toISOString(),
      triggeredBy: req.user!.email,
      durationMs: Date.now() - started,
      checks: result.checks,
      statistics: result.statistics,
      policyApi: result.policyApi,
    };
    await putSecurityAuditLatest(report);
    const waivers = await getSecurityAuditWaivers();
    res.json(buildHardeningPayload(report, waivers));
  } catch (error: any) {
    sendApiError(res, error, 'Failed to run security audit', 'audit.hardening.run');
  }
});

/**
 * GET /api/audit/hardening/waivers
 */
router.get('/hardening/waivers', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const waivers = await getSecurityAuditWaivers();
    res.json({ waivers });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to load waivers', 'audit.hardening.waivers');
  }
});

/**
 * PUT /api/audit/hardening/waivers/:checkId
 * Body: { reason?: string }. Super admin — set/update a durable waiver.
 */
router.put('/hardening/waivers/:checkId', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const checkId = String(req.params.checkId || '').trim();
    if (!checkId) {
      return res.status(400).json({ error: 'checkId is required' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const waivers = await setSecurityAuditWaiver(checkId, reason, req.user!.email);
    res.json({ waivers });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to save waiver', 'audit.hardening.waivers.put');
  }
});

/**
 * DELETE /api/audit/hardening/waivers/:checkId
 * Super admin — remove a durable waiver.
 */
router.delete('/hardening/waivers/:checkId', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const checkId = String(req.params.checkId || '').trim();
    if (!checkId) {
      return res.status(400).json({ error: 'checkId is required' });
    }
    const waivers = await removeSecurityAuditWaiver(checkId);
    res.json({ waivers });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to remove waiver', 'audit.hardening.waivers.delete');
  }
});

/**
 * POST /api/audit/hardening/waivers/import
 * Body: { waivers: { [checkId]: reason } }. Super admin — merge browser-local
 * waivers into org storage without overwriting existing entries.
 */
router.post('/hardening/waivers/import', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const incoming = req.body?.waivers;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'waivers object is required' });
    }
    const normalized: Record<string, string> = {};
    for (const [id, reason] of Object.entries(incoming as Record<string, unknown>)) {
      if (typeof id === 'string' && id) {
        normalized[id] = typeof reason === 'string' ? reason : '';
      }
    }
    const waivers = await mergeSecurityAuditWaivers(normalized, req.user!.email);
    res.json({ waivers, imported: Object.keys(normalized).length });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to import waivers', 'audit.hardening.waivers.import');
  }
});

/**
 * GET /api/audit/hardening/export
 * Export last-run checks to CSV (does not re-run the audit).
 */
router.get('/hardening/export', requireAnyAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [report, waivers] = await Promise.all([getSecurityAuditLatest(), getSecurityAuditWaivers()]);
    if (!report) {
      return res.status(404).json({
        error: 'No security audit has been run yet. Click Run audit first.',
      });
    }
    const csv = convertToCSV(hardeningRowsForExport(report, waivers));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gws-hardening-${report.ranAt.split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export security audit', 'audit.hardening.export');
  }
});

/**
 * POST /api/audit/hardening/export/drive
 * Export last-run checks to Google Drive (does not re-run the audit).
 */
router.post('/hardening/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [report, waivers] = await Promise.all([getSecurityAuditLatest(), getSecurityAuditWaivers()]);
    if (!report) {
      return res.status(404).json({
        error: 'No security audit has been run yet. Click Run audit first.',
      });
    }
    const csv = convertToCSV(hardeningRowsForExport(report, waivers));
    const fileName = `gws-hardening-${report.ranAt.split('T')[0]}.csv`;
    const uploadResult = await driveService.uploadFile(
      req.user!.email,
      fileName,
      csv,
      'text/csv',
      req.body?.folderId
    );
    res.json({
      fileId: uploadResult.id,
      webViewLink: uploadResult.webViewLink,
      message: 'Security audit exported to Google Drive successfully',
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export security audit to Drive', 'audit.hardening.export');
  }
});

export default router;
