import { Router, Response, NextFunction } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { driveService, sharedDriveService } from '../services/drive.service';
import { validateEmail, validateDomain } from '../utils/validation';
import { convertToCSV, generateExportFilename } from '../utils/csv';

const router = Router();

// All routes require authentication
router.use(authenticateSession);

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
    console.error('Error getting files:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get files' });
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

    let totalProcessed = 0;
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

        totalProcessed += files.length;

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
    let progressCallback: ((processed: number) => void) | undefined;

    // For demo purposes, we'll track progress but can't stream it back in this GET request
    // In a real implementation, you'd use WebSockets or Server-Sent Events
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
    console.error('Error getting external sharing:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get external sharing' });
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
    console.error('Error getting file:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get file' });
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
    console.error('Error getting file permissions:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get permissions' });
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

    // Validate email for user permissions
    if (type === 'user') {
      if (!emailAddress) {
        return res.status(400).json({ error: 'emailAddress required for user type' });
      }
      const emailValidation = validateEmail(emailAddress);
      if (!emailValidation.valid) {
        return res.status(400).json({ error: emailValidation.error });
      }
    }

    // Validate domain for domain permissions
    if (type === 'domain') {
      if (!domain) {
        return res.status(400).json({ error: 'domain required for domain type' });
      }
      const domainValidation = validateDomain(domain);
      if (!domainValidation.valid) {
        return res.status(400).json({ error: domainValidation.error });
      }

      // Prevent sharing with external domains
      const allowedDomains = process.env.GWS_ALLOWED_DOMAINS?.split(',').map(d => d.trim()) || [process.env.WORKSPACE_DOMAIN];
      if (!allowedDomains.includes(domain)) {
        return res.status(400).json({
          error: `Cannot share with domain '${domain}'. Allowed domains: ${allowedDomains.join(', ')}`
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
    console.error('Error creating permission:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create permission' });
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
    console.error('Error updating permission:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update permission' });
  }
});

/**
 * DELETE /api/drive/files/:fileId/permissions/:permissionId
 * Delete file permission
 */
router.delete('/files/:fileId/permissions/:permissionId', requirePermission('drive.permissions.manage'), auditLog('drive.permission.delete', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    await driveService.deleteFilePermission(
      req.user!.email,
      req.params.fileId,
      req.params.permissionId
    );
    res.json({ message: 'Permission deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting permission:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete permission' });
  }
});

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
    console.error('Error exporting files to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export files to Drive' });
  }
});

/**
 * POST /api/drive/files/bulk-remove-external-shares
 * Bulk remove external shares from multiple files
 */
router.post('/files/bulk-remove-external-shares', requirePermission('drive.permissions.manage'), auditLog('drive.bulk.removeExternalShares', 'drive'), async (req: AuthRequest, res: Response) => {
  try {
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const result = await driveService.bulkRemoveExternalShares(req.user!.email, fileIds);
    res.json(result);
  } catch (error: any) {
    console.error('Error bulk removing external shares:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to remove external shares' });
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
    console.error('Error exporting external sharing:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export data' });
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
    console.error('Error exporting external sharing to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export external sharing to Drive' });
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
    console.error('Error exporting selected files to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export selected files to Drive' });
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
    console.error('Error listing shared drives:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list shared drives' });
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
    console.error('Error exporting shared drives to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export shared drives to Drive' });
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
    console.error('Error exporting selected shared drives to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export selected shared drives to Drive' });
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
    console.error('Error getting shared drive permissions:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get shared drive permissions' });
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

    if (type === 'domain' && !domain) {
      return res.status(400).json({ error: 'domain required for domain type' });
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
    console.error('Error adding shared drive permission:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to add permission' });
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
    console.error('Error removing shared drive permission:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to remove permission' });
  }
});

export default router;
