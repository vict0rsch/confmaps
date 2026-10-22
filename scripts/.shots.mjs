// Untracked helper for screenshots. Usage: node scripts/.shots.mjs <outdir>
import { chromium } from '@playwright/test';

const out = process.argv[2];
const base = 'http://localhost:4273';
const browser = await chromium.launch();

async function setHome(page, compact) {
  if (compact) {
    await page.getByRole('button', { name: /Set location/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Your location' });
    await dialog.getByRole('combobox').fill('Berlin');
    await dialog.getByRole('option').first().waitFor();
    await page.keyboard.press('Enter');
    return dialog;
  }
  const input = page.getByRole('combobox', { name: 'Your city' });
  await input.fill('Berlin');
  await page.getByRole('option').first().waitFor();
  await page.keyboard.press('Enter');
}

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  for (const scheme of ['light', 'dark']) {
    const compact = label === 'mobile';
    const ctx = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    await page.goto(base + '/');
    await page.waitForTimeout(1500);
    const name = (s) => `${out}/${s}-${label}-${scheme}.png`;

    if (compact) {
      await page.getByRole('button', { name: /Set location/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Your location' });
      await dialog.getByRole('combobox').fill('par');
      await dialog.getByRole('option').first().waitFor();
      await page.screenshot({ path: name('0-search') });
      await dialog.getByRole('combobox').fill('Berlin');
      await dialog.getByRole('option').first().waitFor();
      await page.keyboard.press('Enter');
      await page.screenshot({ path: name('0-sheet') });
      await dialog.getByRole('button', { name: 'Done' }).click();
    } else {
      const input = page.getByRole('combobox', { name: 'Your city' });
      await input.fill('par');
      await page.getByRole('option').first().waitFor();
      await page.screenshot({ path: name('0-search') });
      await setHome(page, false);
      await page.getByText('Travel', { exact: true }).click();
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: name('1-home-list') });

    await page.locator('[data-conference-id="neurips26"]').click();
    await page.waitForTimeout(1500);
    if (compact) {
      // Raise the sheet to its full height so the footprints are visible.
      await page.mouse.move(195, 560);
    }
    await page.screenshot({ path: name('2-detail') });
    const detail = page.getByTestId('detail');
    await detail.scrollIntoViewIfNeeded();
    await page.getByTestId('site-footprint').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: name('2-detail-scrolled') });

    if (compact) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Share' }).scrollIntoViewIfNeeded();
    }
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByLabel('Include my city in the link').check();
    await page.waitForTimeout(400);
    await page.screenshot({ path: name('3-share') });
    await ctx.close();
  }
}
await browser.close();
