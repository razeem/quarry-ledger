import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  // One retry absorbs the occasional dev-server navigation stall; failures still surface.
  retries: process.env['CI'] ? 2 : 1,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Run against the production build served statically (not `ng serve`) so lazy
  // chunks are real static files — deterministic, no dev-server reloads.
  webServer: {
    // SYNC_OFF pins the build to "no backend configured". These tests assert the
    // app's offline-first behaviour and must never reach a real Supabase project,
    // whatever is in the developer's `.env`. The fake backend supplies its own
    // config by intercepting requests.
    command: `SYNC_OFF=1 npm run build && PORT=${PORT} node e2e/static-server.mjs`,
    url: BASE_URL,
    // Never reuse: a stale or half-dead server on this port silently serves an old
    // `dist/`, which fails every test at once for no visible reason. Starting fresh
    // costs one ~6s build and makes a port conflict an explicit error instead.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
