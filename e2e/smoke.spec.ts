import { expect, test } from '@playwright/test';

test('loads the page with the heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'confmaps' })).toBeVisible();
});
