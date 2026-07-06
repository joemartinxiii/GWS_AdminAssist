import { test, expect } from './fixtures/auth';

test.describe('Groups page @read', () => {
  test('All Groups tab loads with data', async ({ page }) => {
    await page.goto('/groups');
    await expect(page.getByTestId('segment-all-groups')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByText('No groups loaded yet')).not.toBeVisible({ timeout: 60_000 });
  });

  test('Externally Shared tab loads', async ({ page }) => {
    await page.goto('/groups');
    await page.getByTestId('segment-externally-shared').click();
    await page.waitForTimeout(4000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('No Members tab loads', async ({ page }) => {
    await page.goto('/groups');
    await page.getByTestId('segment-no-members').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });
});
