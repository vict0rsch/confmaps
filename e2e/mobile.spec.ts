import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** The sheet's top once it has stopped sliding. */
async function settledTop(sheet: Locator) {
  let top = -1;
  await expect
    .poll(async () => {
      const prev = top;
      top = (await sheet.boundingBox())!.y;
      return top === prev;
    })
    .toBe(true);
  return top;
}

/** A one-finger vertical drag. Playwright has no touch-move API, so it goes through CDP. */
async function touchDrag(page: Page, x: number, y: number, dy: number, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [{ x, y }]);
  for (let i = 1; i <= steps; i++) await send('touchMove', [{ x, y: y + (dy * i) / steps }]);
  await send('touchEnd', []);
}

/** Half → full → peek, by tapping the grip. */
async function toPeek(sheet: Locator) {
  await settledTop(sheet);
  await sheet.getByRole('button', { name: 'Expand panel' }).tap();
  await sheet.getByRole('button', { name: 'Collapse panel' }).tap();
  return settledTop(sheet);
}

/** The stub basemap credits no one, and an empty attribution is hidden: give it a credit. */
async function creditBasemap(page: Page) {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          osm: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: '© OpenStreetMap',
          },
        },
        layers: [{ id: 'boundary_2', type: 'line', source: 'osm' }],
      },
    }),
  );
}

test('the logo opens home, travel, the legend, theme and credits', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByRole('button', { name: 'confmaps', exact: true });
  await pill.click();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('dialog', { name: 'confmaps' });
  await expect(menu.getByRole('combobox', { name: 'Your city' })).toBeVisible();
  await menu.getByText('Travel preferences').click();
  await expect(menu.getByRole('group', { name: 'Distance units' })).toBeVisible();
  await expect(menu.getByRole('list', { name: 'Map legend' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Data & credits' })).toBeVisible();
  await menu.getByTitle('Dark theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(pill).toBeFocused();
  await expect(pill).toHaveAttribute('aria-expanded', 'false');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  await expect(sheet.getByRole('list', { name: 'Map legend' })).toHaveCount(0);

  await pill.click();
  await menu.getByRole('button', { name: 'Close menu' }).click();
  await expect(menu).toBeHidden();
  await expect(pill).toBeFocused();
});

test('a tapped city suggestion sets home and keeps the panel open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'confmaps', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'confmaps' });
  await menu.getByRole('combobox', { name: 'Your city' }).fill('Berlin');
  await menu.getByRole('option').first().tap();
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('home-city')).toContainText('Berlin');
  await expect(menu.getByRole('button', { name: 'Change location' })).toBeFocused();
});

test('a shared link shows a dot on the logo and its notice in the panel', async ({ page }) => {
  await page.goto('/?mode=fly&units=mi');
  await expect(page.getByTestId('shared-dot')).toBeVisible();
  await page.getByRole('button', { name: /^confmaps.*settings from a shared link$/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'confmaps' }).getByTestId('shared-travel-notice'),
  ).toBeVisible();
});

test('your own travel settings in the address bar are not a shared link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'confmaps', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'confmaps' });
  await menu.getByText('Travel preferences').click();
  await menu.getByText('mi', { exact: true }).click();
  await expect.poll(() => page.url()).toContain('units=mi');
  await page.reload();
  await expect(page.locator('button.row').first()).toBeVisible();
  await expect(page.getByTestId('shared-dot')).toHaveCount(0);
});

test('Filters opens a panel under its button; a tap outside closes it', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Filters', exact: true });
  await button.tap();
  const panel = page.getByRole('dialog', { name: 'Filters' });
  await expect(panel.getByRole('button', { name: 'Close filters' })).toBeFocused();
  const b = (await button.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(p.y).toBeGreaterThan(b.y + b.height);
  // Right-aligned with the capsule, a few pixels past the button.
  expect(p.x + p.width - (b.x + b.width)).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width - (b.x + b.width)).toBeLessThanOrEqual(5);
  await expect(panel.getByRole('button', { name: /^Show \d+ conferences$/ })).toBeVisible();
  await page.touchscreen.tap(Math.max(4, p.x / 2), p.y + 40);
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
});

test('Show N conferences closes the filters panel', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Filters', exact: true });
  await button.tap();
  const panel = page.getByRole('dialog', { name: 'Filters' });
  await panel.getByRole('button', { name: /^Show \d+ conferences$/ }).tap();
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
});

test('Topics opens a dropdown under its field; Escape closes only the dropdown', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Filters', exact: true }).tap();
  const field = page.getByRole('button', { name: /^Topics:/ });
  await expect(field).toContainText('Any topic');
  await expect(field).toHaveAttribute('aria-expanded', 'false');
  const y = await settledTop(field); // the panel slides in
  const height = (await field.boundingBox())!.height;
  await field.tap();
  const dropdown = page.getByRole('dialog', { name: 'Topics' });
  await expect(dropdown).toBeVisible();
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  expect((await dropdown.boundingBox())!.y).toBeGreaterThanOrEqual(y + height);
  expect((await field.boundingBox())!.y).toBe(y);
  await expect(dropdown.getByRole('checkbox').first()).toBeFocused();
  for (const name of ['Machine learning', 'Computer vision', 'Natural language processing']) {
    await dropdown.getByRole('checkbox', { name }).check();
  }
  await expect(field).toContainText(/Machine learning, Computer vision\s*\+1/);

  await page.keyboard.press('Escape');
  await expect(dropdown).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(/[?&]sub=/);
});

test('tapping the grip expands the sheet', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await settledTop(sheet);
  await sheet.getByRole('button', { name: 'Expand panel' }).tap();
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(top);
  await expect(sheet.getByRole('button', { name: 'Collapse panel' })).toBeVisible();
});

test('View history from a scrolled detail shows the list heading', async ({ page }) => {
  await page.goto('/?c=neurips26');
  const history = page.getByTestId('detail').getByRole('button', { name: 'View history' });
  await history.scrollIntoViewIfNeeded();
  await history.click();
  await expect(page.getByTestId('history-meta')).toBeVisible();
  await expect(page.locator('#list-heading')).toBeInViewport();
});

test('Enter on the grip cycles the sheet after a drag', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  await settledTop(sheet);
  const grip = sheet.getByRole('button', { name: 'Expand panel' });
  const box = (await grip.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, 840, { steps: 8 });
  await page.mouse.up();
  const top = await settledTop(sheet);
  await grip.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(top);
});

test('at peek, dragging the list heading with a finger raises the sheet', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await toPeek(sheet);
  const box = (await page.locator('#list-heading').boundingBox())!;
  await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, -300);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(top);
});

test('at peek, a fast mouse flick off the heading ends the drag; a row tap then selects', async ({
  page,
}) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await toPeek(sheet);
  const box = (await page.locator('#list-heading').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 300); // one step: the pointer is over the map at once
  await page.mouse.up();
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(top);
  await settledTop(sheet);
  await page.locator('button.row').first().tap();
  await expect(page.getByTestId('detail')).toBeVisible();
});

test('at peek, the detail close button takes a tap and the list shows its heading', async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/?c=neurips26');
  // Through full with a selection: the map has no free height left, and must not throw.
  const top = await toPeek(page.getByRole('region', { name: 'Conference details' }));
  expect(844 - top).toBe(68);
  await page.getByRole('button', { name: 'Close details' }).tap();
  await expect(page.getByTestId('detail')).toHaveCount(0);
  await expect(page.locator('#list-heading')).toBeInViewport();
  expect(errors).toEqual([]);
});

/** The centre of an element. */
async function centre(el: Locator) {
  const box = (await el.boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2] as const;
}

test('at half, a finger pulling down on a row lowers the sheet and selects nothing', async ({
  page,
}) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await settledTop(sheet);
  const [x, y] = await centre(page.locator('button.row').first());
  await touchDrag(page, x, y, 200);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(top);
  await settledTop(sheet);
  await expect(page.getByTestId('detail')).toHaveCount(0);
});

test('a pull of one single move lowers the sheet too', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const half = await settledTop(sheet);
  const [x, y] = await centre(page.locator('button.row').first());
  await touchDrag(page, x, y, 200, 1);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(half);
  expect(await settledTop(sheet)).toBeGreaterThan(half);
});

test('during a pull the sheet follows the finger without its slide', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await settledTop(sheet);
  const [x, y] = await centre(page.locator('button.row').first());
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: { y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: touchPoints.map((p) => ({ x, y: p.y })),
    });
  await send('touchStart', [{ y }]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [{ y: y + 10 * i }]);
  await expect(sheet).toHaveClass(/dragging/);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(top);
  await send('touchEnd', []);
  await expect(sheet).not.toHaveClass(/dragging/);
});

test('at half, swiping up on a row scrolls the list and leaves the sheet where it is', async ({
  page,
}) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await settledTop(sheet);
  const scroller = sheet.locator('[data-scroll]');
  const [x, y] = await centre(page.locator('button.row').first());
  await touchDrag(page, x, y, -200);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await settledTop(sheet)).toBe(top);
});

test('a scrolled list scrolls back on a swipe down; the sheet stays', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const top = await settledTop(sheet);
  const scroller = sheet.locator('[data-scroll]');
  await scroller.evaluate((el) => (el.scrollTop = 300));
  const [x, y] = await centre(scroller); // the first row has scrolled out of sight
  await touchDrag(page, x, y, 150);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(300);
  expect(await settledTop(sheet)).toBe(top);
});

test('the list heading drags the sheet at half and at full; a tap on it changes nothing', async ({
  page,
}) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const half = await settledTop(sheet);
  const heading = page.locator('#list-heading');
  const [x, y] = await centre(heading);
  await page.touchscreen.tap(x, y);
  expect(await settledTop(sheet)).toBe(half);

  await touchDrag(page, x, y, -300);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(half);
  const full = await settledTop(sheet);

  const [x2, y2] = await centre(heading);
  await touchDrag(page, x2, y2, 300);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(full);
});

test('in the detail, the title row drags the sheet; a drag from Close details keeps it open', async ({
  page,
}) => {
  await page.goto('/?c=neurips26');
  const sheet = page.getByRole('region', { name: 'Conference details' });
  const half = await settledTop(sheet);
  const [x, y] = await centre(page.locator('#detail-title'));
  await touchDrag(page, x, y, -300);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(half);
  await settledTop(sheet);

  // The sheet follows the mouse, so the release is on Close details again and its click must be
  // swallowed. 200 px down from full is nearest to half, and a flick down from there is half too.
  const [cx, cy] = await centre(sheet.getByRole('button', { name: 'Close details' }));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 200, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('detail')).toBeVisible();
  expect(await settledTop(sheet)).toBe(half);
});

test('a second finger on the list heading does not drag the sheet', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('region', { name: 'Conference list' });
  const half = await settledTop(sheet);
  const [rx, ry] = await centre(page.locator('button.row').first());
  const [hx, hy] = await centre(page.locator('#list-heading'));
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number; id: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const first = { x: rx, y: ry, id: 0 }; // still, on a row
  await send('touchStart', [first]);
  await send('touchStart', [first, { x: hx, y: hy, id: 1 }]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [first, { x: hx, y: hy - 40 * i, id: 1 }]);
  await send('touchEnd', []);
  expect(await settledTop(sheet)).toBe(half);
});

test('a tap outside Share closes it, not the logo panel', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByRole('button', { name: 'confmaps', exact: true });
  await pill.click();
  const menu = page.getByRole('dialog', { name: 'confmaps' });
  await menu.getByRole('button', { name: 'Share' }).click();
  const share = page.getByTestId('share-dialog');
  await expect(share).toBeVisible();
  await page.touchscreen.tap(5, 830);
  await expect(share).toBeHidden();
  await expect(menu).toBeVisible();
  await page.touchscreen.tap(380, 830);
  await expect(menu).toBeHidden();
  await expect(pill).toBeFocused();
});

test('the attribution is collapsed on phones, behind its (i) button', async ({ page }) => {
  await creditBasemap(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toHaveClass(/maplibregl-compact/);
  const inner = page.locator('.maplibregl-ctrl-attrib-inner');
  await expect(page.locator('.maplibregl-ctrl-attrib-button')).toBeVisible();
  await expect(inner).toBeHidden();
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  await expect(inner).toBeVisible();
});

test('the full attribution shows after a resize to desktop', async ({ page }) => {
  await creditBasemap(page);
  await page.goto('/');
  const inner = page.locator('.maplibregl-ctrl-attrib-inner');
  await expect(page.locator('.maplibregl-ctrl-attrib-button')).toBeVisible();
  await expect(inner).toBeHidden();
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(page.locator('.maplibregl-ctrl-attrib')).not.toHaveClass(/maplibregl-compact/);
  await expect(inner).toBeVisible();
});

test.describe('landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

  test('the list and the detail sit in a side panel; the timeline shares the top row', async ({
    page,
  }) => {
    await page.goto('/');
    const list = page.getByRole('region', { name: 'Conference list' });
    const panel = (await list.boundingBox())!;
    expect(panel.x).toBeLessThan(60);
    expect(panel.width).toBeLessThanOrEqual(360);
    expect(panel.height).toBeGreaterThan(250);
    await expect(page.getByRole('button', { name: 'Expand panel' })).toHaveCount(0);
    const play = (await page.getByRole('button', { name: 'Play timeline' }).boundingBox())!;
    expect(play.y).toBeLessThan(panel.y);

    await page.locator('button.row').first().click();
    await expect(
      page.getByRole('region', { name: 'Conference details' }).getByTestId('detail'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).tap();
    await expect(page.locator('#list-heading')).toBeInViewport();
  });

  test('the filters panel hangs from Filters, left-aligned, inside the window', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Filters', exact: true });
    await button.tap();
    const panel = page.getByRole('dialog', { name: 'Filters' });
    await expect(panel).toBeVisible();
    const b = (await button.boundingBox())!;
    const p = (await panel.boundingBox())!;
    expect(Math.abs(p.x - (b.x - 3))).toBeLessThanOrEqual(2); // the capsule's 3 px padding
    expect(p.y + p.height).toBeLessThanOrEqual(390);
    await expect(panel.getByRole('button', { name: /^Show / })).toBeInViewport();
    await page.getByRole('button', { name: /^Topics:/ }).tap();
    const d = (await page.getByRole('dialog', { name: 'Topics' }).boundingBox())!;
    expect(d.y).toBeGreaterThanOrEqual(p.y);
    expect(d.y + d.height).toBeLessThanOrEqual(p.y + p.height);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('the tab folds the panel into a pill; the pill opens it again', async ({ page }) => {
    await page.goto('/');
    const list = page.getByRole('region', { name: 'Conference list' });
    const fold = page.getByRole('button', { name: 'Hide panel' });
    await fold.tap();
    await expect(list).toBeHidden();
    const pill = page.getByRole('button', { name: /^Show \d+ conferences$/ });
    await expect(pill).toBeVisible();
    await expect(pill).toBeFocused();

    await pill.tap();
    await expect(list).toBeVisible();
    await expect(pill).toBeHidden();
    await expect(fold).toBeFocused();
  });

  test('folded with a selection, the pill names the conference', async ({ page }) => {
    await page.goto('/?c=neurips26');
    await page.getByRole('button', { name: 'Hide panel' }).tap();
    await expect(page.getByTestId('detail')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show NeurIPS 2026' })).toBeFocused();
  });

  test('the tab comes before the list rows in the tab order', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Hide panel' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('button.row').first()).toBeFocused();
  });

  test('a new selection while folded unfolds the panel to the detail', async ({ page }) => {
    // Pins are drawn on the map canvas: leaving history mode restores the selection instead.
    await page.goto('/?c=neurips26');
    const history = page.getByTestId('detail').getByRole('button', { name: 'View history' });
    await history.scrollIntoViewIfNeeded();
    await history.click();
    await expect(page.getByTestId('history-meta')).toBeVisible();
    await page.getByRole('button', { name: 'Hide panel' }).tap();
    await expect(page.getByRole('region', { name: 'Conference list' })).toBeHidden();
    await page.getByRole('button', { name: /^Exit/ }).click();
    await expect(page.getByRole('region', { name: 'Conference details' })).toBeVisible();
    await expect(page.locator('#detail-title')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Show NeurIPS 2026' })).toBeHidden();
  });
});
