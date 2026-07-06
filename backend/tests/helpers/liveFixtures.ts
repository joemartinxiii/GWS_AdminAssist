import {
  discoverTenantFixtures,
  requireTenantFixture,
  type TenantFixtures,
} from '../../../tests/helpers/tenantDiscovery';
import { liveGet } from './liveClient';

export type LiveFixtures = TenantFixtures;

let fixtures: LiveFixtures = {};
let initialized = false;

/**
 * Discover stable test targets from the live tenant (env overrides win).
 * Called once per Jest live run from tests/live/setup.ts.
 */
export async function initLiveFixtures(): Promise<LiveFixtures> {
  if (initialized) return fixtures;
  initialized = true;

  fixtures = await discoverTenantFixtures(
    async (path) => {
      const res = await liveGet(path);
      return { status: res.status, body: res.body };
    },
    {
      adminEmail: process.env.TEST_SUPER_ADMIN_EMAIL,
      groupEmail: process.env.TEST_GROUP_EMAIL,
      sharedDriveId: process.env.TEST_SHARED_DRIVE_ID,
      myDriveFileId: process.env.TEST_MY_DRIVE_FILE_ID,
      sharedDriveFileId: process.env.TEST_SHARED_DRIVE_FILE_ID,
      delegateEmail:
        process.env.TEST_DELEGATION_TARGET_EMAIL || process.env.TEST_USER_EMAIL,
    }
  );

  return fixtures;
}

export function getLiveFixtures(): LiveFixtures {
  return fixtures;
}

export function requireLiveFixture(key: keyof LiveFixtures, hint: string): string {
  return requireTenantFixture(fixtures, key, hint);
}
