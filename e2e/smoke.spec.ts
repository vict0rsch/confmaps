import type { Page } from '@playwright/test';
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

/** The free map area (inside the overlays), as the map's own inset properties give it. */
const freeArea = (page: Page) =>
  page.locator('.map-wrap').evaluate((el) => {
    const cs = getComputedStyle(el);
    const inset = (s: string) => parseFloat(cs.getPropertyValue(`--inset-${s}`)) || 0;
    const r = el.getBoundingClientRect();
    return {
      left: r.left + inset('left'),
      top: r.top + inset('top'),
      right: r.right - inset('right'),
      bottom: r.bottom - inset('bottom'),
    };
  });

/**
 * Pins and clusters are drawn on the canvas: sweep it with synthetic mouse moves and keep the
 * spots where the cursor turns into a pointer, merged into one point per mark, biggest first.
 */
const markCentres = async (page: Page) =>
  page.locator('.maplibregl-canvas').evaluate(
    (canvas, area) => {
      const step = 8;
      const groups: [number, number][][] = [];
      for (let y = area.top + step; y < area.bottom; y += step)
        for (let x = area.left + step; x < area.right; x += step) {
          canvas.dispatchEvent(
            new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
          );
          if ((canvas as HTMLElement).style.cursor !== 'pointer') continue;
          const near = groups.find((g) =>
            g.some(([gx, gy]) => Math.abs(gx - x) <= step && Math.abs(gy - y) <= step),
          );
          if (near) near.push([x, y]);
          else groups.push([[x, y]]);
        }
      return groups
        .toSorted((a, b) => b.length - a.length)
        .map((g) => ({
          x: g.reduce((s, p) => s + p[0], 0) / g.length,
          y: g.reduce((s, p) => s + p[1], 0) / g.length,
        }));
    },
    await freeArea(page),
  );

test('hovering a pin shows its conference and dates', async ({ page }) => {
  // A selection is fitted to the centre of the free map area.
  await page.goto('/?c=iclr19');
  const tip = page.locator('.map-tip');
  await expect(async () => {
    const a = await freeArea(page);
    const [x, y] = [(a.left + a.right) / 2, (a.top + a.bottom) / 2];
    await page.mouse.move(x + 4, y + 4);
    await page.mouse.move(x, y);
    await expect(tip).toHaveText('ICLR 2019 · May 6–9', { timeout: 500 });
  }).toPass();
  await expect(tip).toHaveAttribute('aria-hidden', 'true');
  await page.mouse.move(2, 2);
  await expect(tip).toHaveCount(0);
});

test('hovering a cluster lists at most 10 conferences, then [...]', async ({ page }) => {
  // Eleven years of conferences: Europe's cluster holds hundreds.
  await page.goto('/?from=2015-01&to=2025-12');
  await expect(page.locator('button.row').first()).toBeVisible();
  const tip = page.locator('.map-tip > div');
  let longest: string[] = [];
  for (const { x, y } of await markCentres(page)) {
    await page.mouse.move(x + 4, y + 4);
    await page.mouse.move(x, y);
    await expect(tip.first()).toBeVisible();
    const lines = await tip.allTextContents();
    expect(lines.length).toBeLessThanOrEqual(11);
    if (lines.length === 11) {
      longest = lines;
      break;
    }
  }
  expect(longest[10]).toBe('[...]');
  for (const line of longest.slice(0, 10)) expect(line).toMatch(/^.+ \d{4} · [A-Z][a-z]{2} \d/);
});
