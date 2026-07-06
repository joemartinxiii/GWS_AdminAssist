import { test, expect } from './fixtures/auth';
import { loadTenantFixtures } from './fixtures/tenant';

test.describe.configure({ mode: 'serial' });

test.describe('Email Delegation page @mutating', () => {
  test('add delegation via dialog then remove', async ({ page }) => {
    const fixtures = loadTenantFixtures();
    const ownerEmail = process.env.TEST_SUPER_ADMIN_EMAIL!;
    const delegateEmail = fixtures.delegateEmail;
    if (!delegateEmail) {
      throw new Error('delegateEmail fixture required — run npm run test:e2e:fixtures');
    }

    await page.goto('/email-delegation');
    await page.waitForTimeout(3000);

    await page.getByTestId('add-delegation').click();
    await page.getByLabel('User email').fill(ownerEmail);
    await page.getByLabel('Delegate email').fill(delegateEmail);
    await page.getByRole('button', { name: 'Add Delegation' }).click();
    await page.waitForTimeout(3000);

    await expect(page.getByText(delegateEmail, { exact: false })).toBeVisible({ timeout: 30_000 });

    page.once('dialog', (d) => d.accept());
    const row = page.locator('tr').filter({ hasText: delegateEmail }).first();
    await row.getByRole('button').last().click();
    await page.waitForTimeout(2000);
  });
});
