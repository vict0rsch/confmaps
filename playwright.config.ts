import { defineConfig, devices } from '@playwright/test';

// A dedicated port, never reused: a stale server from another checkout must not be picked up.
// Override with PW_PORT if 4173 is taken. `PW_A11Y=1` runs only the warn-only axe project.
const port = Number(process.env.PW_PORT ?? 4173);
const a11y = !!process.env.PW_A11Y;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: a11y ? 'a11y' : 'chromium',
      use: { ...devices['Desktop Chrome'] },
      ...(a11y ? { testMatch: /a11y\.spec\.ts/ } : { testIgnore: /a11y\.spec\.ts/ }),
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
