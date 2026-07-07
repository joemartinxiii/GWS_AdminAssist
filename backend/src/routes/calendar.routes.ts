import { Router, Response } from 'express';
import { authenticateSession, AuthRequest } from '../middleware/auth.middleware';
import { requirePermission, requireAnyAdmin } from '../middleware/permissions.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { calendarService } from '../services/calendar.service';
import { sendApiError } from '../utils/apiError';

const router = Router();

function normalizeCalendarEmail(raw: string): string {
  const trimmed = String(raw || '').trim();
  const direct = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : '';
  if (direct) return direct;

  // Accept UI labels like "Jane Admin (jane@example.com)".
  const parenMatch = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/);
  return parenMatch?.[1] || '';
}

// All routes require authentication
router.use(authenticateSession);

/**
 * GET /api/calendar/:email/calendars
 * List calendars for a user
 */
router.get('/:email/calendars', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendars = await calendarService.listCalendars(
      req.user!.email,
      targetEmail
    );
    res.json(calendars);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to list calendars', 'calendar.calendars.list');
  }
});

/**
 * GET /api/calendar/:calendarId/acl
 * Get calendar ACL
 */
router.get('/:calendarId/acl', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const acl = await calendarService.getCalendarAcl(
      req.user!.email,
      req.params.calendarId
    );
    res.json(acl);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get calendar ACL', 'calendar.acl.get');
  }
});

/**
 * GET /api/calendar/resources
 * List calendar resources
 */
router.get('/resources', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resources = await calendarService.listResources(req.user!.email);
    res.json(resources);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to list resources', 'calendar.resources.list');
  }
});

/**
 * POST /api/calendar/resources
 * Create calendar resource
 */
router.post('/resources', requirePermission('calendar.resources.manage'), auditLog('calendar.resource.create', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const { resourceName, resourceType, capacity, buildingId, floorName } = req.body;

    if (!resourceName || !resourceType) {
      return res.status(400).json({ error: 'Missing required fields: resourceName, resourceType' });
    }

    const resource = await calendarService.createResource(req.user!.email, {
      resourceName,
      resourceType,
      capacity,
      buildingId,
      floorName,
    });

    res.status(201).json(resource);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to create resource', 'calendar.resource.create');
  }
});

/**
 * PATCH /api/calendar/resources/:resourceId
 * Update calendar resource
 */
router.patch('/resources/:resourceId', requirePermission('calendar.resources.manage'), auditLog('calendar.resource.update', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const updates = req.body;
    const resource = await calendarService.updateResource(
      req.user!.email,
      req.params.resourceId,
      updates
    );
    res.json(resource);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to update resource', 'calendar.resource.update');
  }
});

/**
 * DELETE /api/calendar/resources/:resourceId
 * Delete calendar resource
 */
router.delete('/resources/:resourceId', requirePermission('calendar.resources.manage'), auditLog('calendar.resource.delete', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    await calendarService.deleteResource(req.user!.email, req.params.resourceId);
    res.json({ message: 'Resource deleted successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to delete resource', 'calendar.resource.delete');
  }
});

/**
 * GET /api/calendar/:email/events
 * List events for a user's calendar
 */
router.get('/:email/events', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const timeMin = req.query.timeMin as string | undefined;
    const timeMax = req.query.timeMax as string | undefined;
    const maxResults = parseInt(req.query.maxResults as string) || 250;

    const events = await calendarService.listEvents(
      req.user!.email,
      targetEmail,
      calendarId,
      timeMin,
      timeMax,
      maxResults
    );
    res.json(events);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to list events', 'calendar.events.list');
  }
});

/**
 * GET /api/calendar/:email/events/:eventId
 * Get a specific event
 */
router.get('/:email/events/:eventId', requireAnyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const event = await calendarService.getEvent(
      req.user!.email,
      targetEmail,
      calendarId,
      req.params.eventId
    );
    res.json(event);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to get event', 'calendar.event.get');
  }
});

/**
 * PATCH /api/calendar/:email/events/:eventId
 * Update an event
 */
router.patch('/:email/events/:eventId', requirePermission('calendar.resources.manage'), auditLog('calendar.event.update', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const updates = req.body;
    const event = await calendarService.updateEvent(
      req.user!.email,
      targetEmail,
      calendarId,
      req.params.eventId,
      updates
    );
    res.json(event);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to update event', 'calendar.event.update');
  }
});

/**
 * POST /api/calendar/:email/events/:eventId/attendees
 * Add attendees to an event
 */
router.post('/:email/events/:eventId/attendees', requirePermission('calendar.resources.manage'), auditLog('calendar.event.addAttendees', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const { attendees } = req.body;

    if (!attendees || !Array.isArray(attendees)) {
      return res.status(400).json({ error: 'Missing required field: attendees (array)' });
    }

    const event = await calendarService.addAttendees(
      req.user!.email,
      targetEmail,
      calendarId,
      req.params.eventId,
      attendees
    );
    res.json(event);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to add attendees', 'calendar.event.addAttendees');
  }
});

/**
 * POST /api/calendar/:email/events/:eventId/move
 * Move an event to a new time
 */
router.post('/:email/events/:eventId/move', requirePermission('calendar.resources.manage'), auditLog('calendar.event.move', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const { newStart, newEnd, timeZone } = req.body;

    if (!newStart || !newEnd) {
      return res.status(400).json({ error: 'Missing required fields: newStart, newEnd' });
    }

    const event = await calendarService.moveEvent(
      req.user!.email,
      targetEmail,
      calendarId,
      req.params.eventId,
      newStart,
      newEnd,
      timeZone
    );
    res.json(event);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to move event', 'calendar.event.move');
  }
});

/**
 * DELETE /api/calendar/:email/events/:eventId
 * Delete an event
 */
router.delete('/:email/events/:eventId', requirePermission('calendar.resources.manage'), auditLog('calendar.event.delete', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const sendUpdates = (req.query.sendUpdates as 'all' | 'externalOnly' | 'none') || 'all';
    
    await calendarService.deleteEvent(
      req.user!.email,
      targetEmail,
      calendarId,
      req.params.eventId,
      sendUpdates
    );
    res.json({ message: 'Event deleted successfully' });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to delete event', 'calendar.event.delete');
  }
});

/**
 * POST /api/calendar/:email/events
 * Create a new event
 */
router.post('/:email/events', requirePermission('calendar.resources.manage'), auditLog('calendar.event.create', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const targetEmail = normalizeCalendarEmail(req.params.email);
    if (!targetEmail) return res.status(400).json({ error: 'Invalid target email' });

    const calendarId = (req.query.calendarId as string) || 'primary';
    const { summary, description, start, end, attendees, location } = req.body;

    if (!summary || !start || !end) {
      return res.status(400).json({ error: 'Missing required fields: summary, start, end' });
    }

    const event = await calendarService.createEvent(
      req.user!.email,
      targetEmail,
      calendarId,
      {
        summary,
        description,
        start,
        end,
        attendees,
        location,
      }
    );
    res.status(201).json(event);
  } catch (error: any) {
    sendApiError(res, error, 'Failed to create event', 'calendar.event.create');
  }
});

/**
 * POST /api/calendar/:email/events/:eventId/transfer
 * Transfer an event to another user's calendar
 */
router.post('/:email/events/:eventId/transfer', requirePermission('calendar.resources.manage'), auditLog('calendar.event.transfer', 'calendar'), async (req: AuthRequest, res: Response) => {
  try {
    const sourceEmail = normalizeCalendarEmail(req.params.email);
    if (!sourceEmail) return res.status(400).json({ error: 'Invalid source email' });

    const sourceCalendarId = (req.query.calendarId as string) || 'primary';
    const { targetEmail, targetCalendarId, deleteOriginal } = req.body;

    const normalizedTarget = normalizeCalendarEmail(String(targetEmail || ''));
    if (!normalizedTarget) {
      return res.status(400).json({ error: 'Missing or invalid required field: targetEmail' });
    }

    const newEvent = await calendarService.transferEvent(
      req.user!.email,
      sourceEmail,
      normalizedTarget,
      sourceCalendarId,
      targetCalendarId || 'primary',
      req.params.eventId,
      deleteOriginal === true
    );

    res.json({
      message: 'Event transferred successfully',
      event: newEvent,
      deletedOriginal: deleteOriginal === true,
    });
  } catch (error: any) {
    sendApiError(res, error, 'Failed to transfer event', 'calendar.event.transfer');
  }
});

export default router;
