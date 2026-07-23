import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 2004 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    // Several UI tests await a lazy `import()` of the (large) icon chunk or an async API render. The
    // default 5s test timeout is tighter than their own waitFor/findBy polls and, under the full
    // parallel `turbo run test` load (many vitest workers oversubscribing CPU), that import can be
    // starved past 5s → a spurious "Test timed out in 5000ms". A generous global ceiling (above the
    // longest in-test waitFor/findBy poll) makes the suite load-tolerant without slowing the fast
    // path — quick tests still finish quickly; only the failure ceiling rises.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      // Gate the pure logic (API client + dataset/preview helpers). UI flows are covered
      // by the Playwright browser E2E against the deployed app.
      include: [
        'src/api.ts',
        'src/lib/entry-form.ts',
        'src/lib/live-target.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
