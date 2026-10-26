import { expect, test } from './fixtures';

test('a shared link restores filters and selection; changes are written back', async ({ page }) => {
  await page.goto('/?sub=CV&open=1&bogus=1&radius=nope');
  await expect(page.getByTestId('filters-badge')).toHaveText(/^\s*2/);
  const listCount = page.locator('#list-heading .count');
  const filtered = await listCount.textContent();

  await page.getByLabel('Search conferences').fill('zzzz-no-match');
  await expect(page).toHaveURL(/[?&]q=zzzz-no-match/);
  await expect(listCount).toHaveText('No');
  await expect(page).toHaveURL(/bogus=1/); // params it does not own are kept

  await page.getByRole('button', { name: /^Clear all/ }).click();
  await expect(page.getByTestId('filters-badge')).toHaveCount(0);
  await expect(page).not.toHaveURL(/sub=|q=|open=/);
  expect(await listCount.textContent()).not.toBe(filtered);
});

test('selection is mirrored to ?c=', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('button.row').first();
  const id = await row.getAttribute('data-conference-id');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`[?&]c=${id}`));
  await page.reload();
  await expect(page.getByTestId('detail')).toBeVisible();
});

test('Topics is a checklist in its tray; Clear empties it', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.chip[data-filter="subject"]').click();
  const tray = page.locator('[data-filter-tray="subject"]');
  await tray.getByRole('checkbox', { name: 'Computer vision' }).check();
  await expect(page).toHaveURL(/[?&]sub=CV/);
  await expect(page.getByTestId('filters-badge')).toHaveText(/^\s*1/);
  await tray.getByRole('button', { name: 'Clear Topics' }).click();
  await expect(tray.getByRole('checkbox', { name: 'Computer vision' })).not.toBeChecked();
  await expect(tray.getByRole('checkbox').first()).toBeFocused();
  await expect(page).not.toHaveURL(/sub=/);
});
