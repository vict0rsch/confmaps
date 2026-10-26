import AxeBuilder from '@axe-core/playwright';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { startPastFixture } from './past-fixture';

// Warn-only (DESIGN §9): run with PW_A11Y=1 (the `a11y` project). Violations are attached to the
// test and printed as a summary; the suite only fails if axe itself cannot run. Set
// PW_A11Y_STRICT=1 to make serious/critical violations fail.
//
// The MapLibre canvas is excluded: it is a bitmap (no DOM to inspect), and its keyboard/screen
// reader alternative is the conference list, which is scanned.

type Theme = 'light' | 'dark';
const sizes = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

async function scan(page: Page, name: string, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .exclude('.maplibregl-canvas')
    .analyze();
  const rows = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  for (const r of rows) {
    console.log(`[a11y] ${name} | ${r.impact} | ${r.rule} x${r.nodes} | ${r.targets.join(' ; ')}`);
  }
  await testInfo.attach(`axe ${name}`, {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  });
  if (process.env.PW_A11Y_STRICT) {
    expect(rows.filter((r) => r.impact === 'serious' || r.impact === 'critical')).toEqual([]);
  }
}

async function setHome(page: Page, phone: boolean) {
  if (phone) await page.getByRole('button', { name: 'confmaps', exact: true }).click();
  if (!phone) await page.getByTestId('home-pill').click();
  const input = page.getByRole('combobox', { name: 'Your city' });
  await input.click();
  await input.fill('Berlin');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-city')).toContainText('Berlin');
  if (phone) await page.keyboard.press('Escape');
}

const states: Record<string, (page: Page, phone: boolean) => Promise<void>> = {
  default: async () => {},
  'filters open': async (page, phone) => {
    if (phone) await page.getByRole('button', { name: 'Filters' }).click();
    else await page.locator('button.chip[data-filter="subject"]').click();
  },
  'detail with home': async (page, phone) => {
    await setHome(page, phone);
    await page.locator('[data-conference-id="neurips26"]').click();
    await expect(page.getByTestId('detail')).toBeVisible();
  },
  'share dialog': async (page, phone) => {
    // Desktop: Share sits in the sidebar header (a selection, so the link carries it); phone: in
    // the panel the logo opens.
    if (phone) {
      await page.getByRole('button', { name: 'confmaps' }).click();
      await page
        .getByRole('dialog', { name: 'confmaps' })
        .getByRole('button', { name: 'Share' })
        .click();
    } else {
      await page.locator('[data-conference-id="neurips26"]').click();
      await page.getByRole('button', { name: 'Share' }).first().click();
    }
    await expect(page.getByTestId('share-dialog')).toBeVisible();
  },
  'methodology dialog': async (page) => {
    await page.goto('/#methodology');
    await expect(page.getByRole('dialog', { name: 'Methodology' })).toBeVisible();
  },
  'history mode': async (page) => {
    await page.goto('/?h=neurips');
    await expect(page.getByTestId('history-meta')).toBeVisible();
  },
};

for (const theme of ['light', 'dark'] as Theme[]) {
  for (const [size, viewport] of Object.entries(sizes)) {
    test.describe(`${theme} ${size}`, () => {
      test.use({ viewport, colorScheme: theme });
      for (const [name, setup] of Object.entries(states)) {
        test(name, async ({ page }, testInfo) => {
          await page.goto('/');
          await expect(page.locator('button.row').first()).toBeVisible();
          await setup(page, size === 'phone');
          await scan(page, `${theme} ${size} ${name}`, testInfo);
        });
      }
    });
  }
}

// Past editions (fixture build): the Virtual badge in list rows and the virtual detail.
test.describe('past editions', () => {
  let fixture: Awaited<ReturnType<typeof startPastFixture>>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    fixture = await startPastFixture();
  });
  test.afterAll(async () => fixture?.close());

  for (const theme of ['light', 'dark'] as Theme[]) {
    for (const [size, viewport] of Object.entries(sizes)) {
      test.describe(`${theme} ${size}`, () => {
        test.use({ viewport, colorScheme: theme });
        test('virtual rows and detail', async ({ page }, testInfo) => {
          const phone = size === 'phone';
          await page.goto(`${fixture.url}/?from=2019-12&to=2020-12`);
          await expect(page.locator('button.row').first()).toBeVisible();
          await setHome(page, phone);
          await expect(page.getByTestId('format-badge').first()).toBeVisible();
          await scan(page, `${theme} ${size} virtual rows`, testInfo);
          await page.locator('button.row[data-conference-id="neurips20"]').click();
          await expect(page.getByTestId('site-footprint')).toContainText('Online');
          // Let the panel's entrance finish (mid-fade text fails contrast).
          await page.evaluate(() =>
            Promise.all(
              document
                .getAnimations()
                .filter((a) => a.effect?.getTiming().iterations !== Infinity)
                .map((a) => a.finished),
            ),
          );
          await scan(page, `${theme} ${size} virtual detail`, testInfo);
        });
      });
    }
  }
});
