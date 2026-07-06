import { test, expect } from './fixtures/auth';
import { loadTenantFixtures } from './fixtures/tenant';

test.describe.configure({ mode: 'serial' });

test.describe('Groups page @mutating', () => {
  test('add group member via edit dialog then remove', async ({ page }) => {
    const fixtures = loadTenantFixtures();
    const memberEmail = fixtures.delegateEmail;
    if (!memberEmail) {
      throw new Error('delegateEmail fixture required — run npm run test:e2e:fixtures');
    }

    await page.goto('/groups');
    await expect(page.getByText('No groups loaded yet')).not.toBeVisible({ timeout: 60_000 });

    await page.locator('.edit-action').first().click();
    await page.getByRole('button', { name: 'Add member' }).click();

    const emailInput = page.getByPlaceholder(/Type name\/email/i).last();
    await emailInput.fill(memberEmail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(3000);

    await expect(page.getByText(memberEmail, { exact: false })).toBeVisible({ timeout: 30_000 });

    const memberRow = page.locator('[class*="ListDataRow"]').filter({ hasText: memberEmail }).first();
    await memberRow.locator('[title="Remove member"]').click();
    await page.waitForTimeout(2000);
  });
});
