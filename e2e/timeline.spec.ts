import { expect, test } from './fixtures';

test('Play advances the window; pausing stops it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Next 6 months' }).click();
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

test('"Since <year>" and the axis start follow the filters', async ({ page }) => {
  await page.goto('/');
  const timeline = page.getByTestId('timeline');
  const since = timeline.getByRole('button', { name: /^Since \d{4}$/ });
  const allFrom = Number((await since.textContent())!.match(/\d{4}/)![0]);
  expect(allFrom).toBeLessThan(2013);
  await since.click();
  const firstYear = async () =>
    Math.min(...(await timeline.locator('.axis .tick.year').allTextContents()).map(Number));
  await expect.poll(firstYear).toBeLessThan(2013);

  // ICLR started in 2013: the axis (grown back to the first event) shrinks to it.
  await page.getByLabel('Search conferences').fill('iclr');
  await expect(since).toHaveAccessibleName('Since 2013');
  await expect(since).toHaveAttribute('aria-pressed', 'false');
  await since.click();
  await expect(since).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[?&]from=2013-05-02/);
  await expect.poll(firstYear).toBeGreaterThanOrEqual(2013);
  await expect.poll(firstYear).toBeLessThanOrEqual(2015);
});

test('history mode opens from a conference detail and lives in the URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.row[data-conference-id="neurips26"]').click();
  await page.getByTestId('detail').getByRole('button', { name: 'View history' }).click();
  await expect(page).toHaveURL(/[?&]h=neurips(&|$)/);
  await expect(page).not.toHaveURL(/[?&]c=/);
  // One list row per edition (the count depends on how far back the data goes).
  const meta = page.getByTestId('history-meta');
  await expect(meta).toHaveText(/^\d+ editions/);
  const editions = (await meta.textContent())!.match(/\d+/)![0];
  await expect(page.locator('#list-heading .count')).toHaveText(`${editions}`);

  await page.reload();
  await expect(meta).toHaveText(new RegExp(`^${editions} editions`));

  await page.getByRole('button', { name: 'Exit history' }).click();
  await expect(page).not.toHaveURL(/[?&]h=/);
  await expect(page.getByTestId('timeline-range')).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Play is in view on first load and the timeline scrubs without dragging the sheet', async ({
    page,
  }) => {
    await page.goto('/');
    const play = page.getByRole('button', { name: 'Play timeline' });
    await expect(play).toBeInViewport();
    // The sheet slides up on load; let it settle before measuring.
    const sheet = page.getByRole('region', { name: 'Conference list' });
    await expect(sheet.getByTestId('timeline')).toHaveCount(0);
    let top = -1;
    await expect
      .poll(async () => {
        const prev = top;
        top = (await sheet.boundingBox())!.y;
        return top === prev;
      })
      .toBe(true);
    const range = page.getByTestId('timeline-range');
    const before = (await range.textContent())!.trim();
    const win = (await page.getByRole('slider', { name: 'Date window' }).boundingBox())!;
    const [x, y] = [win.x + win.width / 2, win.y + win.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y - 80, { steps: 8 });
    await page.mouse.up();
    await expect(range).not.toHaveText(before);
    expect((await sheet.boundingBox())!.y).toBe(top);

    await play.click(); // fails if the sheet covers it
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
