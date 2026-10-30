import { expect, test } from './fixtures';

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

test("an event's tracks share one list row, and the detail lists them", async ({ page }) => {
  // A fixed window: EMNLP 2026 has left the default "next 12 months".
  await page.goto('/?from=2026-10&to=2026-10');
  const row = page.locator('button.row[data-conference-id="emnlp26"]');
  await expect(row).toContainText('+2 tracks');
  await expect(page.locator('button.row[data-conference-id="emnlp26ind"]')).toHaveCount(0);
  await row.click();
  const tracks = page.getByTestId('detail').getByRole('region', { name: 'Tracks (3)' });
  await tracks.getByRole('button', { name: /Industry Track/ }).click();
  await expect(page.getByTestId('detail').getByRole('heading', { level: 2 })).toHaveText(
    'EMNLP (Industry Track) 2026',
  );
  await expect(row).toHaveAttribute('aria-current', 'true');
});

test('the sidebar collapses to a pill and back, keeping the search', async ({ page }) => {
  await page.goto('/');
  const search = page.getByLabel('Search conferences');
  await search.fill('neurips');
  const hide = page.getByRole('button', { name: 'Hide sidebar' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();

  const show = page.getByRole('button', { name: 'Show sidebar' });
  await expect(show).toBeVisible();
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  // Out of the accessibility tree: no heading, no search field.
  await expect(page.getByRole('heading', { name: 'confmaps' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search conferences' })).toHaveCount(0);

  await show.click();
  await expect(page.getByRole('heading', { name: 'confmaps' })).toBeVisible();
  await expect(hide).toBeFocused();
  await expect(search).toHaveValue('neurips');
  await expect(show).toHaveCount(0);

  // Closing the detail while collapsed: the list is inert, so the pill takes the focus.
  await page.locator('[data-conference-id="neurips26"]').click();
  await hide.click();
  const detail = page.getByTestId('detail');
  await detail.getByRole('button', { name: 'Close details' }).focus();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(show).toBeFocused();
});

test('a tap outside a dialog closes it; a drag that ends outside does not', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Share' }).first().click();
  const share = page.getByTestId('share-dialog');
  const box = (await page.getByLabel('Link to share').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 5 });
  await page.mouse.up();
  await expect(share).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(share).toBeHidden();

  await page.goto('/#privacy');
  const privacy = page.getByRole('dialog', { name: 'Privacy' });
  await expect(privacy).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(privacy).toBeHidden();
  await expect(page).not.toHaveURL(/#privacy/);
});
