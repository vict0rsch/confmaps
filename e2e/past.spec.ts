// Past editions (historical backfill): virtual and hybrid editions, old titles, history mode.
// Runs against a fixture build (./past-fixture.ts) until the real past data lands.
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startPastFixture } from './past-fixture';

let fixture: Awaited<ReturnType<typeof startPastFixture>>;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await startPastFixture();
});
test.afterAll(async () => fixture?.close());

const open = (page: Page, query = '') => page.goto(`${fixture.url}/${query}`);

async function setHome(page: Page) {
  await page.getByTestId('home-pill').click();
  const input = page.getByRole('combobox', { name: 'Your city' });
  await input.click();
  await input.fill('Berlin');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-city')).toHaveText('Berlin, Germany');
}

const row = (page: Page, id: string) => page.locator(`button.row[data-conference-id="${id}"]`);

test('history mode: the NIPS 2017 edition, online years beside the title', async ({ page }) => {
  await open(page, '?h=neurips');
  await expect(page.getByTestId('history-meta')).toHaveText('10 editions · 2017–2026');
  await expect(page.getByTestId('history-online')).toHaveText('Online: 2020 · 2021');
  await expect(row(page, 'neurips17')).toContainText('NIPS 2017');
  await expect(row(page, 'neurips17')).toContainText('Long Beach, United States');
  // Virtual editions are listed, but have no stop: 8 pinned editions, New Orleans twice in a row.
  await expect(row(page, 'neurips20')).toContainText('Online');
  await expect(page.locator('.stops .stop')).toHaveCount(7);
});

test('a virtual edition: Virtual badge, "Online · ~0 kg"; distance filters keep it', async ({
  page,
}) => {
  await open(page, '?from=2020-01&to=2020-12');
  await setHome(page);
  const neurips20 = row(page, 'neurips20');
  await expect(neurips20.getByTestId('format-badge')).toHaveText('Virtual');
  await expect(neurips20).toContainText('Online');
  await expect(neurips20.getByTestId('row-footprint')).toContainText('Online · ~0 kg');
  await expect(page.locator('#list-heading .count')).toHaveText('3');

  // "Nearest first": attending online counts as distance 0.
  await open(page, '?from=2019-12&to=2020-12');
  await page.getByRole('button', { name: 'Nearest first' }).click();
  await expect(page.locator('button.row').last()).toHaveAttribute(
    'data-conference-id',
    'neurips19',
  );

  // Vancouver 2019 + three virtual 2020 editions; 50 km and 25 kg from Berlin keep the virtual ones.
  await open(page, '?from=2019-12&to=2020-12');
  await expect(page.locator('#list-heading .count')).toHaveText('4');
  await open(page, '?from=2019-12&to=2020-12&radius=50');
  await expect(page.locator('#list-heading .count')).toHaveText('3');
  await expect(row(page, 'neurips19')).toHaveCount(0);
  await open(page, '?from=2019-12&to=2020-12&co2=25');
  await expect(page.locator('#list-heading .count')).toHaveText('3');
  await expect(row(page, 'iclr20')).toBeVisible();
});

test('virtual detail: no pin, no travel, no deadlines', async ({ page }) => {
  await open(page, '?from=2020-01&to=2020-12');
  await setHome(page);
  await row(page, 'neurips20').click();
  const detail = page.getByTestId('detail');
  await expect(detail.getByRole('heading', { name: 'NeurIPS 2020' })).toBeVisible();
  await expect(detail).toContainText('Virtual event · Official');
  await expect(detail.locator('.place')).toContainText('Online');
  await expect(detail.getByTestId('format-badge')).toHaveText('Virtual');
  const footprint = detail.getByTestId('site-footprint');
  await expect(footprint).toContainText('Online · ~0 kg');
  await expect(footprint).toContainText('Attending online: no travel');
  await expect(footprint.getByRole('radiogroup')).toHaveCount(0);
  await expect(detail).not.toContainText('myclimate');
  await expect(detail).not.toContainText('Paper deadline');
  await expect(detail.getByRole('link', { name: 'Countdowns on the HF site' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Back to/ })).toHaveCount(0);
});

test('hybrid detail: its city, a Hybrid badge, the trip and "Also online"', async ({ page }) => {
  await open(page, '?from=2022-11&to=2022-12');
  await setHome(page);
  await expect(row(page, 'neurips22')).toContainText('New Orleans, United States');
  await expect(row(page, 'neurips22')).toContainText('Hybrid');
  await row(page, 'neurips22').click();
  const detail = page.getByTestId('detail');
  await expect(detail.getByTestId('format-badge')).toHaveText('Hybrid');
  const footprint = detail.getByTestId('site-footprint');
  await expect(footprint).toContainText(/~[\d,]+ km/);
  await expect(footprint).toContainText('Also online (~0 kg)');
});

test('the axis starts 5 years back; "Since <year>" reaches the first edition', async ({ page }) => {
  await open(page);
  const ticks = page.locator('.axis .tick.year');
  await expect(ticks.first()).toBeVisible();
  await expect(ticks.filter({ hasText: '2017' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Since 2017' }).click();
  await expect(page.getByTestId('timeline-range')).toContainText('2017');
  await expect(page).toHaveURL(/[?&]from=2017-12-04/);
  await expect(page.locator('#list-heading .count')).not.toHaveText('No');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opening a short past detail never scrolls the sheet area (no blank band)', async ({
    page,
  }) => {
    const areaScroll = () => page.locator('.sheet-area').evaluate((el) => el.scrollTop);
    await open(page, '?h=neurips');
    // Selected at once, while the sheet is still sliding in: scrolling the row into view used to
    // scroll the clipped sheet area too.
    await row(page, 'neurips17').click();
    await expect(
      page.getByTestId('detail').getByRole('heading', { name: 'NIPS 2017' }),
    ).toBeVisible();
    expect(await areaScroll()).toBe(0);
    await page.keyboard.press('Escape');
    await row(page, 'neurips25').click();
    await expect(
      page.getByTestId('detail').getByRole('heading', { name: 'NeurIPS 2025' }),
    ).toBeVisible();
    expect(await areaScroll()).toBe(0);
  });
});
