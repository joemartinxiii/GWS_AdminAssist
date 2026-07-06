import { test, expect } from './fixtures/auth';

test.describe('Shared Drives page @read', () => {
  test('loads shared drives list or empty state', async ({ page }) => {
    await page.goto('/shared-drives');
    await expect(page.getByText('Shared drives').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    const body = page.locator('body');
    const hasDrives = await body.getByRole('button', { name: 'Details' }).count();
    const hasEmpty = await body.getByText('No shared drives found').isVisible().catch(() => false);
    expect(hasDrives > 0 || hasEmpty).toBe(true);
  });
});
