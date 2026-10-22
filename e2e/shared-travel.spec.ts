import { expect, test } from './fixtures';

test('a CO2 link carries its travel settings, applied for this visit only', async ({ page }) => {
  // The recipient saved "Always fly".
  await page.addInitScript(() => {
    if (!localStorage.getItem('confmaps:travel')) {
      localStorage.setItem(
        'confmaps:travel',
        JSON.stringify({ units: 'km', mode: 'fly', threshold: 1000 }),
      );
    }
  });
  await page.goto('/?home=2950159&co2=100&mode=auto&thr=1000&units=km');
  await expect(page.getByTestId('shared-travel-notice')).toContainText(
    'Using the travel settings from the shared link (km · train under 1,000 km)',
  );
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('confmaps:travel')))!).mode,
  ).toBe('fly');
  // The settings stay in the address bar, so the link can be passed on.
  await expect.poll(() => page.url()).toContain('mode=auto');

  await page.getByRole('button', { name: 'Use mine' }).first().click();
  await expect(page.getByTestId('shared-travel-notice')).toHaveCount(0);
});

test('third-party notices open in-app from the footer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data & credits' }).click();
  await page.getByRole('link', { name: 'third-party notices' }).click();
  await expect(page.getByRole('dialog', { name: 'Third-party notices' })).toContainText(
    'Hugging Face',
  );
});
