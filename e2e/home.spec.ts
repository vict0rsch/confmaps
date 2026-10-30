import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const BERLIN_ID = 2950159;

async function setHome(page: Page, query = 'Berlin') {
  await page.getByTestId('home-pill').click();
  const input = page.getByRole('combobox', { name: 'Your city' });
  await input.click();
  await input.fill(query);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
}

test('the city list is not fetched on page load, only on first focus of the search', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('button.row').first()).toBeVisible();
  expect(requests.some((u) => u.endsWith('cities.json'))).toBe(false);
  await page.getByTestId('home-pill').click();
  await expect.poll(() => requests.some((u) => u.endsWith('cities.json'))).toBe(true);
});

test('setting home via search shows distances and estimates in the list', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('row-footprint')).toHaveCount(0);
  const yourCity = page.getByRole('list', { name: 'Map legend' }).getByText('Your city');
  await expect(yourCity).toHaveCount(0);
  await setHome(page);
  await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
  await expect(yourCity).toBeVisible();
  const first = page.getByTestId('row-footprint').first();
  await expect(first).toContainText(/~[\d,]+ km/);
  await expect(first).toContainText(/~[\d.,]+ (kg|t)/);

  // Persisted: survives a reload, and the stored value is the city only.
  await page.reload();
  await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
  const stored = await page.evaluate(() => localStorage.getItem('confmaps:home'));
  expect(JSON.parse(stored!)).toMatchObject({ id: BERLIN_ID, name: 'Berlin' });
});

test('the radius filter narrows the list', async ({ page }) => {
  await page.goto('/');
  await setHome(page);
  const count = page.locator('#list-heading .count');
  const rows = page.locator('button.row');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await page.goto('/?radius=300');
  await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
  await expect(page.getByTestId('filters-badge')).toHaveText(/^\s*1/);
  await expect(count).not.toHaveText(`${all}`);
  expect(await rows.count()).toBeLessThan(all);
  const shown = await rows.count();
  await expect(count).toHaveText(shown ? `${shown}` : 'No');
});

test('combobox is keyboard accessible', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-pill').click();
  const input = page.getByRole('combobox', { name: 'Your city' });
  await input.click();
  await input.fill('par');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  await expect(page.locator(`#${active}`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('"Nearest first" sorts the list by distance', async ({ page }) => {
  await page.goto('/');
  await setHome(page);
  await page.getByRole('button', { name: 'Nearest first' }).click();
  const km = await page
    .getByTestId('row-footprint')
    .evaluateAll((els) =>
      els.map((el) => Number(/~([\d,]+) km/.exec(el.textContent ?? '')?.[1].replace(',', ''))),
    );
  expect(km.length).toBeGreaterThan(2);
  expect(km).toEqual([...km].sort((a, b) => a - b));
});

test('detail shows per-site estimates, the nearest site, and the myclimate cross-check', async ({
  page,
}) => {
  await page.goto('/');
  await setHome(page);
  await page.locator('[data-conference-id="neurips26"]').click();
  const detail = page.getByTestId('detail');
  const sites = detail.getByTestId('site-footprint');
  await expect(sites).toHaveCount(3);
  await expect(detail.getByText('Estimated CO₂e, round trip').first()).toBeVisible();
  // Flights (Sydney, Atlanta) are nonstop with an uncertainty range; Paris (rail) has none.
  await expect(
    detail.getByText(/^~[\d.,]+(?: kg)?–[\d.,]+ (?:kg|t) depending on route and method$/),
  ).toHaveCount(2);
  await expect(detail.getByText('Nearest')).toHaveCount(1);
  await expect(detail.getByText(/^Paris: roughly \d+× less than flying to Sydney$/)).toBeVisible();

  // Paris (rail) has no cross-check; Sydney and Atlanta (flights) have, each with the caveat line.
  const link = detail.getByRole('link', { name: /Cross-check this flight on myclimate/ });
  await expect(link).toHaveCount(2);
  await expect(link.first()).toHaveAttribute('href', /^https:\/\/co2\.myclimate\.org\//);
  await expect(detail.getByText(/same order of magnitude is expected/)).toHaveCount(2);

  // Per-trip override: flying to Paris adds a third cross-check link.
  await sites.filter({ hasText: 'Paris' }).getByLabel('✈️ Flight').check({ force: true });
  await expect(detail.getByRole('link', { name: /Cross-check this flight/ })).toHaveCount(3);

  await expect(detail.getByRole('link', { name: 'How is this estimated?' })).toBeVisible();
});

test('the methodology opens from the detail panel', async ({ page }) => {
  await page.goto('/');
  await setHome(page);
  await page.locator('[data-conference-id="neurips26"]').click();
  await page.getByTestId('detail').getByRole('link', { name: 'How is this estimated?' }).click();
  const dialog = page.getByRole('dialog', { name: 'Methodology' });
  await expect(dialog.getByText('These figures are order-of-magnitude estimates')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/#methodology/);
});

test('share link never includes the home city unless opted in', async ({ page }) => {
  await page.goto('/');
  await setHome(page);
  await page.locator('[data-conference-id="neurips26"]').click();
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByTestId('share-dialog');
  const link = dialog.getByLabel('Link to share');
  await expect(link).toHaveValue(/c=neurips26/);
  await expect(link).not.toHaveValue(/home=/);
  expect(page.url()).not.toContain('home=');

  await dialog.getByLabel('Include my city in the link').check();
  await expect(link).toHaveValue(new RegExp(`home=${BERLIN_ID}(&|$)`));
  // City id only: no coordinates, no name.
  await expect(link).not.toHaveValue(/lat|lng|52\.|Berlin/);

  await dialog.getByLabel('Include my city in the link').uncheck();
  await expect(link).not.toHaveValue(/home=/);
  expect(page.url()).not.toContain('home=');
});

test('a shared home applies for this visit only, and "Use mine" restores the saved one', async ({
  page,
}) => {
  await page.goto('/');
  await setHome(page, 'Berlin');
  // Visit a link that shares Paris (geonameid 2988507).
  await page.goto('/?home=2988507');
  await expect(page.getByTestId('shared-notice')).toContainText(
    'Showing distances from Paris, France (from the shared link)',
  );
  await expect(page.getByTestId('home-city')).toHaveText('Paris, France');
  // Not saved, and dropped from the address bar.
  const stored = await page.evaluate(() => localStorage.getItem('confmaps:home'));
  expect(JSON.parse(stored!).name).toBe('Berlin');
  await expect.poll(() => page.url()).not.toContain('home=');

  await page.getByRole('button', { name: 'Use mine' }).click();
  await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
  await expect(page.getByTestId('shared-notice')).toHaveCount(0);
});

test.describe('geolocation', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 52.5123, longitude: 13.3891 },
  });

  test('"Use my location" snaps to the nearest city and stores no coordinates', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('home-pill').click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
    const stored = await page.evaluate(() => localStorage.getItem('confmaps:home'));
    expect(stored).not.toContain('52.5123');
    expect(stored).not.toContain('13.3891');
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the logo panel sets home and the list shows distances', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'confmaps', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'confmaps' });
    await menu.getByRole('combobox', { name: 'Your city' }).fill('Berlin');
    await expect(menu.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu.getByTestId('home-city')).toHaveText('Berlin, Germany');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('row-footprint').first()).toContainText(/~[\d,]+ km/);
  });
});

test('Escape closes the home panel and a filter tray, and focus returns to their trigger', async ({
  page,
}) => {
  await page.goto('/');
  const pill = page.getByTestId('home-pill');
  await pill.click();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pill).toHaveAttribute('aria-expanded', 'false');
  await expect(pill).toBeFocused();

  const chip = page.locator('button.chip[data-filter="subject"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await expect(chip).toBeFocused();
});
