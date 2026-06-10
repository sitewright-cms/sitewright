import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Gate the pure logic (PKCE/URL/parse, OAuth client, credential store, login
      // orchestration). The arg-dispatch entry point (bin.ts) is covered indirectly.
      include: [
        'src/pkce.ts',
        'src/oauth.ts',
        'src/credentials.ts',
        'src/login.ts',
        'src/session.ts',
        'src/device.ts',
        'src/connect.ts',
      ],
      reporter: ['text', 'lcov'],
      // `branches` is 75, not 80: vitest 4's AST-aware v8 coverage counts conditionals
      // more granularly than vitest 2 did, so the same suite measures ~77% branches
      // (the residual is interactive device/OAuth error paths) — a measurement
      // recalibration, not a coverage regression. See task #123.
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 75 },
    },
  },
});
