import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://dind.local:2003',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
