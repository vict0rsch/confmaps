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
  // The first event of all data, e.g. "Since 1963".
  const allLabel = (await since.locator('.full').textContent())!;
  expect(Number(allLabel.slice(-4))).toBeLessThan(2013);
  await since.click();
  await expect(since).toHaveAttribute('aria-pressed', 'true');
  const firstYear = async () =>
    Math.min(...(await timeline.locator('.axis .tick.year').allTextContents()).map(Number));
  await expect.poll(firstYear).toBeLessThan(2013);

  // ICLR started in 2013: the active "Since <year>" follows, and the axis shrinks to it.
  await page.getByLabel('Search conferences').fill('iclr');
  await expect(since).toHaveAccessibleName('Since 2013');
  await expect(since).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[?&]from=2013-05-02/);
  await expect.poll(firstYear).toBeGreaterThanOrEqual(2013);
  await expect.poll(firstYear).toBeLessThanOrEqual(2015);

  // The filter panel's Dates control shows the same preset.
  await page.locator('button.chip[data-filter="dates"]').click();
  const tray = page.locator('[data-filter-tray="dates"]');
  const trayPreset = (name: string) => tray.getByRole('button', { name, exact: true });
  await expect(trayPreset('Since 2013')).toHaveAttribute('aria-pressed', 'true');

  // Clearing the filter takes it back to the first event of all data.
  await page.getByLabel('Search conferences').fill('');
  await expect(since).toHaveAccessibleName(allLabel);
  await expect(since).toHaveAttribute('aria-pressed', 'true');
  await expect(trayPreset(allLabel)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(firstYear).toBeLessThan(2013);
});

test('a filter change that moves the start pauses Play', async ({ page }) => {
  await page.goto('/');
  const timeline = page.getByTestId('timeline');
  await timeline.getByRole('button', { name: 'Past 5 years' }).click();
  const range = page.getByTestId('timeline-range');
  const before = (await range.textContent())!.trim();
  await timeline.getByRole('button', { name: 'Play timeline' }).click();
  await expect(range).not.toHaveText(before);
  await page.getByLabel('Search conferences').fill('iclr');
  // Paused, and still playable: the window is narrower than ICLR's span.
  await expect(timeline.getByRole('button', { name: 'Play timeline' })).toBeEnabled();
  const paused = (await range.textContent())!.trim();
  await page.waitForTimeout(600);
  await expect(range).toHaveText(paused);
});

test('"Since <year>" from the filter panel rebuilds the axis start', async ({ page }) => {
  await page.goto('/?q=iclr');
  const timeline = page.getByTestId('timeline');
  const firstYear = async () =>
    Math.min(...(await timeline.locator('.axis .tick.year').allTextContents()).map(Number));
  await page.locator('button.chip[data-filter="dates"]').click();
  const tray = page.locator('[data-filter-tray="dates"]');
  await tray.locator('#filter-dates-from').fill('1900-01');
  await expect.poll(firstYear).toBeLessThan(1910);
  await tray.getByRole('button', { name: 'Since 2013', exact: true }).click();
  await expect(timeline.getByRole('button', { name: 'Since 2013' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(firstYear).toBeGreaterThanOrEqual(2013);
  await expect.poll(firstYear).toBeLessThanOrEqual(2015);
});

test('View history sets the Series filter and tours its editions', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.row[data-conference-id="neurips26"]').click();
  await page.getByTestId('detail').getByRole('button', { name: 'View history' }).click();
  await expect(page).toHaveURL(/[?&]series=neurips(&|$)/);
  await expect(page).not.toHaveURL(/[?&](h|c)=/);
  const chip = page.locator('button.chip[data-filter="series"]');
  await expect(chip).toHaveClass(/active/);
  // One list row per edition (the count depends on how far back the data goes).
  const meta = page.getByTestId('history-meta');
  await expect(meta).toHaveText(/^\d+ editions/);
  const editions = (await meta.textContent())!.match(/\d+/)![0];
  await expect(page.locator('#list-heading .count')).toHaveText(`${editions}`);
  // The button plays the editions after a short wait.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // Exiting the tour keeps the filter.
  await page.getByRole('button', { name: 'Exit tour' }).click();
  await expect(chip).toHaveClass(/active/);
  await expect(page.getByTestId('timeline-range')).toBeVisible();

  // The link holds the filter, not the tour.
  await page.reload();
  await expect(page.locator('#list-heading .count')).toHaveText(`${editions}`);
  await expect(meta).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tour', exact: true })).toBeEnabled();
});

test('Tour plays the visible conferences; a filter change ends it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('button.row.current')).toHaveCount(1);
  await page.getByLabel('Search conferences').fill('iclr');
  await expect(page.getByRole('button', { name: 'Exit tour' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play timeline' })).toBeVisible();
  await expect(page.locator('button.row.current')).toHaveCount(0);
});

test('a tour ended by a home change stays ended when the home changes back', async ({ page }) => {
  const setHome = async (query: string) => {
    const input = page.getByRole('combobox', { name: 'Your city' });
    const change = page.getByRole('button', { name: 'Change location' });
    if (!(await input.or(change).isVisible())) await page.getByTestId('home-pill').click();
    await input.or(change).waitFor();
    if (await change.isVisible()) await change.click();
    await input.click();
    await input.fill(query);
    await expect(page.getByRole('option').first()).toContainText(query);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('home-city')).toContainText(query);
  };
  // ICML within 2,000 km of home: several editions from Paris, one (2017) from Sydney.
  await page.goto('/?series=icml&from=2000-01&to=2027-12&radius=2000');
  await setHome('Paris');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit tour' })).toBeVisible();
  await setHome('Sydney');
  await expect(page.getByRole('button', { name: 'Exit tour' })).toHaveCount(0);
  await setHome('Paris');
  await page.waitForTimeout(1500); // longer than the autoplay delay
  await expect(page.getByRole('button', { name: 'Exit tour' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play timeline' })).toBeVisible();
});

test('Tour is disabled above 200 conferences', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('timeline').getByRole('button', { name: 'Past 5 years' }).click();
  const tour = page.getByRole('button', { name: 'Tour', exact: true });
  await expect(tour).toBeDisabled();
  await expect(tour).toHaveAttribute('title', /200 conferences or fewer \(now [\d,]+\)/);
});

test('history stops: click or arrow keys to step through the editions', async ({ page }) => {
  await page.goto('/?h=icml');
  // The link becomes the Series filter.
  await expect(page).toHaveURL(/[?&]series=icml(&|$)/);
  await expect(page).not.toHaveURL(/[?&]h=/);
  const stops = page.getByRole('radiogroup', { name: 'Editions' }).getByRole('radio');
  const n = await stops.count();
  expect(n).toBeGreaterThan(3);
  // From a link nothing plays: the whole path is shown, at the last stop.
  await expect(stops.nth(n - 1)).toBeChecked();
  const mid = Math.floor(n / 2);
  await stops.nth(mid).click();
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
  await expect(stops.nth(mid)).toBeChecked();
  await expect(stops.nth(mid)).toHaveAccessibleName(/^\d{4}(, \d{4})*, .+/);
  // The tooltip shows the same text as the name, e.g. "2019 · Long Beach": on hover, and on
  // keyboard focus, but not after a click alone once the pointer has left.
  const tip = page.locator('.stop-tip');
  const tipText = async (i: number) =>
    (await stops.nth(i).getAttribute('aria-label'))!.replaceAll(', ', ' · ');
  await expect(tip).toHaveText(await tipText(mid));
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(stops.nth(mid + 1)).toBeChecked();
  await expect(stops.nth(mid + 1)).toBeFocused();
  await expect(tip).toHaveText(await tipText(mid + 1));
  await page.keyboard.press('End');
  await expect(stops.nth(n - 1)).toBeChecked();
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
