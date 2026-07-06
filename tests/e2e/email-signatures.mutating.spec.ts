import { test, expect } from './fixtures/auth';

test.describe.configure({ mode: 'serial' });

test.describe('Email Signatures page @mutating', () => {
  test('save template and restore original', async ({ page }) => {
    await page.goto('/email-signatures');
    await expect(page.getByTestId('save-signature-template')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible();
    const original = await editor.inputValue();
    const marker = `<!-- e2e-${Date.now()} -->`;

    await editor.fill(`${original}${marker}`);
    await page.getByTestId('save-signature-template').click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });

    await editor.fill(original);
    await page.getByTestId('save-signature-template').click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });
  });
});
