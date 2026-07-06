import { test, expect } from './fixtures/auth';

test.describe('Security Audit page @read', () => {
  test('loads hardening overview', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByText('Security audit').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('of tracked checklist items pass automated verification', { exact: false })
    ).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('segment-overview')).toBeVisible();
  });
});
