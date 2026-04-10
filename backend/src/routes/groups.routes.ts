import { Router, Response, NextFunction } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { groupsService } from '../services/groups.service';
import { driveService } from '../services/drive.service';
import { validateEmail } from '../utils/validation';
import { convertToCSV, generateExportFilename } from '../utils/csv';

const router = Router();

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/groups
 * List all groups
 */
router.get('/', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 500;
    const groups = await groupsService.listGroups(req.user!.email, maxResults);
    res.json(groups);
  } catch (error: any) {
    console.error('Error listing groups:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list groups' });
  }
});

/**
 * GET /api/groups/with-external-members
 * List groups that have at least one external member
 */
router.get('/with-external-members', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxGroups = parseInt(req.query.maxResults as string) || 500;
    const groups = await groupsService.listGroupsWithExternalMembers(req.user!.email, maxGroups);
    res.json(groups);
  } catch (error: any) {
    console.error('Error listing groups with external members:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list groups with external members' });
  }
});

/**
 * POST /api/groups/export/drive
 * Export all groups to Google Drive
 */
router.post('/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const maxResults = parseInt(req.body.maxResults as string) || 500;
    const groups = await groupsService.listGroups(req.user!.email, maxResults);
    const csvData = groups.map(g => ({
      Name: g.name,
      Email: g.email,
      Description: g.description || '',
      Members: g.directMembersCount ?? 0,
    }));
    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('groups', domain);
    const csv = convertToCSV(csvData);
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Groups exported to Google Drive successfully' });
  } catch (error: unknown) {
    console.error('Error exporting groups to Drive:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * POST /api/groups/export/selected/drive
 * Export selected groups to Google Drive
 */
router.post('/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { groupEmails } = req.body as { groupEmails?: string[] };
    if (!Array.isArray(groupEmails) || groupEmails.length === 0) {
      return res.status(400).json({ error: 'groupEmails array is required' });
    }
    const allGroups = await groupsService.listGroups(req.user!.email, 5000);
    const selected = allGroups.filter(g => groupEmails.includes(g.email));
    const csvData = selected.map(g => ({
      Name: g.name,
      Email: g.email,
      Description: g.description || '',
      Members: g.directMembersCount ?? 0,
    }));
    const domain = process.env.WORKSPACE_DOMAIN || req.user!.email.split('@')[1] || 'workspace';
    const fileName = generateExportFilename('groups-selected', domain);
    const csv = convertToCSV(csvData);
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Selected groups exported to Google Drive successfully' });
  } catch (error: unknown) {
    console.error('Error exporting selected groups to Drive:', error);
    next(error);  // Use global handler for consistent sanitization
  }
});

/**
 * GET /api/groups/:email
 * Get group by email
 */
router.get('/:email', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const group = await groupsService.getGroup(req.user!.email, req.params.email);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json(group);
  } catch (error: any) {
    console.error('Error getting group:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get group' });
  }
});

/**
 * POST /api/groups
 * Create new group
 */
router.post('/', requirePermission('groups.create'), auditLog('group.create', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, name, description } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Missing required fields: email, name' });
    }

    const group = await groupsService.createGroup(req.user!.email, {
      email,
      name,
      description,
    });

    res.status(201).json(group);
  } catch (error: any) {
    console.error('Error creating group:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create group' });
  }
});

/**
 * PATCH /api/groups/:email
 * Update group
 */
router.patch('/:email', requirePermission('groups.update'), auditLog('group.update', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    const updates = req.body;
    const group = await groupsService.updateGroup(req.user!.email, req.params.email, updates);
    res.json(group);
  } catch (error: any) {
    console.error('Error updating group:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update group' });
  }
});

/**
 * DELETE /api/groups/:email
 * Delete group
 */
router.delete('/:email', requirePermission('groups.delete'), auditLog('group.delete', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    await groupsService.deleteGroup(req.user!.email, req.params.email);
    res.json({ message: 'Group deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting group:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete group' });
  }
});

/**
 * GET /api/groups/:email/members
 * List group members
 */
router.get('/:email/members', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const members = await groupsService.listMembers(req.user!.email, req.params.email);
    res.json(members);
  } catch (error: any) {
    console.error('Error listing members:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list members' });
  }
});

/**
 * POST /api/groups/:email/members
 * Add member to group
 */
router.post('/:email/members', requirePermission('groups.update'), auditLog('group.member.create', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    const { memberEmail, role } = req.body;

    // Validate email format
    const emailValidation = validateEmail(memberEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error });
    }

    const member = await groupsService.addMember(
      req.user!.email,
      req.params.email,
      memberEmail,
      role || 'MEMBER'
    );

    res.status(201).json(member);
  } catch (error: any) {
    console.error('Error adding member:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to add member' });
  }
});

/**
 * PATCH /api/groups/:email/members/:memberEmail
 * Update group member role
 */
router.patch('/:email/members/:memberEmail', requirePermission('groups.update'), auditLog('group.member.update', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;

    if (!role || !['OWNER', 'MANAGER', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be OWNER, MANAGER, or MEMBER' });
    }

    const member = await groupsService.updateMember(
      req.user!.email,
      req.params.email,
      req.params.memberEmail,
      role
    );

    res.json(member);
  } catch (error: any) {
    console.error('Error updating member:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update member' });
  }
});

/**
 * DELETE /api/groups/:email/members/:memberEmail
 * Remove member from group
 */
router.delete('/:email/members/:memberEmail', requirePermission('groups.update'), auditLog('group.member.delete', 'group'), async (req: AuthRequest, res: Response) => {
  try {
    await groupsService.removeMember(
      req.user!.email,
      req.params.email,
      req.params.memberEmail
    );
    res.json({ message: 'Member removed successfully' });
  } catch (error: any) {
    console.error('Error removing member:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to remove member' });
  }
});

export default router;
