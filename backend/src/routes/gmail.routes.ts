import { Router, Response } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { gmailService } from '../services/gmail.service';
import { driveService } from '../services/drive.service';
import { validateEmail, validateDelegationDomain } from '../utils/validation';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

let DOMPurifyServer: any;

// Lazy initialization to avoid top-level ESM/CJS issues during module load
function getDOMPurify() {
  if (!DOMPurifyServer) {
    const window = new JSDOM('').window;
    DOMPurifyServer = DOMPurify(window);
  }
  return DOMPurifyServer;
}

const router = Router();

function normalizeEmailParam(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

// --- Template persistence ---
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TEMPLATE_FILE = path.join(DATA_DIR, 'signature-template.json');

interface SignatureTemplate {
  html: string;
  updatedAt: string | null;
}

function loadTemplateFromDisk(): SignatureTemplate {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf-8')) as SignatureTemplate;
  } catch {
    return { html: '', updatedAt: null };
  }
}

function saveTemplateToDisk(template: SignatureTemplate): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATE_FILE, JSON.stringify(template, null, 2), 'utf-8');
}

function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const csvRows = [headers.map(h => (h.includes(',') ? `"${h}"` : h)).join(',')];
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      const stringValue = String(value).replace(/"/g, '""');
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/gmail/signatures/template
 * Load the saved domain signature template from disk.
 */
router.get('/signatures/template', requirePermission('gmail.view'), (_req: AuthRequest, res: Response) => {
  res.json(loadTemplateFromDisk());
});

/**
 * POST /api/gmail/signatures/template
 * Persist the domain signature template HTML to disk.
 */
router.post(
  '/signatures/template',
  requirePermission('gmail.sendas.manage'),
  auditLog('gmail.signatures.template', 'gmail'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { html } = req.body as { html?: unknown };
      if (typeof html !== 'string') {
        return res.status(400).json({ error: 'html must be a string' });
      }

      // Sanitize HTML to prevent XSS
      const sanitizedHtml = getDOMPurify().sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'img', 'div', 'span'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'target'],
        ALLOW_DATA_ATTR: false
      });

      // Check if sanitization removed dangerous content
      if (sanitizedHtml !== html) {
        return res.status(400).json({ error: 'HTML contains disallowed content' });
      }

      const template: SignatureTemplate = { html: sanitizedHtml, updatedAt: new Date().toISOString() };
      saveTemplateToDisk(template);
      res.json(template);
    } catch (error: any) {
      console.error('Error saving signature template:', error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to save template' });
    }
  }
);

/**
 * POST /api/gmail/signatures/batch
 * Apply HTML signature to the primary send-as identity for each listed user.
 */
router.post(
  '/signatures/batch',
  requirePermission('gmail.sendas.manage'),
  auditLog('gmail.signatures.batch', 'gmail'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userEmails, signatureHtml } = req.body as { userEmails?: unknown; signatureHtml?: unknown };
      if (!Array.isArray(userEmails) || userEmails.length === 0) {
        return res.status(400).json({ error: 'userEmails must be a non-empty array of strings' });
      }
      if (!userEmails.every((e) => typeof e === 'string' && e.trim() !== '')) {
        return res.status(400).json({ error: 'Each userEmails entry must be a non-empty string' });
      }
      if (typeof signatureHtml !== 'string') {
        return res.status(400).json({ error: 'signatureHtml must be a string' });
      }
      const result = await gmailService.batchSetPrimarySignatures(
        req.user!.email,
        userEmails as string[],
        signatureHtml
      );
      res.json(result);
    } catch (error: any) {
      console.error('Error batch-updating signatures:', error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to apply signatures' });
    }
  }
);

/**
 * GET /api/gmail/:email/delegations
 * Get email delegations for a user
 */
router.get('/:email/delegations', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });
    const delegations = await gmailService.getDelegations(
      req.user!.email,
      targetEmail
    );
    res.json(delegations);
  } catch (error: any) {
    console.error('Error getting delegations:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get delegations' });
  }
});

/**
 * POST /api/gmail/:email/delegations
 * Add email delegation
 */
router.post('/:email/delegations', requirePermission('gmail.delegation.manage'), auditLog('gmail.delegation.create', 'gmail'), async (req: AuthRequest, res: Response) => {
  try {
    const sourceEmail = normalizeEmailParam(req.params.email);
    if (!sourceEmail) return res.status(400).json({ error: 'Invalid source email' });
    const delegateEmail = normalizeEmailParam(String(req.body.delegateEmail || ''));

    // Validate email format
    const emailValidation = validateEmail(delegateEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error });
    }

    // Validate domain restrictions
    const domainValidation = validateDelegationDomain(sourceEmail, delegateEmail);
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }

    await gmailService.addDelegation(
      req.user!.email,
      sourceEmail,
      delegateEmail
    );

    res.status(201).json({ message: 'Delegation added successfully' });
  } catch (error: any) {
    console.error('Error adding delegation:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to add delegation' });
  }
});

/**
 * DELETE /api/gmail/:email/delegations/:delegateEmail
 * Remove email delegation
 */
router.delete('/:email/delegations/:delegateEmail', requirePermission('gmail.delegation.manage'), auditLog('gmail.delegation.delete', 'gmail'), async (req: AuthRequest, res: Response) => {
  try {
    const sourceEmail = normalizeEmailParam(req.params.email);
    const delegateEmail = normalizeEmailParam(req.params.delegateEmail);
    if (!sourceEmail || !delegateEmail) return res.status(400).json({ error: 'Invalid email parameter' });
    await gmailService.removeDelegation(
      req.user!.email,
      sourceEmail,
      delegateEmail
    );
    res.json({ message: 'Delegation removed successfully' });
  } catch (error: any) {
    console.error('Error removing delegation:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to remove delegation' });
  }
});

/**
 * GET /api/gmail/delegations
 * Get all email delegations across all users
 */
router.get('/delegations', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxUsers = parseInt(req.query.maxUsers as string) || 500;
    const delegations = await gmailService.getAllDelegations(req.user!.email, maxUsers);
    res.json(delegations);
  } catch (error: any) {
    console.error('Error getting all delegations:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get delegations' });
  }
});

/**
 * POST /api/gmail/delegations/export/drive
 * Export all delegations to Google Drive
 */
router.post('/delegations/export/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxUsers = parseInt(req.body.maxUsers as string) || 500;
    const delegations = await gmailService.getAllDelegations(req.user!.email, maxUsers);
    const csvData = delegations.map(d => ({
      'User Email': d.userEmail,
      'Delegate Email': d.delegateEmail,
      'Verification Status': d.verificationStatus,
    }));
    const csv = convertToCSV(csvData);
    const fileName = `email-delegations-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body.folderId);
    res.json({
      fileId: result.id,
      webViewLink: result.webViewLink,
      message: 'Delegations exported to Google Drive successfully',
    });
  } catch (error: any) {
    console.error('Error exporting delegations to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export delegations to Drive' });
  }
});

/**
 * POST /api/gmail/delegations/export/selected/drive
 * Export selected delegations to Google Drive
 */
router.post('/delegations/export/selected/drive', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { delegations } = req.body as { delegations?: Array<{ userEmail: string; delegateEmail: string }> };
    if (!Array.isArray(delegations) || delegations.length === 0) {
      return res.status(400).json({ error: 'delegations array is required' });
    }
    const allDelegations = await gmailService.getAllDelegations(req.user!.email, 5000);
    const keySet = new Set(delegations.map(d => `${d.userEmail}|${d.delegateEmail}`));
    const selected = allDelegations.filter(d => keySet.has(`${d.userEmail}|${d.delegateEmail}`));
    const csvData = selected.map(d => ({
      'User Email': d.userEmail,
      'Delegate Email': d.delegateEmail,
      'Verification Status': d.verificationStatus,
    }));
    const csv = convertToCSV(csvData);
    const fileName = `email-delegations-selected-${new Date().toISOString().split('T')[0]}.csv`;
    const result = await driveService.uploadFile(req.user!.email, fileName, csv, 'text/csv', req.body?.folderId);
    res.json({ fileId: result.id, webViewLink: result.webViewLink, message: 'Selected delegations exported to Google Drive successfully' });
  } catch (error: any) {
    console.error('Error exporting selected delegations to Drive:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to export selected delegations to Drive' });
  }
});

/**
 * GET /api/gmail/:email/send-as
 * Get send-as settings for a user
 */
router.get('/:email/send-as', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });
    const sendAsList = await gmailService.getSendAsSettings(
      req.user!.email,
      targetEmail
    );
    res.json(sendAsList);
  } catch (error: any) {
    console.error('Error getting send-as settings:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get send-as settings' });
  }
});

/**
 * POST /api/gmail/:email/send-as
 * Create send-as alias
 */
router.post('/:email/send-as', requirePermission('gmail.sendas.manage'), auditLog('gmail.sendas.create', 'gmail'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });
    const { sendAsEmail, displayName, replyToAddress } = req.body;

    if (!sendAsEmail) {
      return res.status(400).json({ error: 'Missing required field: sendAsEmail' });
    }

    await gmailService.createSendAs(req.user!.email, targetEmail, {
      sendAsEmail,
      displayName,
      replyToAddress,
    });

    res.status(201).json({ message: 'Send-as alias created successfully' });
  } catch (error: any) {
    console.error('Error creating send-as:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create send-as alias' });
  }
});

/**
 * PATCH /api/gmail/:email/send-as/:sendAsEmail
 * Update send-as settings
 */
router.patch('/:email/send-as/:sendAsEmail', requirePermission('gmail.sendas.manage'), auditLog('gmail.sendas.update', 'gmail'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });
    const updates = req.body;
    await gmailService.updateSendAs(
      req.user!.email,
      targetEmail,
      req.params.sendAsEmail,
      updates
    );
    res.json({ message: 'Send-as settings updated successfully' });
  } catch (error: any) {
    console.error('Error updating send-as:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update send-as settings' });
  }
});

/**
 * DELETE /api/gmail/:email/send-as/:sendAsEmail
 * Delete send-as alias
 */
router.delete('/:email/send-as/:sendAsEmail', requirePermission('gmail.sendas.manage'), auditLog('gmail.sendas.delete', 'gmail'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeEmailParam(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });
    await gmailService.deleteSendAs(
      req.user!.email,
      targetEmail,
      req.params.sendAsEmail
    );
    res.json({ message: 'Send-as alias deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting send-as:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete send-as alias' });
  }
});

export default router;
