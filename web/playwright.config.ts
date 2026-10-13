import { defineConfig, devices } from '@playwright/test';

const port = '4173';

export default defineConfig({
  testDir: './e2e',
  // Measured (SwiftShader, 12 cores): with 6, 3 or 2 workers splitkv's page starves (never reaches the die
  // in 90 s) in about 1 full run in 2; 1 worker passed 3 of 3 in 4.1 min each.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Headless Chromium has no GPU; WebGL runs on SwiftShader (ADR 0006).
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  // Tests run against the production build in `test` mode: the deployed artifact plus
  // `window.__gpuviz`.
  webServer: {
    command: `pnpm build --mode test && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
