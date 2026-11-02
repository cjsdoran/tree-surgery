// T-E2E-1: one full run in a real browser, with every /api call mocked (no model cost).
import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
// Set E2E_BASE_URL to run against an already-running site instead, eg the production build
// under `netlify serve` (which applies the real security headers): the /api mocks still apply.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external ? undefined : {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
