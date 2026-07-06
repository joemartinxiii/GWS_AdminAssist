import { test as base, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.resolve(__dirname, '../.auth/session.json');

export const test = base.extend({
  page: async ({ page }, use) => {
    if (!fs.existsSync(authFile)) {
      throw new Error('Missing tests/e2e/.auth/session.json — run: npm run test:e2e:auth');
    }
    await use(page);
  },
});

export { expect };
