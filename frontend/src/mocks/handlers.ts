import { http, HttpResponse } from 'msw';
import {
  users,
  orgUnits,
  usersWithout2FAData,
  groups,
  getMockGroupMembers,
  driveFiles,
  externalSharingReports,
  externalSharingStatistics,
  getMockCalendarEvents,
  emailDelegations,
  sharedDrives,
  sharedDrivePermissions,
  hardeningData,
  thirdPartyApps,
  userGroups,
} from './fixtures';

const MOCK_USER = { email: 'admin@example.com', name: 'Mock Admin' };

const ALL_PERMISSIONS = [
  'users.create',
  'users.update',
  'users.delete',
  'users.view',
  'groups.create',
  'groups.update',
  'groups.delete',
  'groups.view',
  'drive.permissions.manage',
  'drive.view',
  'gmail.view',
  'gmail.delegation.manage',
  'gmail.sendas.manage',
  'calendar.resources.manage',
  'calendar.view',
  'audit.view',
  'audit.export',
] as const;

function json(data: Parameters<typeof HttpResponse.json>[0]) {
  return HttpResponse.json(data);
}

/** Drive export / notify mocks */
const mockDriveLink = { id: 'mock-file-id', webViewLink: 'https://drive.google.com/mock' };

export const handlers = [
  http.get('*/api/auth/me', () => json(MOCK_USER)),
  http.get('*/api/auth/permissions', () =>
    json({
      permissions: [...ALL_PERMISSIONS],
      isSuperAdmin: true,
      isDelegatedAdmin: false,
    })
  ),
  http.post('*/api/auth/logout', () => json({ message: 'ok' })),

  http.get('*/api/users/organizational-units', () => json(orgUnits)),
  http.get('*/api/users/export', () => new HttpResponse('Name,Email\nMock,admin@example.com', {
    headers: { 'Content-Type': 'text/csv' },
  })),
  http.get('*/api/users/:email/groups', ({ params }) => {
    const email = decodeURIComponent(params.email as string);
    if (!email) return new HttpResponse(null, { status: 404 });
    return json(userGroups);
  }),
  http.get('*/api/users/:email/third-party-apps', () => json(thirdPartyApps)),
  http.get('*/api/users', () => json(users)),
  http.get('*/api/audit/users-without-2fa', () => json(usersWithout2FAData)),

  http.patch('*/api/users/:email', async () => json({ ok: true })),
  http.delete('*/api/users/:email/third-party-apps/:clientId', () => new HttpResponse(null, { status: 204 })),

  http.post('*/api/users/export/drive', () => json({ ...mockDriveLink, message: 'ok' })),
  http.post('*/api/users/export/selected', () => new HttpResponse('Name,Email\n', { headers: { 'Content-Type': 'text/csv' } })),
  http.post('*/api/users/export/selected/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/users/export/filtered', () => new HttpResponse('Name,Email\n', { headers: { 'Content-Type': 'text/csv' } })),
  http.post('*/api/users/export/filtered/drive', () => json({ ...mockDriveLink })),

  http.get('*/api/groups', () => json(groups)),
  http.get('*/api/groups/with-external-members', () => json(groups.slice(0, 2))),
  http.get('*/api/groups/:email/members', ({ params }) => {
    const email = decodeURIComponent(params.email as string);
    return json(getMockGroupMembers(email));
  }),
  http.delete('*/api/groups/:email', () => new HttpResponse(null, { status: 204 })),
  http.delete('*/api/groups/:groupEmail/members/:memberEmail', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/groups/:email/members', () => json({ ok: true })),
  http.post('*/api/groups/export/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/groups/export/selected/drive', () => json({ ...mockDriveLink })),

  http.get('*/api/drive/files/export', () => new HttpResponse('name,mime\n', { headers: { 'Content-Type': 'text/csv' } })),
  http.get('*/api/drive/external-sharing/export', () => new HttpResponse('csv', { headers: { 'Content-Type': 'text/csv' } })),
  http.get('*/api/drive/files', () => json(driveFiles)),
  http.get('*/api/drive/search', ({ request }) => {
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || '').toLowerCase().trim();
    const ownerEmail = (url.searchParams.get('ownerEmail') || '').toLowerCase().trim();
    const driveId = url.searchParams.get('driveId') || '';
    const matches = driveFiles.filter((f) => {
      if (name && !f.name.toLowerCase().includes(name)) return false;
      if (ownerEmail && !f.owners?.some((o) => o.emailAddress.toLowerCase().includes(ownerEmail))) return false;
      if (driveId && (f as any).driveId !== driveId) return false;
      return true;
    });
    return json({ files: matches, matched: matches.length, truncated: false, scope: 'org', durationMs: 42 });
  }),
  http.get('*/api/drive/files/:fileId', ({ params }) => {
    const f = driveFiles.find((x) => x.id === params.fileId);
    return f ? json(f) : new HttpResponse(null, { status: 404 });
  }),
  http.get('*/api/drive/files/:fileId/permissions', ({ params }) => {
    const f = driveFiles.find((x) => x.id === params.fileId);
    return json(f?.permissions ?? []);
  }),
  http.post('*/api/drive/files/bulk-remove-external-shares', () => json({ removed: 0 })),
  http.patch('*/api/drive/files/:fileId/permissions/:permissionId', () => json({ ok: true })),
  http.delete('*/api/drive/files/:fileId/permissions/:permissionId', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/drive/files/:fileId/permissions', () => json({ id: 'new' })),
  http.post('*/api/drive/files/export/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/drive/files/export/selected/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/drive/external-sharing/export/drive', () => json({ ...mockDriveLink })),

  http.get('*/api/audit/external-sharing', () =>
    json({
      reports: externalSharingReports,
      statistics: {
        ...externalSharingStatistics,
        uniqueExternalDomains: [...externalSharingStatistics.uniqueExternalDomains],
        uniqueExternalEmails: [...externalSharingStatistics.uniqueExternalEmails],
      },
    })
  ),

  http.get('*/api/audit/hardening', () => json(hardeningData)),
  http.get('*/api/audit/hardening/export', () => new HttpResponse('csv', { headers: { 'Content-Type': 'text/csv' } })),
  http.post('*/api/audit/hardening/export/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/audit/users-without-2fa/notify', () => json({ success: 1, failed: 0 })),
  http.post('*/api/audit/users-without-2fa/export/drive', () => json({ ...mockDriveLink })),

  http.get('*/api/gmail/delegations', () => json(emailDelegations)),
  http.post('*/api/gmail/delegations/export/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/gmail/delegations/export/selected/drive', () => json({ ...mockDriveLink })),

  http.get('*/api/gmail/signatures/template', () => json({ html: '', updatedAt: null })),
  http.post('*/api/gmail/signatures/template', async ({ request }) => {
    const body = (await request.json()) as { html?: string };
    return json({ html: body.html ?? '', updatedAt: new Date().toISOString() });
  }),
  http.post('*/api/gmail/signatures/batch', async ({ request }) => {
    const body = (await request.json()) as { userEmails?: string[] };
    const emails = body.userEmails ?? [];
    return json({ succeeded: emails, failed: [] as { email: string; error: string }[] });
  }),

  http.get('*/api/gmail/:email/delegations', () => json([])),
  http.post('*/api/gmail/:email/delegations', () => json({ ok: true })),
  http.delete('*/api/gmail/:userEmail/delegations/:delegateEmail', () => new HttpResponse(null, { status: 204 })),

  http.get('*/api/calendar/:email/events', ({ params }) => {
    const email = decodeURIComponent(params.email as string);
    return json(getMockCalendarEvents(email));
  }),
  http.post('*/api/calendar/:email/events', () => json({ id: 'new-event' })),
  http.patch('*/api/calendar/:email/events/:eventId', () => json({ ok: true })),
  http.delete('*/api/calendar/:email/events/:eventId', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/calendar/:email/events/:eventId/attendees', () => json({ ok: true })),
  http.post('*/api/calendar/:email/events/:eventId/move', () => json({ ok: true })),
  http.post('*/api/calendar/:email/events/:eventId/transfer', () => json({ ok: true })),

  http.get('*/api/drive/shared-drives', () => json(sharedDrives)),
  http.get('*/api/drive/shared-drives/:driveId/permissions', () => json(sharedDrivePermissions)),
  http.post('*/api/drive/shared-drives/:driveId/permissions', () => json({ id: 'p-new' })),
  http.delete('*/api/drive/shared-drives/:driveId/permissions/:permissionId', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/drive/shared-drives/export/drive', () => json({ ...mockDriveLink })),
  http.post('*/api/drive/shared-drives/export/selected/drive', () => json({ ...mockDriveLink })),
];
