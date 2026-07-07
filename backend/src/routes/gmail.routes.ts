import { Router, Response } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin, requireSuperAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { gmailService } from '../services/gmail.service';
import { driveService } from '../services/drive.service';
import { validateEmail, validateDelegationDomain } from '../utils/validation';
import { normalizeEmailParam } from '../utils/email';
import { convertToCSV } from '../utils/csv';
import { sendApiError } from '../utils/apiError';
import { loadSignatureTemplate, saveSignatureTemplate, SignatureTemplate } from '../services/signature-template.service';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

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

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/gmail/signatures/template
 * Load the saved domain signature template.
 */
router.get('/signatures/template', requirePermission('gmail.view'), async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await loadSignatureTemplate());
  } catch (error: any) {
    sendApiError(res, error, 'Failed to load signature template', 'gmail.signatures.template.get');
  }
});

/**
 * POST /api/gmail/signatures/template
 * Persist the domain signature template HTML.
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
      await saveSignatureTemplate(template);
      res.json(template);
    } catch (error: any) {
      sendApiError(res, error, 'Failed to save template', 'gmail.signatures.template.post');
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
      sendApiError(res, error, 'Failed to apply signatures', 'gmail.signatures.batch');
    }
  }
);

/**
 * GET /api/gmail/delegations
 * Get all email delegations across all users.
 * NOTE: static path — registered before parameterized `/:email/...` routes.
 */
router.get('/delegations', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const maxUsers = parseInt(req.query.maxUsers as string) || 500;
    const delegations = await gmailService.getAllDelegations(req.user!.email, maxUsers);
    res.json(delegations);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get delegations', 'gmail.delegations.all');
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
    sendApiError(res, error, 'Failed to export delegations to Drive', 'gmail.delegations.export');
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
    sendApiError(res, error, 'Failed to export selected delegations to Drive', 'gmail.delegations.export.selected');
  }
});

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
    sendApiError(res, error, 'Failed to get delegations', 'gmail.delegations.get');
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
    sendApiError(res, error, 'Failed to add delegation', 'gmail.delegation.create');
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
    sendApiError(res, error, 'Failed to remove delegation', 'gmail.delegation.delete');
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
    sendApiError(res, error, 'Failed to get send-as settings', 'gmail.sendas.get');
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
    sendApiError(res, error, 'Failed to create send-as alias', 'gmail.sendas.create');
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
    sendApiError(res, error, 'Failed to update send-as settings', 'gmail.sendas.update');
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
    sendApiError(res, error, 'Failed to delete send-as alias', 'gmail.sendas.delete');
  }
});

export default router;
