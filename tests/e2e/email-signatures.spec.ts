import { test, expect } from './fixtures/auth';

test.describe('Email Signatures page @read', () => {
  test('loads template editor from API', async ({ page }) => {
    await page.goto('/email-signatures');
    await expect(page.getByText('Email Signatures').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('save-signature-template')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Failed to load');
  });
});
