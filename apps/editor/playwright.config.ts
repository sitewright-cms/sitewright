import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://dind.local:2003';

/** The domain locally-hosted sites are served under — must match SW_SITES_DOMAIN on the slot. */
const SITES_DOMAIN = process.env.SW_E2E_SITES_DOMAIN ?? new URL(BASE_URL).hostname;

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
    baseURL: BASE_URL,
    // Locally-hosted sites serve at `<slug>.<SW_SITES_DOMAIN>` and `/sites/<slug>/` 301s there. The DinD
    // host has no wildcard DNS, so a browser following that redirect lands on a name it cannot resolve —
    // every spec that navigates to a published site died there. Map the wildcard back to the real host
    // (the port survives the redirect, so the slot's port is reached correctly).
    launchOptions: {
      args: [`--host-resolver-rules=MAP *.${SITES_DOMAIN} ${SITES_DOMAIN}`],
    },
    // Deterministic motion: some specs assert keyframe animations (e.g. data-kenburns),
    // which are gated on prefers-reduced-motion: no-preference — don't inherit the host's.
    reducedMotion: 'no-preference',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
