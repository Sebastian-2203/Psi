import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'off' },
  projects: [
    // Signs in a fictional persona once (password + TOTP) and stores the session for shell tests.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Enables the dev-only portal mode preview (?mode=child) on the production build.
      PORTAL_MODE_PREVIEW: '1',
      // Lets the production build deliver app emails to the LOCAL Mailpit (loopback only).
      E2E_LOCAL_MAIL: '1',
      // P1-21: production builds off Vercel must name the proxy mode. Local `next start` has no
      // proxy in front; `xff` with Next's own X-Forwarded-For (acceptable for local E2E only).
      TRUSTED_PROXY: process.env.TRUSTED_PROXY ?? 'xff',
    },
  },
});
