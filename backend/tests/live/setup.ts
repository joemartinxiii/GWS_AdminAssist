import { requireLiveEnv } from '../helpers/liveAuth';
import { initLiveFixtures } from '../helpers/liveFixtures';

beforeAll(async () => {
  requireLiveEnv();
  await initLiveFixtures();
});

jest.setTimeout(180000);
