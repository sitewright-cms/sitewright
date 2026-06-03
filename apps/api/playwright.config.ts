import { defineConfig } from '@playwright/test';

// API-only E2E (no browser): exercises the deployed container over HTTP.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Serial: these specs run against ONE deployed container and several mutate GLOBAL instance
  // settings (admin/settings: hCaptcha, SMTP, stock keys, form modes) as the shared admin@e2e.test.
  // Parallel workers would race on that global state, so a single worker is required for isolation.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://dind.local:2003',
  },
});
