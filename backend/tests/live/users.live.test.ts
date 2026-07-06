import { liveGet, livePatch } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';

describe('live users API @read', () => {
  it('GET /api/users returns a user list', async () => {
    const res = await liveGet('/api/users?maxResults=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('primaryEmail');
      expect(res.body[0]).toHaveProperty('name');
    }
  });

  it('GET /api/users/:email returns a single user', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/users/${encodeURIComponent(email)}`);
    expect(res.status).toBe(200);
    expect(res.body.primaryEmail).toBe(email);
  });

  it('GET /api/users/organizational-units returns OUs', async () => {
    const res = await liveGet('/api/users/organizational-units');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/users/:email/groups returns groups array', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/users/${encodeURIComponent(email)}/groups`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/users/:email/third-party-apps returns apps array', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/users/${encodeURIComponent(email)}/third-party-apps`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/users/export returns CSV', async () => {
    const res = await liveGet('/api/users/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});

describeMutating('live users API @mutating', () => {
  const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
  const notesMarker = `live-test-${Date.now()}`;

  it('PATCH /api/users/:email notes then reverts', async () => {
    const getBefore = await liveGet(`/api/users/${encodeURIComponent(email)}`);
    expect(getBefore.status).toBe(200);
    const originalNotes = getBefore.body.notes ?? '';

    const patchRes = await livePatch(`/api/users/${encodeURIComponent(email)}`).send({
      notes: notesMarker,
    });
    expect(patchRes.status).toBeLessThan(300);
    expect(String(patchRes.body.notes ?? '')).toContain(notesMarker);

    await new Promise((r) => setTimeout(r, 2000));
    const getAfter = await liveGet(`/api/users/${encodeURIComponent(email)}`);
    expect(String(getAfter.body.notes ?? '')).toContain(notesMarker);

    await livePatch(`/api/users/${encodeURIComponent(email)}`).send({ notes: originalNotes });
  });
});
