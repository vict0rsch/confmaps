import { expect, test } from '@playwright/test';

test('Play advances the window; pausing stops it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '6 months' }).click();
  const range = page.getByTestId('timeline-range');
  const before = (await range.textContent())!.trim();
  await page.getByRole('button', { name: 'Play timeline' }).click();
  await expect(range).not.toHaveText(before);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = (await range.textContent())!.trim();
  await page.waitForTimeout(600);
  await expect(range).toHaveText(paused);
  // The window is the dates filter: the shared link carries it.
  await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}/);
});

test('history mode opens from a conference detail and lives in the URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.row[data-conference-id="neurips26"]').click();
  await page.getByTestId('detail').getByRole('button', { name: 'View history' }).click();
  await expect(page).toHaveURL(/[?&]h=neurips(&|$)/);
  await expect(page).not.toHaveURL(/[?&]c=/);
  await expect(page.getByTestId('history-meta')).toHaveText(/2 editions/);
  await expect(page.locator('#list-heading .count')).toHaveText('(2)');

  await page.reload();
  await expect(page.getByTestId('history-meta')).toHaveText(/2 editions/);

  await page.getByRole('button', { name: 'Exit history' }).click();
  await expect(page).not.toHaveURL(/[?&]h=/);
  await expect(page.getByTestId('timeline-range')).toBeVisible();
});
