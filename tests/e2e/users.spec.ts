import { test, expect } from './fixtures/auth';

test.describe('Users page @read', () => {
  test('loads people table with rows', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText('People').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No people loaded yet')).not.toBeVisible({ timeout: 60_000 });
  });

  test('Admins tab loads', async ({ page }) => {
    await page.goto('/users');
    await page.getByTestId('segment-admins').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Failed to load');
  });

  test('Needs 2FA tab loads', async ({ page }) => {
    await page.goto('/users');
    await page.getByTestId('segment-needs-2fa').click();
    await page.waitForTimeout(3000);
    await expect(page.locator('body')).not.toContainText('Failed to load');
  });
});
