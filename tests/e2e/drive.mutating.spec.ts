import { test, expect } from './fixtures/auth';
import { loadTenantFixtures } from './fixtures/tenant';

test.describe.configure({ mode: 'serial' });

test.describe('Drive page @mutating', () => {
  test('add file permission via modal then remove', async ({ page }) => {
    const fixtures = loadTenantFixtures();
    const delegateEmail = fixtures.delegateEmail;
    if (!delegateEmail) {
      throw new Error('delegateEmail fixture required — run npm run test:e2e:fixtures');
    }

    await page.goto('/drive');
    await page.getByTestId('segment-all-files').click();
    await page.waitForTimeout(8000);

    const manageBtn = page.getByRole('button', { name: 'Manage Permissions' }).first();
    if ((await manageBtn.count()) === 0) {
      throw new Error('No Drive files with Manage Permissions — ensure tenant has files.');
    }
    await manageBtn.click();
    await expect(page.getByText('Manage Permissions')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Add permission' }).click();
    await page.getByPlaceholder(/Type name\/email/i).fill(delegateEmail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(3000);

    await expect(page.getByText(delegateEmail, { exact: false })).toBeVisible({ timeout: 30_000 });

    page.once('dialog', (d) => d.accept());
    const permRow = page.locator('[class*="ListDataRow"]').filter({ hasText: delegateEmail }).first();
    await permRow.getByRole('button').last().click();
    await page.waitForTimeout(2000);

    await page.getByRole('button', { name: 'Done' }).click();
  });
});
