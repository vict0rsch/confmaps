import { fileURLToPath } from 'node:url';
import { runnerImport, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

type Seo = typeof import('./scripts/seo');

/**
 * Crawler pages (DESIGN §5.10): the conference summary in index.html, and sitemap.xml. The
 * module goes through Vite's module runner instead of a static import, so the config does not
 * bundle app code (its extensionless and JSON imports).
 */
function seo(): Plugin {
  const slot = '<div id="app"></div>';
  const path = fileURLToPath(new URL('./scripts/seo.ts', import.meta.url));
  let module: Promise<Seo> | undefined;
  const pages = async () => {
    module ??= runnerImport<Seo>(path, { configFile: false }).then((r) => r.module);
    return (await module).pages();
  };
  return {
    name: 'confmaps-seo',
    async transformIndexHtml(html) {
      if (!html.includes(slot)) throw new Error(`index.html has no ${slot}`);
      const { summary } = await pages();
      // A function replacement: `$` patterns in the data must stay literal.
      return html.replace(slot, () => `<div id="app">${summary}</div>`);
    },
    async generateBundle() {
      const { sitemap } = await pages();
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [svelte(), seo()],
  build: {
    // The only chunk over Vite's 500 kB default is MapLibre GL itself (~1 MB minified, ~290 kB
    // gzip): one library, loaded lazily after the shell (App.svelte), that cannot be split further.
    chunkSizeWarningLimit: 1100,
  },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
