import { liveGet, livePost, liveDelete } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';
import { requireLiveFixture } from '../helpers/liveFixtures';

describe('live shared drives API @read', () => {
  it('GET /api/drive/shared-drives returns drives', async () => {
    const res = await liveGet('/api/drive/shared-drives');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/drive/shared-drives/:id/permissions returns members', async () => {
    const driveId = requireLiveFixture(
      'sharedDriveId',
      'Create at least one Shared Drive in the tenant.'
    );
    const res = await liveGet(`/api/drive/shared-drives/${driveId}/permissions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('role');
    }
  });
});

describeMutating('live shared drives API @mutating', () => {
  it('POST then DELETE shared drive permission', async () => {
    const driveId = requireLiveFixture(
      'sharedDriveId',
      'Create at least one Shared Drive in the tenant.'
    );
    const delegateEmail = requireLiveFixture(
      'delegateEmail',
      'Need at least two active users in the directory.'
    );

    const createRes = await livePost(`/api/drive/shared-drives/${driveId}/permissions`).send({
      type: 'user',
      role: 'reader',
      emailAddress: delegateEmail,
    });
    expect(createRes.status).toBeLessThan(300);
    const permissionId = createRes.body?.id;
    expect(permissionId).toBeTruthy();

    const delRes = await liveDelete(
      `/api/drive/shared-drives/${driveId}/permissions/${permissionId}`
    );
    expect([204, 200]).toContain(delRes.status);
  });
});
