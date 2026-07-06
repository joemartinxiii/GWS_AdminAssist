import { test, expect } from './fixtures/auth';

test.describe('Email Delegation page @read', () => {
  test('loads delegation list or empty state', async ({ page }) => {
    await page.goto('/email-delegation');
    await expect(page.getByText('Email delegation').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const body = page.locator('body');
    const hasAdd = await page.getByTestId('add-delegation').isVisible();
    expect(hasAdd).toBe(true);
    const hasRows = (await body.locator('table tbody tr').count()) > 0;
    const hasEmpty = await body.getByText('No delegations found').isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });
});
