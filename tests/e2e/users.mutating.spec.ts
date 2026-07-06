import { test, expect } from './fixtures/auth';

test.describe.configure({ mode: 'serial' });

test.describe('Users page @mutating', () => {
  const marker = `e2e-test-${Date.now()}`;

  test('edit user notes via dialog and revert', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText('No people loaded yet')).not.toBeVisible({ timeout: 60_000 });

    await page.getByTestId('edit-user').first().click();

    const notesField = page.getByLabel('Notes');
    await expect(notesField).toBeVisible({ timeout: 15_000 });
    const original = await notesField.inputValue();
    await notesField.fill(`${original} ${marker}`.trim());

    await page.getByTestId('save-changes').click();
    await page.waitForTimeout(2000);

    await page.getByTestId('edit-user').first().click();
    await expect(page.getByLabel('Notes')).toHaveValue(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    await page.getByLabel('Notes').fill(original);
    await page.getByTestId('save-changes').click();
  });
});
