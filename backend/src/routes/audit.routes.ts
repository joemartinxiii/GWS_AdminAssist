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

const router = Router();

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/audit/external-sharing
 * Comprehensive external sharing audit
 */
router.get('/external-sharing', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = req.query.domain as string | undefined;
    const reports = await driveService.getFilesSharedWithExternalDomains(
      req.user!.email,
      domain
    );

    // Aggregate statistics
    const stats = {
      totalFiles: reports.length,
      uniqueExternalDomains: new Set<string>(),
      uniqueExternalEmails: new Set<string>(),
      filesByDomain: {} as Record<string, number>,
    };

    for (const report of reports) {
      report.externalDomains.forEach(domain => {
        stats.uniqueExternalDomains.add(domain);
        stats.filesByDomain[domain] = (stats.filesByDomain[domain] || 0) + 1;
      });
      report.externalEmails.forEach(email => {
        stats.uniqueExternalEmails.add(email);
      });
    }

    res.json({
      reports,
      statistics: {
        totalFiles: stats.totalFiles,
        uniqueExternalDomains: Array.from(stats.uniqueExternalDomains),
        uniqueExternalEmails: Array.from(stats.uniqueExternalEmails),
        filesByDomain: stats.filesByDomain,
        totalUniqueDomains: stats.uniqueExternalDomains.size,
        totalUniqueEmails: stats.uniqueExternalEmails.size,
      },
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to perform audit', 'audit.external');
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

      const externalPermissions = file.permissions.filter(perm => {
        if (perm.type === 'domain') {
          return perm.domain !== process.env.WORKSPACE_DOMAIN;
        }
        if (perm.type === 'user' && perm.emailAddress) {
          const emailDomain = perm.emailAddress.split('@')[1];
          return emailDomain !== process.env.WORKSPACE_DOMAIN;
        }
        return false;
      });

      res.json({
        file,
        externalPermissions,
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

/**
 * GET /api/audit/hardening
 * Google Workspace Hardening checks
 */
router.get('/hardening', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1];
    
    const result = await hardeningService.runAllChecks(req.user!.email, domain);
    
    res.json(result);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to run hardening checks', 'audit.hardening');
  }
});

/**
 * GET /api/audit/hardening/export
 * Export hardening checks to CSV
 */
router.get('/hardening/export', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userDomain = req.user!.email.split('@')[1];
    const domain = process.env.WORKSPACE_DOMAIN || userDomain;
    const result = await hardeningService.runAllChecks(req.user!.email, domain);
    
    // Convert to CSV
    const headers = ['Category', 'Name', 'Description', 'Status', 'Current Value', 'Recommended Value', 'Recommendation', 'Admin Console URL'];
    const rows = result.checks.map(check => [
      check.category,
      check.name,
      check.description,
      check.status.toUpperCase(),
      check.currentValue || '',
      check.recommendedValue || '',
      check.recommendation,
      check.adminConsoleUrl || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        const str = String(cell || '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gws-hardening-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Error exporting hardening checks:', error);
    res.status(500).json({ error: error.message || 'Failed to export hardening checks' });
  }
});

/**
 * POST /api/audit/hardening/export/drive
 * Export hardening checks to Google Drive
 */
router.post('/hardening/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userDomain = req.user!.email.split('@')[1];
    const domain = process.env.WORKSPACE_DOMAIN || userDomain;
    const result = await hardeningService.runAllChecks(req.user!.email, domain);
    const csvData = result.checks.map(check => ({
      'Category': check.category,
      'Name': check.name,
      'Description': check.description,
      'Status': check.status.toUpperCase(),
      'Current Value': check.currentValue || '',
      'Recommended Value': check.recommendedValue || '',
      'Recommendation': check.recommendation,
      'Admin Console URL': check.adminConsoleUrl || '',
    }));
    const csv = convertToCSV(csvData);
    const fileName = `gws-hardening-${new Date().toISOString().split('T')[0]}.csv`;
    const uploadResult = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: uploadResult.id, webViewLink: uploadResult.webViewLink, message: 'Hardening checks exported to Google Drive successfully' });
  } catch (error: any) {
    console.error('Error exporting hardening checks to Drive:', error);
    res.status(500).json({ error: error.message || 'Failed to export hardening checks to Drive' });
  }
});

export default router;
