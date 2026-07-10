import { test, expect } from './fixtures/auth';

test.describe('Security Audit page @read', () => {
  test('loads hardening overview', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByText('Security audit').first()).toBeVisible({ timeout: 30_000 });
    // Either last-run score strip or empty state until first Run
    await expect(
      page
        .getByText('of graded checks pass automated verification', { exact: false })
        .or(page.getByText('No security audit on file', { exact: false }))
        .or(page.getByText('Not run yet', { exact: false }))
    ).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('segment-overview')).toBeVisible();
  });
});
