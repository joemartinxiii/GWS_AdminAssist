import { liveGet, liveDelete, livePost } from '../helpers/liveClient';
import { describeMutating } from '../helpers/liveAuth';
import { getLiveFixtures, requireLiveFixture } from '../helpers/liveFixtures';

describe('live drive API @read', () => {
  it('GET /api/drive/files returns files', async () => {
    const res = await liveGet('/api/drive/files?maxResults=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/audit/external-sharing returns reports', async () => {
    const res = await liveGet('/api/audit/external-sharing?maxResults=5');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reports');
    expect(Array.isArray(res.body.reports)).toBe(true);
  });

  it('GET /api/drive/files/:id returns file with permissions', async () => {
    const fileId = requireLiveFixture(
      'myDriveFileId',
      'Ensure at least one Drive file exists for the test admin.'
    );
    const res = await liveGet(`/api/drive/files/${fileId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fileId);
    expect(Array.isArray(res.body.permissions)).toBe(true);
  });

  it('GET /api/drive/files/:id/permissions returns permissions array', async () => {
    const fileId = requireLiveFixture(
      'myDriveFileId',
      'Ensure at least one Drive file exists for the test admin.'
    );
    const res = await liveGet(`/api/drive/files/${fileId}/permissions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/drive/external-sharing returns sharing reports array', async () => {
    const res = await liveGet('/api/drive/external-sharing?maxResults=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/drive/files/export CSV includes External Emails header', async () => {
    const res = await liveGet('/api/drive/files/export?maxResults=5');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(String(res.text)).toContain('External Emails');
  });
});

describeMutating('live drive API @mutating', () => {
  it('POST then DELETE file permission on my drive file', async () => {
    const fileId = requireLiveFixture(
      'myDriveFileId',
      'Ensure at least one Drive file exists for the test admin.'
    );
    const delegateEmail = requireLiveFixture(
      'delegateEmail',
      'Need at least two active users in the directory.'
    );

    const createRes = await livePost(`/api/drive/files/${fileId}/permissions`).send({
      type: 'user',
      role: 'reader',
      emailAddress: delegateEmail,
    });
    expect(createRes.status).toBe(201);

    const permsRes = await liveGet(`/api/drive/files/${fileId}/permissions`);
    expect(permsRes.status).toBe(200);
    const perm = (permsRes.body as Array<{ id?: string; emailAddress?: string }>).find(
      (p) => p.emailAddress === delegateEmail
    );
    expect(perm?.id).toBeTruthy();

    const delRes = await liveDelete(
      `/api/drive/files/${fileId}/permissions/${perm!.id}`
    );
    expect([204, 200]).toContain(delRes.status);
  });

  it('DELETE permission on shared drive file returns 204 or shaped inherited 403', async () => {
    const fixtures = getLiveFixtures();
    if (!fixtures.sharedDriveFileId) {
      if (fixtures.sharedDriveId) {
        // Shared drives exist but no files — validate drive-level permissions instead
        const res = await liveGet(`/api/drive/shared-drives/${fixtures.sharedDriveId}/permissions`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        return;
      }
      requireLiveFixture(
        'sharedDriveFileId',
        'Create a Shared Drive and add at least one file, or share a drive file externally for discovery.'
      );
    }

    const fileId = fixtures.sharedDriveFileId;
    const driveId = fixtures.sharedDriveId;

    const fileRes = await liveGet(`/api/drive/files/${fileId}`);
    expect(fileRes.status).toBe(200);
    const nonOwner = (fileRes.body.permissions ?? []).find(
      (p: { role?: string; id?: string }) => p.role !== 'owner' && p.id
    );
    expect(nonOwner).toBeTruthy();

    const delRes = await liveDelete(
      `/api/drive/files/${fileId}/permissions/${nonOwner!.id}${driveId ? `?driveId=${driveId}` : ''}`
    );
    expect([204, 403]).toContain(delRes.status);
    if (delRes.status === 403) {
      expect(delRes.body.error).toMatch(/inherited|Shared Drive/i);
    }
  });
});
