import { defineConfig, devices } from '@playwright/test';

const port = '4173';

export default defineConfig({
  testDir: './e2e',
  // Measured (SwiftShader, 12 cores, 9.2b): 6 and 3 workers starve splitkv's page (timeout or card never visible); 2 passes in 13 s.
  workers: 2,
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
