import { test, expect } from './fixtures/auth';

test.describe('Calendar page @read', () => {
  test('loads calendar with user picker', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByPlaceholder('Search user…')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    await expect(page.getByText('Calendar').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Failed to load');
  });
});
