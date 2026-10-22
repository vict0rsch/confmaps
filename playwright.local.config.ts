// Local-only (untracked): the same config on another port, so this worktree never reuses another
// checkout's preview server.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { baseURL: 'http://localhost:4273' },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4273 --strictPort',
    url: 'http://localhost:4273',
    reuseExistingServer: false,
  },
});
