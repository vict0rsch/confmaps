import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/',
  plugins: [svelte()],
  build: {
    // The only chunk over Vite's 500 kB default is MapLibre GL itself (~1 MB minified, ~290 kB
    // gzip): one library, loaded lazily after the shell (App.svelte), that cannot be split further.
    chunkSizeWarningLimit: 1100,
  },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
