import { Router, Response, NextFunction } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { driveService, sharedDriveService } from '../services/drive.service';
import { searchOrgFiles, DriveSearchCriteria } from '../services/driveSearch.service';
import { validateEmail, validateDomain, requireAllowedEmail, getAllowedDomains, isDomainAllowed } from '../utils/validation';
import { convertToCSV, generateExportFilename } from '../utils/csv';
import { sendApiError } from '../utils/apiError';

const router = Router();

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/drive/search
 * Org-wide Drive search. Selective query fanned out across users (and shared
 * drives) via domain-wide delegation, with one-query fast paths when an owner
 * or shared drive is specified. Cost scales with user count, not file count.
 */
router.get('/search', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const criteria: DriveSearchCriteria = {
      text: (req.query.text as string) || (req.query.q as string) || undefined,
      owner: (req.query.owner as string) || undefined,
      driveId: (req.query.driveId as string) || undefined,
      mimeType: (req.query.mimeType as string) || undefined,
      modifiedAfter: (req.query.modifiedAfter as string) || undefined,
      modifiedBefore: (req.query.modifiedBefore as string) || undefined,
      createdAfter: (req.query.createdAfter as string) || undefined,
      createdBefore: (req.query.createdBefore as string) || undefined,
      includeTrashed: req.query.includeTrashed === 'true',
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined,
    };

    const hasCriteria = !!(
      criteria.text ||
      criteria.owner ||
      criteria.driveId ||
      criteria.mimeType ||
      criteria.modifiedAfter ||
      criteria.modifiedBefore ||
      criteria.createdAfter ||
      criteria.createdBefore
    );
    if (!hasCriteria) {
      return res.status(400).json({ error: 'Provide at least one search criterion.' });
    }

    if (criteria.owner) {
      const ownerValidation = validateEmail(criteria.owner);
      if (!ownerValidation.valid) {
        return res.status(400).json({ error: `Invalid owner email: ${ownerValidation.error}` });
      }
    }

    const result = await searchOrgFiles(req.user!.email, criteria);
    res.json(result);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to search Drive', 'drive.search');
  }
});

/**
 * GET /api/drive/files
 * Get all Drive files with optional filtering
 */
router.get('/files', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 10000;
    
    const filter: any = {};
    if (req.query.domain) filter.domain = req.query.domain as string;
    if (req.query.owner) filter.owner = req.query.owner as string;
    if (req.query.mimeType) filter.mimeType = req.query.mimeType as string;
    if (req.query.minSize) filter.minSize = parseInt(req.query.minSize as string);
    if (req.query.maxSize) filter.maxSize = parseInt(req.query.maxSize as string);
    if (req.query.createdAfter) filter.createdAfter = req.query.createdAfter as string;
    if (req.query.createdBefore) filter.createdBefore = req.query.createdBefore as string;
    if (req.query.modifiedAfter) filter.modifiedAfter = req.query.modifiedAfter as string;
    if (req.query.modifiedBefore) filter.modifiedBefore = req.query.modifiedBefore as string;
    if (req.query.pathContains) filter.pathContains = req.query.pathContains as string;
    if (req.query.nameContains) filter.nameContains = req.query.nameContains as string;
    if (req.query.shared !== undefined) filter.shared = req.query.shared === 'true';
    if (req.query.externallyShared !== undefined) filter.externallyShared = req.query.externallyShared === 'true';

    const files = await driveService.getAllFiles(
      req.user!.email,
      Object.keys(filter).length > 0 ? filter : undefined,
      maxResults,
      (processed) => {
        // In a real app, you'd emit this progress via WebSocket or SSE
        console.log(`Files scan progress: ${processed} files processed`);
      }
    );
    res.json(files);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get files', 'drive.files.list');
  }
});

/**
 * GET /api/drive/files/export
 * Export Drive files to CSV with filtering (must be before /files/:fileId so "export" is not treated as fileId)
 */
router.get('/files/export', requireAnyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 10000;

    const filter: any = {};
    if (req.query.domain) filter.domain = req.query.domain as string;
    if (req.query.owner) filter.owner = req.query.owner as string;
    if (req.query.mimeType) filter.mimeType = req.query.mimeType as string;
    if (req.query.minSize) filter.minSize = parseInt(req.query.minSize as string);
    if (req.query.maxSize) filter.maxSize = parseInt(req.query.maxSize as string);
    if (req.query.createdAfter) filter.createdAfter = req.query.createdAfter as string;
    if (req.query.createdBefore) filter.createdBefore = req.query.createdBefore as string;
    if (req.query.modifiedAfter) filter.modifiedAfter = req.query.modifiedAfter as string;
    if (req.query.modifiedBefore) filter.modifiedBefore = req.query.modifiedBefore as string;
    if (req.query.pathContains) filter.pathContains = req.query.pathContains as string;
    if (req.query.nameContains) filter.nameContains = req.query.nameContains as string;
    if (req.query.shared !== undefined) filter.shared = req.query.shared === 'true';
    if (req.query.externallyShared !== undefined) filter.externallyShared = req.query.externallyShared === 'true';

    const files = await driveService.getAllFiles(
      req.user!.email,
      Object.keys(filter).length > 0 ? filter : undefined,
      maxResults
    );

    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const csvData = files.map(file => {
      const { externalDomains, externalEmails } = driveService.classifyExternalSharing(file.permissions, workspaceDomain);
      return {
        'File Name': file.name,
        'File ID': file.id,
        'File Path': file.path || '/My Drive',
        'File Type': file.mimeType,
        'Owner': file.owners.map(o => o.emailAddress).join('; '),
        'Created Date': file.createdTime ? new Date(file.createdTime).toISOString() : '',
        'Modified Date': file.modifiedTime ? new Date(file.modifiedTime).toISOString() : '',
        'Size (bytes)': file.size || '',
        'Shared': file.shared ? 'Yes' : 'No',
        'External Domains': externalDomains.join('; '),
        'External Emails': externalEmails.join('; '),
        'Link': file.webViewLink,
      };
    });

    const csv = convertToCSV(csvData);

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('drive-files', domain);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (error: unknown) {
    console.error('Error exporting files:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * GET /api/drive/export/stream
 * Stream CSV export of all files (for large datasets)
 */
router.get('/export/stream', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 10000;
    const filter: any = {};

    // Parse filters from query params
    if (req.query.domain) filter.domain = req.query.domain;
    if (req.query.owner) filter.owner = req.query.owner;
    if (req.query.mimeType) filter.mimeType = req.query.mimeType;
    if (req.query.minSize) filter.minSize = parseInt(req.query.minSize as string);
    if (req.query.maxSize) filter.maxSize = parseInt(req.query.maxSize as string);
    if (req.query.createdAfter) filter.createdAfter = req.query.createdAfter;
    if (req.query.createdBefore) filter.createdBefore = req.query.createdBefore;
    if (req.query.modifiedAfter) filter.modifiedAfter = req.query.modifiedAfter;
    if (req.query.modifiedBefore) filter.modifiedBefore = req.query.modifiedBefore;
    if (req.query.pathContains) filter.pathContains = req.query.pathContains;
    if (req.query.nameContains) filter.nameContains = req.query.nameContains;
    if (req.query.shared !== undefined) filter.shared = req.query.shared === 'true';
    if (req.query.externallyShared !== undefined) filter.externallyShared = req.query.externallyShared === 'true';

    // Set headers for streaming CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="drive-files-${new Date().toISOString().split('T')[0]}.csv"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Write CSV header
    const headers = [
      'File Name', 'File ID', 'File Path', 'File Type', 'Owner',
      'Created Date', 'Modified Date', 'Size (bytes)', 'Shared',
      'External Domains', 'External Emails', 'Link'
    ];
    res.write(headers.join(',') + '\n');

    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';

    await driveService.streamAllFiles(
      req.user!.email,
      Object.keys(filter).length > 0 ? filter : undefined,
      maxResults,
      (files) => {
        // Process each batch of files
        for (const file of files) {
          const { externalDomains, externalEmails } = driveService.classifyExternalSharing(file.permissions, workspaceDomain);

          const csvRow = [
            `"${(file.name || '').replace(/"/g, '""')}"`,
            file.id,
            `"${(file.path || '/My Drive').replace(/"/g, '""')}"`,
            file.mimeType,
            `"${file.owners.map(o => o.emailAddress).join('; ').replace(/"/g, '""')}"`,
            file.createdTime ? new Date(file.createdTime).toISOString() : '',
            file.modifiedTime ? new Date(file.modifiedTime).toISOString() : '',
            file.size || '',
            file.shared ? 'Yes' : 'No',
            `"${externalDomains.join('; ').replace(/"/g, '""')}"`,
            `"${externalEmails.join('; ').replace(/"/g, '""')}"`,
            file.webViewLink
          ];

          res.write(csvRow.join(',') + '\n');
        }

        // Check if client disconnected
        if (res.destroyed) {
          return false; // Stop processing
        }

        return true; // Continue processing
      }
    );

    res.end();
  } catch (error: any) {
    console.error('Error streaming file export:', error);
    if (!res.headersSent) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to stream file export' });
    }
  }
});

/**
 * GET /api/drive/external-sharing
 * Get files shared with external domains (legacy endpoint)
 */
router.get('/external-sharing', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = req.query.domain as string | undefined;

    const reports = await driveService.getFilesSharedWithExternalDomains(
      req.user!.email,
      domain,
      (processed) => {
        // In a real app, you'd emit this progress via WebSocket or SSE
        console.log(`External sharing scan progress: ${processed} files processed`);
      }
    );
    res.json(reports);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get external sharing', 'drive.externalSharing.list');
  }
});

/**
 * GET /api/drive/files/:fileId
 * Get file details
 */
router.get('/files/:fileId', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const file = await driveService.getFile(req.user!.email, req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get file', 'drive.files.get');
  }
});

/**
 * GET /api/drive/files/:fileId/permissions
 * Get file permissions
 */
router.get('/files/:fileId/permissions', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const permissions = await driveService.getFilePermissions(
      req.user!.email,
      req.params.fileId
    );
    res.json(permissions);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get permissions', 'drive.permissions.list');
  }
});

/**
 * POST /api/drive/files/:fileId/permissions
 * Create file permission
 */
router.post('/files/:fileId/permissions', requirePermission('drive.permissions.manage'), auditLog('drive.permission.create', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, role, emailAddress, domain } = req.body;

    if (!type || !role) {
      return res.status(400).json({ error: 'Missing required fields: type, role' });
    }

    // Validate email for user/group permissions — must be on org allowlist
    if (type === 'user' || type === 'group') {
      if (!emailAddress) {
        return res.status(400).json({ error: 'emailAddress required for user or group type' });
      }
      const emailValidation = requireAllowedEmail(String(emailAddress).trim().toLowerCase());
      if (!emailValidation.valid) {
        return res.status(400).json({ error: emailValidation.error });
      }
    }

    // Validate domain for domain permissions — must be on org allowlist
    if (type === 'domain') {
      if (!domain) {
        return res.status(400).json({ error: 'domain required for domain type' });
      }
      const domainValidation = validateDomain(domain);
      if (!domainValidation.valid) {
        return res.status(400).json({ error: domainValidation.error });
      }

      if (!isDomainAllowed(domain)) {
        return res.status(400).json({
          error: `Cannot share with domain '${domain}'. Allowed domains: ${getAllowedDomains().join(', ') || '(none configured)'}`,
        });
      }
    }

    await driveService.createFilePermission(req.user!.email, req.params.fileId, {
      type,
      role,
      emailAddress,
      domain,
    });

    res.status(201).json({ message: 'Permission created successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to create permission', 'drive.permissions.create');
  }
});

/**
 * PATCH /api/drive/files/:fileId/permissions/:permissionId
 * Update file permission
 */
router.patch('/files/:fileId/permissions/:permissionId', requirePermission('drive.permissions.manage'), auditLog('drive.permission.update', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'Missing required field: role' });
    }

    if (!['reader', 'commenter', 'writer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be reader, commenter, or writer' });
    }

    await driveService.updateFilePermissions(
      req.user!.email,
      req.params.fileId,
      req.params.permissionId,
      role
    );

    res.json({ message: 'Permission updated successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to update permission', 'drive.permissions.update');
  }
});

/**
 * DELETE /api/drive/files/:fileId/permissions/:permissionId
 * Delete file permission
 */
router.delete('/files/:fileId/permissions/:permissionId', requirePermission('drive.permissions.manage'), auditLog('drive.permission.delete', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const driveId = req.query.driveId as string | undefined;
    await driveService.deleteFilePermission(
      req.user!.email,
      req.params.fileId,
      req.params.permissionId,
      driveId
    );
    res.json({ message: 'Permission deleted successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to delete permission', 'drive.permissions.delete');
  }
});

/**
 * DELETE /api/drive/files/:fileId
 * Move a file to Trash (super admin). Recoverable from Drive Trash.
 * Register after more specific /files/:fileId/permissions routes.
 */
router.delete(
  '/files/:fileId',
  requireSuperAdmin,
  auditLog('drive.file.trash', 'drive'),
  async (req: AuthRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      if (!fileId) {
        return res.status(400).json({ error: 'fileId is required' });
      }
      await driveService.trashFile(req.user!.email, fileId);
      res.json({ message: 'File moved to Trash', fileId });
    } catch (error: any) {
      sendApiError(res, error, 'Failed to trash file', 'drive.file.trash');
    }
  }
);

/**
 * POST /api/drive/files/trash
 * Move multiple files to Trash (super admin). Best-effort per file.
 */
router.post(
  '/files/trash',
  requireSuperAdmin,
  auditLog('drive.file.trash.bulk', 'drive'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { fileIds } = req.body as { fileIds?: unknown };
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'fileIds must be a non-empty array of strings' });
      }
      if (!fileIds.every((id) => typeof id === 'string' && id.trim() !== '')) {
        return res.status(400).json({ error: 'Each fileId must be a non-empty string' });
      }
      if (fileIds.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 files per trash request' });
      }
      const result = await driveService.trashFiles(req.user!.email, fileIds as string[]);
      res.json(result);
    } catch (error: any) {
      sendApiError(res, error, 'Failed to trash files', 'drive.file.trash.bulk');
    }
  }
);

/**
 * POST /api/drive/files/export/drive
 * Export Drive files to Google Drive
 */
router.post('/files/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxResults = parseInt(req.body.maxResults as string) || 10000;
    const filter: any = {};
    if (req.body.domain) filter.domain = req.body.domain;
    if (req.body.owner) filter.owner = req.body.owner;
    if (req.body.mimeType) filter.mimeType = req.body.mimeType;
    if (req.body.nameContains) filter.nameContains = req.body.nameContains;
    if (req.body.pathContains) filter.pathContains = req.body.pathContains;
    if (req.body.externallyShared !== undefined) filter.externallyShared = req.body.externallyShared === true;

    const files = await driveService.getAllFiles(
      req.user!.email,
      Object.keys(filter).length > 0 ? filter : undefined,
      maxResults
    );

    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const csvData = files.map(file => {
      const { externalDomains, externalEmails } = driveService.classifyExternalSharing(file.permissions, workspaceDomain);
      return {
        'File Name': file.name,
        'File ID': file.id,
        'File Path': file.path || '/My Drive',
        'File Type': file.mimeType,
        'Owner': file.owners.map(o => o.emailAddress).join('; '),
        'Created Date': file.createdTime ? new Date(file.createdTime).toISOString() : '',
        'Modified Date': file.modifiedTime ? new Date(file.modifiedTime).toISOString() : '',
        'Size (bytes)': file.size || '',
        'Shared': file.shared ? 'Yes' : 'No',
        'External Domains': externalDomains.join('; '),
        'External Emails': externalEmails.join('; '),
        'Link': file.webViewLink,
      };
    });

    const csv = convertToCSV(csvData);
    const fileName = `drive-files-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Drive files exported to Google Drive successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export files to Drive', 'drive.files.exportToDrive');
  }
});

/**
 * POST /api/drive/files/bulk-remove-external-shares
 * Bulk remove external shares from multiple files
 */
router.post('/files/bulk-remove-external-shares', requirePermission('drive.permissions.manage'), auditLog('drive.bulk.removeExternalShares', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const { fileIds, mode } = req.body as { fileIds?: string[]; mode?: 'public' | 'external' | 'all' };

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const remediationMode = mode === 'public' || mode === 'external' ? mode : 'all';
    const result = await driveService.bulkRemoveExternalShares(req.user!.email, fileIds, remediationMode);
    res.json(result);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to remove external shares', 'drive.files.bulkRemoveExternalShares');
  }
});

/**
 * GET /api/drive/external-sharing/export
 * Export externally shared files to CSV (legacy endpoint)
 */
router.get('/external-sharing/export', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = req.query.domain as string | undefined;
    const reports = await driveService.getFilesSharedWithExternalDomains(
      req.user!.email,
      domain
    );

    // Convert to CSV format
    const csvData = reports.map(report => ({
      'File Name': report.file.name,
      'File ID': report.file.id,
      'File Path': report.file.path || '/My Drive',
      'File Type': report.file.mimeType,
      'Owner': report.file.owners.map(o => o.emailAddress).join('; '),
      'Created Date': report.file.createdTime ? new Date(report.file.createdTime).toISOString() : '',
      'Modified Date': report.file.modifiedTime ? new Date(report.file.modifiedTime).toISOString() : '',
      'Size (bytes)': report.file.size || '',
      'External Domains': report.externalDomains.join('; '),
      'External Emails': report.externalEmails.join('; '),
      'Link': report.file.webViewLink,
    }));

    const csv = convertToCSV(csvData);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="external-sharing-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export data', 'drive.externalSharing.export');
  }
});

/**
 * POST /api/drive/external-sharing/export/drive
 * Export external sharing report to Google Drive
 */
router.post('/external-sharing/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = req.body?.domain as string | undefined;
    const reports = await driveService.getFilesSharedWithExternalDomains(req.user!.email, domain);
    const csvData = reports.map(report => ({
      'File Name': report.file.name,
      'File ID': report.file.id,
      'File Path': report.file.path || '/My Drive',
      'File Type': report.file.mimeType,
      'Owner': report.file.owners.map(o => o.emailAddress).join('; '),
      'Created Date': report.file.createdTime ? new Date(report.file.createdTime).toISOString() : '',
      'Modified Date': report.file.modifiedTime ? new Date(report.file.modifiedTime).toISOString() : '',
      'Size (bytes)': report.file.size || '',
      'External Domains': report.externalDomains.join('; '),
      'External Emails': report.externalEmails.join('; '),
      'Link': report.file.webViewLink,
    }));
    const csv = convertToCSV(csvData);
    const fileName = `external-sharing-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'External sharing report exported to Google Drive successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export external sharing to Drive', 'drive.externalSharing.exportToDrive');
  }
});

/**
 * POST /api/drive/files/export/selected/drive
 * Export selected files to Google Drive
 */
router.post('/files/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { fileIds } = req.body as { fileIds?: string[] };
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }
    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const files: any[] = [];
    for (const fileId of fileIds) {
      const file = await driveService.getFile(req.user!.email, fileId);
      if (file) files.push(file);
    }
    const csvData = files.map(file => {
      const { externalDomains, externalEmails } = driveService.classifyExternalSharing(file.permissions || [], workspaceDomain);
      return {
        'File Name': file.name,
        'File ID': file.id,
        'File Path': file.path || '/My Drive',
        'File Type': file.mimeType,
        'Owner': file.owners.map((o: any) => o.emailAddress).join('; '),
        'Created Date': file.createdTime ? new Date(file.createdTime).toISOString() : '',
        'Modified Date': file.modifiedTime ? new Date(file.modifiedTime).toISOString() : '',
        'Size (bytes)': file.size || '',
        'Shared': file.shared ? 'Yes' : 'No',
        'External Domains': externalDomains.join('; '),
        'External Emails': externalEmails.join('; '),
        'Link': file.webViewLink,
      };
    });
    const csv = convertToCSV(csvData);
    const fileName = `drive-files-selected-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Selected files exported to Google Drive successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export selected files to Drive', 'drive.files.exportSelectedToDrive');
  }
});

/**
 * GET /api/drive/shared-drives
 * List all shared drives
 */
router.get('/shared-drives', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const drives = await sharedDriveService.listSharedDrives(req.user!.email);
    res.json(drives);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to list shared drives', 'drive.shared.list');
  }
});

/**
 * GET /api/drive/shared-drives/member-counts
 * Member (permission) count per shared drive. On-demand: fans out a
 * permissions.list per drive server-side (bounded concurrency). Used by the
 * "No members" view, which the fast list endpoint can't answer on its own.
 */
router.get('/shared-drives/member-counts', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const counts = await sharedDriveService.getSharedDriveMemberCounts(req.user!.email);
    res.json({ counts });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to compute shared drive member counts', 'drive.shared.memberCounts');
  }
});

/**
 * POST /api/drive/shared-drives/export/drive
 * Export shared drives list to Google Drive
 */
router.post('/shared-drives/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const drives = await sharedDriveService.listSharedDrives(req.user!.email);
    const csvData = (drives as any[]).map(d => ({
      'Name': d.name,
      'ID': d.id,
      'Created': d.createdTime ? new Date(d.createdTime).toISOString() : '',
      'Status': d.hidden ? 'Hidden' : 'Active',
    }));
    const csv = convertToCSV(csvData);
    const fileName = `shared-drives-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Shared drives exported to Google Drive successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export shared drives to Drive', 'drive.shared.exportToDrive');
  }
});

/**
 * POST /api/drive/shared-drives/export/selected/drive
 * Export selected shared drives to Google Drive
 */
router.post('/shared-drives/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { driveIds } = req.body as { driveIds?: string[] };
    if (!Array.isArray(driveIds) || driveIds.length === 0) {
      return res.status(400).json({ error: 'driveIds array is required' });
    }
    const allDrives = await sharedDriveService.listSharedDrives(req.user!.email);
    const selected = (allDrives as any[]).filter((d: any) => driveIds.includes(d.id));
    const csvData = selected.map((d: any) => ({
      Name: d.name,
      ID: d.id,
      Created: d.createdTime ? new Date(d.createdTime).toISOString() : '',
      Status: d.hidden ? 'Hidden' : 'Active',
    }));
    const csv = convertToCSV(csvData);
    const fileName = `shared-drives-selected-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Selected shared drives exported to Google Drive successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to export selected shared drives to Drive', 'drive.shared.exportSelectedToDrive');
  }
});

/**
 * GET /api/drive/shared-drives/:driveId/permissions
 * Get permissions for a shared drive
 */
router.get('/shared-drives/:driveId/permissions', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const permissions = await sharedDriveService.getSharedDrivePermissions(
      req.user!.email,
      req.params.driveId
    );
    res.json(permissions);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get shared drive permissions', 'drive.shared.permissions.list');
  }
});

/**
 * POST /api/drive/shared-drives/:driveId/permissions
 * Add a user or group to a shared drive
 */
router.post('/shared-drives/:driveId/permissions', requirePermission('drive.permissions.manage'), auditLog('drive.sharedDrive.permission.create', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, role, emailAddress, domain } = req.body;

    if (!type || !role) {
      return res.status(400).json({ error: 'Missing required fields: type, role' });
    }

    if ((type === 'user' || type === 'group') && !emailAddress) {
      return res.status(400).json({ error: 'emailAddress required for user or group type' });
    }

    if (type === 'user' || type === 'group') {
      const emailValidation = requireAllowedEmail(String(emailAddress).trim().toLowerCase());
      if (!emailValidation.valid) {
        return res.status(400).json({ error: emailValidation.error });
      }
    }

    if (type === 'domain') {
      if (!domain) {
        return res.status(400).json({ error: 'domain required for domain type' });
      }
      const domainValidation = validateDomain(domain);
      if (!domainValidation.valid) {
        return res.status(400).json({ error: domainValidation.error });
      }
      if (!isDomainAllowed(domain)) {
        return res.status(400).json({
          error: `Cannot share with domain '${domain}'. Allowed domains: ${getAllowedDomains().join(', ') || '(none configured)'}`,
        });
      }
    }

    const permission = await sharedDriveService.addSharedDrivePermission(
      req.user!.email,
      req.params.driveId,
      {
        type,
        role,
        emailAddress,
        domain,
      }
    );

    res.status(201).json(permission);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to add permission', 'drive.shared.permissions.create');
  }
});

/**
 * DELETE /api/drive/shared-drives/:driveId/permissions/:permissionId
 * Remove a user or group from a shared drive
 */
router.delete('/shared-drives/:driveId/permissions/:permissionId', requirePermission('drive.permissions.manage'), auditLog('drive.sharedDrive.permission.delete', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    await sharedDriveService.removeSharedDrivePermission(
      req.user!.email,
      req.params.driveId,
      req.params.permissionId
    );
    res.json({ message: 'Permission removed successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to remove permission', 'drive.shared.permissions.delete');
  }
});

export default router;
