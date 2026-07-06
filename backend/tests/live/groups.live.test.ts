import { liveGet, livePost, liveDelete } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';
import { requireLiveFixture } from '../helpers/liveFixtures';

describe('live groups API @read', () => {
  it('GET /api/groups returns groups with member counts', async () => {
    const res = await liveGet('/api/groups?maxResults=50');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('email');
      expect(res.body[0]).toHaveProperty('directMembersCount');
    }
  });

  it('GET /api/groups/with-external-members returns array (Externally Shared tab)', async () => {
    const res = await liveGet('/api/groups/with-external-members?maxResults=50');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('all-groups includes directMembersCount for No Members tab filter', async () => {
    const res = await liveGet('/api/groups?maxResults=500');
    expect(res.status).toBe(200);
    expect(res.body.every((g: { directMembersCount?: unknown }) => 'directMembersCount' in g)).toBe(true);
  });

  it('GET /api/groups/:email/members returns member list', async () => {
    const groupEmail = requireLiveFixture(
      'groupEmail',
      'Create at least one Google Group in the tenant.'
    );
    const res = await liveGet(`/api/groups/${encodeURIComponent(groupEmail)}/members`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/groups/:email returns single group', async () => {
    const groupEmail = requireLiveFixture(
      'groupEmail',
      'Create at least one Google Group in the tenant.'
    );
    const res = await liveGet(`/api/groups/${encodeURIComponent(groupEmail)}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(groupEmail);
  });
});

describeMutating('live groups API @mutating', () => {
  it('POST then DELETE group member', async () => {
    const groupEmail = requireLiveFixture(
      'groupEmail',
      'Create at least one Google Group in the tenant.'
    );
    const memberEmail = requireLiveFixture(
      'delegateEmail',
      'Need at least two active users in the directory.'
    );

    const addRes = await livePost(`/api/groups/${encodeURIComponent(groupEmail)}/members`).send({
      memberEmail,
      role: 'MEMBER',
    });
    expect([200, 201, 409]).toContain(addRes.status);

    const delRes = await liveDelete(
      `/api/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberEmail)}`
    );
    expect([204, 200, 404]).toContain(delRes.status);
  });
});
