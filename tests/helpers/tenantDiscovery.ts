/** Shared tenant fixture discovery for live Jest tests and Playwright E2E. */

export interface TenantFixtures {
  groupEmail?: string;
  sharedDriveId?: string;
  myDriveFileId?: string;
  sharedDriveFileId?: string;
  delegateEmail?: string;
}

export type TenantApiGet = (path: string) => Promise<{ status: number; body: unknown }>;

export interface TenantDiscoveryEnv {
  adminEmail?: string;
  groupEmail?: string;
  sharedDriveId?: string;
  myDriveFileId?: string;
  sharedDriveFileId?: string;
  delegateEmail?: string;
}

export async function discoverTenantFixtures(
  get: TenantApiGet,
  env: TenantDiscoveryEnv = {}
): Promise<TenantFixtures> {
  const fixtures: TenantFixtures = {
    groupEmail: env.groupEmail?.trim() || undefined,
    sharedDriveId: env.sharedDriveId?.trim() || undefined,
    myDriveFileId: env.myDriveFileId?.trim() || undefined,
    sharedDriveFileId: env.sharedDriveFileId?.trim() || undefined,
    delegateEmail: env.delegateEmail?.trim() || undefined,
  };

  if (!fixtures.groupEmail) {
    const res = await get('/api/groups?maxResults=25');
    if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) {
      fixtures.groupEmail = (res.body[0] as { email?: string }).email;
    }
  }

  if (!fixtures.sharedDriveId) {
    const res = await get('/api/drive/shared-drives');
    if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) {
      fixtures.sharedDriveId = (res.body[0] as { id?: string }).id;
    }
  }

  if (!fixtures.myDriveFileId || !fixtures.sharedDriveFileId) {
    const res = await get('/api/drive/files?maxResults=100');
    if (res.status === 200 && Array.isArray(res.body)) {
      for (const file of res.body as Array<{ id?: string; driveId?: string }>) {
        if (!fixtures.sharedDriveFileId && file.driveId) {
          fixtures.sharedDriveFileId = file.id;
          if (!fixtures.sharedDriveId) fixtures.sharedDriveId = file.driveId;
        }
        if (!fixtures.myDriveFileId && !file.driveId) {
          fixtures.myDriveFileId = file.id;
        }
      }
      if (!fixtures.myDriveFileId && (res.body[0] as { id?: string })?.id) {
        fixtures.myDriveFileId = (res.body[0] as { id?: string }).id;
      }
    }
  }

  if (!fixtures.delegateEmail) {
    const admin = env.adminEmail?.trim();
    const res = await get('/api/users?maxResults=500');
    if (res.status === 200 && Array.isArray(res.body)) {
      const other = (res.body as Array<{ primaryEmail?: string; suspended?: boolean }>).find(
        (u) => u.primaryEmail && u.primaryEmail !== admin && !u.suspended
      );
      if (other?.primaryEmail) fixtures.delegateEmail = other.primaryEmail;
    }
  }

  if (!fixtures.delegateEmail && fixtures.groupEmail) {
    const res = await get(`/api/groups/${encodeURIComponent(fixtures.groupEmail)}/members`);
    if (res.status === 200 && Array.isArray(res.body)) {
      const admin = env.adminEmail?.trim();
      const member = (res.body as Array<{ email?: string; type?: string }>).find(
        (m) => m.email && m.email !== admin && m.type === 'USER'
      );
      if (member?.email) fixtures.delegateEmail = member.email;
    }
  }

  return fixtures;
}

export function requireTenantFixture(
  fixtures: TenantFixtures,
  key: keyof TenantFixtures,
  hint: string
): string {
  const value = fixtures[key];
  if (!value) {
    throw new Error(
      `Tenant fixture "${key}" could not be discovered in your Workspace tenant. ${hint}`
    );
  }
  return value;
}
