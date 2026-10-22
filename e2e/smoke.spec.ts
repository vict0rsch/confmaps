import { expect, test } from '@playwright/test';

test('loads the page with the heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'confmaps' })).toBeVisible();
});

test('selecting a conference opens its detail; Esc closes it', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('button.row').first();
  const title = (await row.locator('.title').textContent())!.trim();
  await row.click();
  const detail = page.getByTestId('detail');
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(title);
  await expect(detail.getByRole('link', { name: 'Countdowns on the HF site' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('the privacy page opens from the footer and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Privacy' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Privacy' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('cookieless')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/#privacy/);
});
