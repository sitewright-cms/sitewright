import { defineConfig } from '@playwright/test';

// API-only E2E (no browser): exercises the deployed container over HTTP.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://dind.local:2003',
  },
});
