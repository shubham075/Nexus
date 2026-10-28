import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests drive the renderer in a browser (web bridge fallback) against a live API on a seeded database.
 * Both servers are started if they are not already running.
 */
export default defineConfig({
  testDir: './e2e',
  // The dev server serves ~2k unbundled modules to every fresh browser context, so first loads are slow.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
    // PW_CHANNEL=msedge (or chrome) uses an installed browser instead of Playwright's download.
    ...devices['Desktop Chrome'],
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: [
    {
      command: 'pnpm --filter @nexus/server start',
      url: 'http://127.0.0.1:4000/health',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev:web',
      url: 'http://localhost:5183',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
