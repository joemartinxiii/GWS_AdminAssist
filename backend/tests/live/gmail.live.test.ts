import { liveGet, livePost, liveDelete } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';
import { requireLiveFixture } from '../helpers/liveFixtures';

describe('live gmail API @read', () => {
  it('GET /api/gmail/delegations returns array', async () => {
    const res = await liveGet('/api/gmail/delegations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/gmail/:email/delegations for super admin', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/gmail/${encodeURIComponent(email)}/delegations`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/gmail/signatures/template returns template object', async () => {
    const res = await liveGet('/api/gmail/signatures/template');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('html');
  });

  it('GET /api/gmail/:email/send-as returns send-as aliases', async () => {
    const email = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const res = await liveGet(`/api/gmail/${encodeURIComponent(email)}/send-as`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describeMutating('live gmail API @mutating', () => {
  it('POST /gmail/signatures/template then restores original', async () => {
    const getBefore = await liveGet('/api/gmail/signatures/template');
    expect(getBefore.status).toBe(200);
    const originalHtml = getBefore.body.html ?? '';
    const marker = `<span>e2e-live-test-${Date.now()}</span>`;

    const saveRes = await livePost('/api/gmail/signatures/template').send({
      html: `${originalHtml}${marker}`,
    });
    expect(saveRes.status).toBeLessThan(300);

    const getAfter = await liveGet('/api/gmail/signatures/template');
    expect(String(getAfter.body.html)).toContain(marker);

    await livePost('/api/gmail/signatures/template').send({ html: originalHtml });
  });

  it('POST then DELETE delegation on discovered user', async () => {
    const ownerEmail = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const delegateEmail = requireLiveFixture(
      'delegateEmail',
      'Need at least two active users in the directory (admin + one other).'
    );

    const createRes = await livePost(`/api/gmail/${encodeURIComponent(ownerEmail)}/delegations`).send({
      delegateEmail,
    });

    if (createRes.status === 403) {
      expect(createRes.body.error).toBeTruthy();
      throw new Error(
        `Gmail delegation blocked (403): ${createRes.body.error}. Add gmail.settings.sharing to DWD per SECURITY.md.`
      );
    }

    expect(createRes.status).toBeLessThan(300);

    const delRes = await liveDelete(
      `/api/gmail/${encodeURIComponent(ownerEmail)}/delegations/${encodeURIComponent(delegateEmail)}`
    );
    expect([204, 200, 404]).toContain(delRes.status);
  });
});
