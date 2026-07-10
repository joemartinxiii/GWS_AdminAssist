import { Router, Response, NextFunction } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { userService } from '../services/user.service';
import { driveService } from '../services/drive.service';
import { groupsService } from '../services/groups.service';
import { sanitizeText, validateEmail, requireAllowedEmail } from '../utils/validation';
import { convertToCSV, generateExportFilename } from '../utils/csv';
import { normalizeEmailParam } from '../utils/email';
import { sendApiError } from '../utils/apiError';

const router = Router();

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/users
 * List all users
 */
router.get('/', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 500;
    const users = await userService.listUsers(req.user!.email, maxResults);
    res.json(users);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to list users', 'users.list');
  }
});

/**
 * GET /api/users/search
 * Search users
 */
router.get('/search', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    const users = await userService.searchUsers(req.user!.email, query);
    res.json(users);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to search users', 'users.search');
  }
});

/**
 * GET /api/users/organizational-units
 * Get all organizational units
 */
router.get('/organizational-units', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orgUnits = await userService.listOrganizationalUnits(req.user!.email);
    res.json(orgUnits);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get organizational units', 'users.orgUnits');
  }
});

/**
 * GET /api/users/export
 * Export all users to CSV
 */
router.get('/export', requireAnyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 10000;
    const users = await userService.listUsers(req.user!.email, maxResults);

    const csvData = users.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      'Given Name': user.name.givenName,
      'Family Name': user.name.familyName,
      'Admin': user.isAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user.orgUnitPath || '/',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-all', domain);
    const csv = convertToCSV(csvData);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (error: unknown) {
    console.error('Error exporting users:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users/export/drive
 * Export all users to Google Drive
 */
router.post('/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const maxResults = parseInt(req.body.maxResults as string) || 10000;
    const folderId = req.body.folderId as string | undefined;
    const users = await userService.listUsers(req.user!.email, maxResults);

    const csvData = users.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      'Given Name': user.name.givenName,
      'Family Name': user.name.familyName,
      'Admin': user.isAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user.orgUnitPath || '/',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-all', domain);
    const csv = convertToCSV(csvData);
    
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
      message: 'Users exported to Google Drive successfully'
    });
  } catch (error: unknown) {
    console.error('Error exporting users to Drive:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users/export/selected
 * Export selected users to CSV
 */
router.post('/export/selected', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userEmails } = req.body;
    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(400).json({ error: 'userEmails array is required' });
    }

    const users = await Promise.all(
      userEmails.map((email: string) => userService.getUser(req.user!.email, email))
    );
    const validUsers = users.filter(u => u !== null);

    const csvData = validUsers.map(user => ({
      'Name': user!.name.fullName,
      'Email': user!.primaryEmail,
      'Given Name': user!.name.givenName,
      'Family Name': user!.name.familyName,
      'Admin': user!.isAdmin ? 'Yes' : 'No',
      'Suspended': user!.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user!.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user!.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user!.orgUnitPath || '/',
      'Created': user!.creationTime ? new Date(user!.creationTime).toISOString() : '',
      'Last Login': user!.lastLoginTime ? new Date(user!.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-selected', domain);
    const csv = convertToCSV(csvData);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (error: unknown) {
    console.error('Error exporting selected users:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users/export/selected/drive
 * Export selected users to Google Drive
 */
router.post('/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userEmails, folderId } = req.body;
    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(400).json({ error: 'userEmails array is required' });
    }

    const users = await Promise.all(
      userEmails.map((email: string) => userService.getUser(req.user!.email, email))
    );
    const validUsers = users.filter(u => u !== null);

    const csvData = validUsers.map(user => ({
      'Name': user!.name.fullName,
      'Email': user!.primaryEmail,
      'Given Name': user!.name.givenName,
      'Family Name': user!.name.familyName,
      'Admin': user!.isAdmin ? 'Yes' : 'No',
      'Suspended': user!.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user!.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user!.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user!.orgUnitPath || '/',
      'Created': user!.creationTime ? new Date(user!.creationTime).toISOString() : '',
      'Last Login': user!.lastLoginTime ? new Date(user!.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-selected', domain);
    const csv = convertToCSV(csvData);
    
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
      message: 'Selected users exported to Google Drive successfully'
    });
  } catch (error: unknown) {
    console.error('Error exporting selected users to Drive:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users/export/filtered
 * Export filtered users to CSV
 */
router.post('/export/filtered', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filters = req.body.filters || {};
    const maxResults = parseInt(req.body.maxResults as string) || 10000;
    const users = await userService.listUsers(req.user!.email, maxResults);

    // Apply filters (simplified - in production, this should be done server-side)
    let filteredUsers = users;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredUsers = filteredUsers.filter(u => 
        u.name.fullName.toLowerCase().includes(searchLower) ||
        u.primaryEmail.toLowerCase().includes(searchLower)
      );
    }
    if (filters.status === 'active') {
      filteredUsers = filteredUsers.filter(u => !u.suspended);
    } else if (filters.status === 'suspended') {
      filteredUsers = filteredUsers.filter(u => u.suspended);
    }
    if (filters.role === 'admin') {
      filteredUsers = filteredUsers.filter(u => u.isAdmin || u.isDelegatedAdmin);
    } else if (filters.role === 'user') {
      filteredUsers = filteredUsers.filter(u => !u.isAdmin && !u.isDelegatedAdmin);
    }

    const csvData = filteredUsers.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      'Given Name': user.name.givenName,
      'Family Name': user.name.familyName,
      'Admin': user.isAdmin || user.isDelegatedAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user.orgUnitPath || '/',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-filtered', domain);
    const csv = convertToCSV(csvData);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (error: unknown) {
    console.error('Error exporting filtered users:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users/export/filtered/drive
 * Export filtered users to Google Drive
 */
router.post('/export/filtered/drive', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filters = req.body.filters || {};
    const folderId = req.body.folderId as string | undefined;
    const maxResults = parseInt(req.body.maxResults as string) || 10000;
    const users = await userService.listUsers(req.user!.email, maxResults);

    // Apply filters (simplified - in production, this should be done server-side)
    let filteredUsers = users;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredUsers = filteredUsers.filter(u => 
        u.name.fullName.toLowerCase().includes(searchLower) ||
        u.primaryEmail.toLowerCase().includes(searchLower)
      );
    }
    if (filters.status === 'active') {
      filteredUsers = filteredUsers.filter(u => !u.suspended);
    } else if (filters.status === 'suspended') {
      filteredUsers = filteredUsers.filter(u => u.suspended);
    }
    if (filters.role === 'admin') {
      filteredUsers = filteredUsers.filter(u => u.isAdmin || u.isDelegatedAdmin);
    } else if (filters.role === 'user') {
      filteredUsers = filteredUsers.filter(u => !u.isAdmin && !u.isDelegatedAdmin);
    }

    const csvData = filteredUsers.map(user => ({
      'Name': user.name.fullName,
      'Email': user.primaryEmail,
      'Given Name': user.name.givenName,
      'Family Name': user.name.familyName,
      'Admin': user.isAdmin || user.isDelegatedAdmin ? 'Yes' : 'No',
      'Suspended': user.suspended ? 'Yes' : 'No',
      '2FA Enrolled': user.isEnrolledIn2Sv ? 'Yes' : 'No',
      '2FA Enforced': user.isEnforcedIn2Sv ? 'Yes' : 'No',
      'Org Unit Path': user.orgUnitPath || '/',
      'Created': user.creationTime ? new Date(user.creationTime).toISOString() : '',
      'Last Login': user.lastLoginTime ? new Date(user.lastLoginTime).toISOString() : 'Never',
    }));

    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('users-filtered', domain);
    const csv = convertToCSV(csvData);
    
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
      message: 'Filtered users exported to Google Drive successfully'
    });
  } catch (error: unknown) {
    console.error('Error exporting filtered users to Drive:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/users
 * Create new user
 */
router.post('/', requirePermission('users.create'), auditLog('user.create', 'user'), async (req: AuthRequest, res: Response) => {
  try {
    const { primaryEmail, password, givenName, familyName } = req.body;

    if (!primaryEmail || !password || !givenName || !familyName) {
      return res.status(400).json({ 
        error: 'Missing required fields: primaryEmail, password, givenName, familyName' 
      });
    }

    const emailGate = requireAllowedEmail(String(primaryEmail).trim().toLowerCase());
    if (!emailGate.valid) {
      return res.status(400).json({ error: emailGate.error });
    }

    const user = await userService.createUser(req.user!.email, {
      primaryEmail: String(primaryEmail).trim().toLowerCase(),
      password,
      givenName,
      familyName,
    });

    res.status(201).json(user);
  } catch (error: unknown) {
    console.error('Error creating user:', error);
    const appError = error as any; // Temporary for compatibility with existing error shapes
    res.status((appError as any).status || 500).json({ 
      error: 'Failed to create user' // Sanitized; global handler provides more in dev
    });
  }
});

/**
 * GET /api/users/:email/groups
 * Get all groups a user is a member of
 */
router.get('/:email/groups', requirePermission('users.view'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid user email' });
    const groups = await groupsService.getGroupsForUser(req.user!.email, targetEmail);
    res.json(groups);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get user groups', 'users.groups');
  }
});

/**
 * GET /api/users/:email/third-party-apps
 * Get third-party apps for a user
 */
router.get('/:email/third-party-apps', requirePermission('users.view'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid user email' });
    const apps = await userService.getThirdPartyApps(req.user!.email, targetEmail);
    res.json(apps);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get third-party apps', 'users.thirdPartyApps');
  }
});

/**
 * DELETE /api/users/:email/third-party-apps/:clientId
 * Revoke a third-party app for a user
 */
router.delete('/:email/third-party-apps/:clientId', requirePermission('users.update'), auditLog('user.revokeApp', 'user'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid user email' });
    await userService.revokeThirdPartyApp(req.user!.email, targetEmail, req.params.clientId);
    res.json({ message: 'Third-party app revoked successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to revoke third-party app', 'users.revokeApp');
  }
});

/**
 * DELETE /api/users/:email/third-party-apps
 * Revoke all third-party apps for a user
 */
router.delete('/:email/third-party-apps', requirePermission('users.update'), auditLog('user.revokeAllApps', 'user'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid user email' });
    const revokedCount = await userService.revokeAllThirdPartyApps(req.user!.email, targetEmail);
    res.json({ message: `Successfully revoked ${revokedCount} third-party app(s)` });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to revoke third-party apps', 'users.revokeAllApps');
  }
});

/**
 * GET /api/users/:email
 * Get user by email
 */
router.get('/:email', requireAnyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = normalizeEmailParam(req.params.email);
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error || 'Invalid email format' });
    }

    const user = await userService.getUser(req.user!.email, email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: unknown) {
    console.error('Error getting user:', error);
    next(error);  // Let global errorHandler sanitize and log consistently
  }
});

/**
 * PATCH /api/users/:email
 * Update user
 */
router.patch('/:email', requirePermission('users.update'), auditLog('user.update', 'user'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = normalizeEmailParam(req.params.email);
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error || 'Invalid email format' });
    }

    const updates: Record<string, unknown> = {};

    // Sanitize text fields to prevent XSS
    if (req.body.givenName) updates.givenName = sanitizeText(req.body.givenName);
    if (req.body.familyName) updates.familyName = sanitizeText(req.body.familyName);
    if (req.body.department) updates.department = sanitizeText(req.body.department);
    if (req.body.location) updates.location = sanitizeText(req.body.location);
    if (req.body.notes !== undefined) updates.notes = sanitizeText(String(req.body.notes));

    // Phone validation (optional) - fixed regex escapes
    if (req.body.phone) {
      const phoneRegex = /^[+]?[1-9]\d{0,15}$/;
      if (!phoneRegex.test(req.body.phone.replace(/[\s\-()]/g, ''))) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }
      updates.phone = req.body.phone;
    }

    // Copy other fields that don't need sanitization
    if (req.body.suspended !== undefined) updates.suspended = req.body.suspended;
    if (req.body.orgUnitPath) updates.orgUnitPath = req.body.orgUnitPath;

    const user = await userService.updateUser(req.user!.email, email, updates);
    res.json(user);
  } catch (error: unknown) {
    console.error('Error updating user:', error);
    next(error);  // Let global errorHandler sanitize and log consistently
  }
});

/** Never permanently delete these accounts (permanent tenant backups / primary admin). */
function isProtectedUserEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  const fromEnv = (process.env.GWS_PROTECTED_USERS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const defaults = ['joe@befree.wtf', 'backup@befree.wtf'];
  return new Set([...defaults, ...fromEnv]).has(lower);
}

/**
 * DELETE /api/users/:email
 * Permanently delete a user (super admin). Protected accounts are never deleted.
 */
router.delete(
  '/:email',
  requireSuperAdmin,
  requirePermission('users.delete'),
  auditLog('user.delete', 'user'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const email = normalizeEmailParam(req.params.email);
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        return res.status(400).json({ error: emailValidation.error || 'Invalid email format' });
      }
      if (isProtectedUserEmail(email)) {
        return res.status(403).json({
          error: `Refusing to delete protected account ${email}. Suspend instead if needed.`,
        });
      }
      if (email.toLowerCase() === req.user!.email.toLowerCase()) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }
      await userService.deleteUser(req.user!.email, email);
      res.json({ message: 'User deleted successfully', email });
    } catch (error: unknown) {
      console.error('Error deleting user:', error);
      next(error);
    }
  }
);

export default router;
