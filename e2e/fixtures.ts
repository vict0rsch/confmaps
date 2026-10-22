import { test as base, expect } from '@playwright/test';

// The suite must not depend on third parties. The basemap comes from OpenFreeMap; here it is
// replaced by an empty style (the app's own data layers are added on `style.load`, so the map
// still initializes). Any other non-local request is aborted.
export const test = base.extend<{ stubThirdParties: void }>({
  stubThirdParties: [
    async ({ context }, use) => {
      await context.route(
        (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
        (route) => {
          const url = new URL(route.request().url());
          if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) {
            return route.fulfill({
              json: { version: 8, sources: {}, layers: [], glyphs: undefined },
            });
          }
          return route.abort();
        },
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
