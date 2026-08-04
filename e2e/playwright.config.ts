import { defineConfig } from '@playwright/test'

import { ACCEPTANCE_VIEWPORT, BASE_URL } from './src/config.js'

/**
 * The mandatory v0 acceptance run (issue #14).
 *
 * Three settings are requirements rather than preferences:
 *
 * * **Chromium only, at exactly 1920 × 1080.** The epic fixes desktop Chromium
 *   at that resolution as the acceptance surface; Firefox, WebKit, mobile and
 *   tablet are explicitly not mandatory and are therefore not configured. A
 *   browser matrix nobody committed to would turn a release gate into noise.
 * * **One worker, no parallelism.** The suite shares one Compose deployment and
 *   one event log, and the simulator's scenarios expect an empty database. The
 *   files are numbered in the order they must run.
 * * **No retries.** A release gate that passes on the second attempt is a gate
 *   that reports "flaky" as "green". Every wait in this suite is a Playwright
 *   expectation or a poll on observable state, never a fixed sleep.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  /** Compose build and the ~30 s representative run happen inside the suite. */
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 },
  globalSetup: './src/globalSetup.ts',
  globalTeardown: './src/globalTeardown.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { ...ACCEPTANCE_VIEWPORT },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-1920x1080',
      use: {
        browserName: 'chromium',
        viewport: { ...ACCEPTANCE_VIEWPORT },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
})
