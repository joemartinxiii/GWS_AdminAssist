import { liveGet } from '../helpers/liveClient';

describe('live auth API @read', () => {
  it('GET /api/auth/me returns current user', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('GET /api/auth/permissions returns super admin context', async () => {
    const res = await liveGet('/api/auth/permissions');
    expect(res.status).toBe(200);
    expect(res.body.isSuperAdmin).toBe(true);
  });
});
