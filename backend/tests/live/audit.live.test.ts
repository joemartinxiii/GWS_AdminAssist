import { liveGet } from '../helpers/liveClient';
import { requireLiveFixture } from '../helpers/liveFixtures';

describe('live audit API @read', () => {
  it('GET /api/audit/hardening returns latest snapshot payload', async () => {
    const res = await liveGet('/api/audit/hardening');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checks');
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('waivers');
    // never-run is valid when no audit has been executed on this deployment yet
    expect(['never-run', 'ready']).toContain(res.body.status);
  });

  it('GET /api/audit/users-without-2fa returns audit data', async () => {
    const res = await liveGet('/api/audit/users-without-2fa');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('usersWithout2FA');
    expect(Array.isArray(res.body.usersWithout2FA)).toBe(true);
  });

  it('GET /api/audit/permissions returns audit for a file', async () => {
    const fileId = requireLiveFixture(
      'myDriveFileId',
      'Ensure at least one Drive file exists for the test admin.'
    );
    const res = await liveGet(`/api/audit/permissions?fileId=${encodeURIComponent(fileId)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('file');
    expect(res.body).toHaveProperty('summary');
  });

  it('GET /api/audit/users returns users and statistics', async () => {
    const res = await liveGet('/api/audit/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body).toHaveProperty('statistics');
  });

  it('GET /api/audit/groups returns groups and statistics', async () => {
    const res = await liveGet('/api/audit/groups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body).toHaveProperty('statistics');
  });
});
