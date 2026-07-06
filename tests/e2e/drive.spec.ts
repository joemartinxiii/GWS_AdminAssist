import { test, expect } from './fixtures/auth';

test.describe('Drive page @read', () => {
  test('External Shares tab loads', async ({ page }) => {
    await page.goto('/drive');
    await page.getByTestId('segment-external-shares').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('body')).not.toContainText('Failed to load', { timeout: 60_000 });
  });

  test('All Files tab loads', async ({ page }) => {
    await page.goto('/drive');
    await page.getByTestId('segment-all-files').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('body')).not.toContainText('Failed to load', { timeout: 60_000 });
  });
});
