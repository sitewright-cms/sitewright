import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Serial: these specs run against ONE deployed container and several mutate GLOBAL instance
  // settings (form modes, hCaptcha, stock keys), so parallel workers would race on that shared
  // state. A single worker keeps the run deterministic.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://dind.local:2003',
    // Deterministic motion: some specs assert keyframe animations (e.g. data-kenburns),
    // which are gated on prefers-reduced-motion: no-preference — don't inherit the host's.
    reducedMotion: 'no-preference',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
