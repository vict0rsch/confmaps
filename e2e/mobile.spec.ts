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
async function touchDrag(page: Page, x: number, y: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [{ x, y }]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [{ x, y: y + (dy * i) / 8 }]);
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

test('the attribution is compact on phones, shown first, then behind its (i) button', async ({
  page,
}) => {
  await creditBasemap(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toHaveClass(/maplibregl-compact/);
  const inner = page.locator('.maplibregl-ctrl-attrib-inner');
  await expect(inner).toBeVisible();
  await expect(inner).toBeHidden({ timeout: 8000 });
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  await expect(inner).toBeVisible();
});

test('the full attribution stays shown after a resize to desktop', async ({ page }) => {
  await creditBasemap(page);
  await page.goto('/');
  const inner = page.locator('.maplibregl-ctrl-attrib-inner');
  await expect(inner).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForTimeout(6000); // past the phone's five-second collapse
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
});
