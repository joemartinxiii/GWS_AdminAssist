import { liveGet, livePost, livePatch, liveDelete } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';

describe('live calendar API @read', () => {
  it('GET /api/calendar/resources returns resources (requires DWD calendar resource scope)', async () => {
    const res = await liveGet('/api/calendar/resources');
    if (res.status === 403) {
      throw new Error(
        `Calendar resources returned 403: ${res.body.error}. ` +
          'Add https://www.googleapis.com/auth/admin.directory.resource.calendar to DWD in Admin Console, ' +
          'then add the same scope to backend/src/config/google.config.ts SERVICE_ACCOUNT_SCOPES.'
      );
    }
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/calendar/:email/events returns events array', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/calendar/${encodeURIComponent(email)}/events?maxResults=10`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/calendar/:email/calendars lists calendars', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/calendar/${encodeURIComponent(email)}/calendars`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/calendar/:email/events/:eventId returns event when events exist', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const listRes = await liveGet(
      `/api/calendar/${encodeURIComponent(email)}/events?maxResults=1`
    );
    expect(listRes.status).toBe(200);
    if (!Array.isArray(listRes.body) || listRes.body.length === 0) {
      expect(listRes.body).toEqual([]);
      return;
    }
    const eventId = listRes.body[0].id;
    const res = await liveGet(
      `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}?calendarId=primary`
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(eventId);
  });

  it('GET /api/calendar/:calendarId/acl returns ACL for primary calendar', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/calendar/${encodeURIComponent(email)}/acl`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describeMutating('live calendar API @mutating', () => {
  const resourceName = `gws-test-room-${Date.now()}`;

  it('POST → PATCH → DELETE calendar resource, or PATCH existing resource', async () => {
    const listRes = await liveGet('/api/calendar/resources');
    const sample = Array.isArray(listRes.body) ? listRes.body[0] : undefined;
    const resourceType = sample?.resourceType || 'Meeting Room';

    const createRes = await livePost('/api/calendar/resources').send({
      resourceName,
      resourceType,
      capacity: 4,
      buildingId: sample?.buildingId || 'Main',
    });

    if (createRes.status === 201 && createRes.body?.resourceId) {
      const resourceId = createRes.body.resourceId;
      const patchRes = await livePatch(`/api/calendar/resources/${resourceId}`).send({
        resourceName: `${resourceName}-updated`,
      });
      expect(patchRes.status).toBe(200);
      const delRes = await liveDelete(`/api/calendar/resources/${resourceId}`);
      expect([204, 200]).toContain(delRes.status);
      return;
    }

    if (!sample?.resourceId) {
      const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
      const eventsRes = await liveGet(
        `/api/calendar/${encodeURIComponent(email)}/events?maxResults=1`
      );
      let eventId = Array.isArray(eventsRes.body) ? eventsRes.body[0]?.id : undefined;
      let createdEventId: string | undefined;

      if (!eventId) {
        const start = new Date(Date.now() + 86_400_000);
        const end = new Date(start.getTime() + 3_600_000);
        const createEventRes = await livePost(
          `/api/calendar/${encodeURIComponent(email)}/events?calendarId=primary`
        ).send({
          summary: `gws-live-test-${Date.now()}`,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        });
        expect(createEventRes.status).toBeLessThan(300);
        createdEventId = createEventRes.body?.id;
        eventId = createdEventId;
      }

      expect(eventId).toBeTruthy();
      const getRes = await liveGet(
        `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId!)}?calendarId=primary`
      );
      const originalSummary = getRes.body.summary ?? '';
      const patchRes = await livePatch(
        `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId!)}?calendarId=primary`
      ).send({ summary: `${originalSummary} live-test`.trim() });
      expect(patchRes.status).toBe(200);
      await livePatch(
        `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId!)}?calendarId=primary`
      ).send({ summary: originalSummary });
      if (createdEventId) {
        await liveDelete(
          `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId!)}?calendarId=primary`
        );
      }
      return;
    }

    const originalName = sample.resourceName;
    const patchRes = await livePatch(`/api/calendar/resources/${sample.resourceId}`).send({
      resourceName: `${originalName}-live-test`,
    });
    expect(patchRes.status).toBe(200);
    await livePatch(`/api/calendar/resources/${sample.resourceId}`).send({
      resourceName: originalName,
    });
  });

  it('PATCH event summary then reverts when events exist', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const listRes = await liveGet(
      `/api/calendar/${encodeURIComponent(email)}/events?maxResults=1`
    );
    if (!Array.isArray(listRes.body) || listRes.body.length === 0) {
      return;
    }
    const eventId = listRes.body[0].id;
    const getRes = await liveGet(
      `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}?calendarId=primary`
    );
    const originalSummary = getRes.body.summary ?? '';
    const marker = `live-test-${Date.now()}`;

    const patchRes = await livePatch(
      `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}?calendarId=primary`
    ).send({ summary: `${originalSummary} ${marker}`.trim() });
    expect(patchRes.status).toBe(200);

    await livePatch(
      `/api/calendar/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}?calendarId=primary`
    ).send({ summary: originalSummary });
  });
});
