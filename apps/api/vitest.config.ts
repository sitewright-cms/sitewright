import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // server.ts + render-worker.ts are process entry points (forked/booted), exercised
      // by integration/E2E, not unit-imported.
      exclude: ['src/server.ts', 'src/db/schema.ts', 'src/render/render-worker.ts'],
      reporter: ['text', 'lcov'],
      // Auth + tenant isolation are security-critical; gate high on lines/functions (≥90).
      // `branches` is 80 (not 85) and `statements` is 89 (not 90): vitest 4's AST-aware v8
      // coverage counts conditionals/statements more granularly than vitest 2 did, so the
      // same suite measures ~82% branches and ~90% statements (were higher under the looser
      // counting) — a measurement recalibration, not a coverage regression. The uncovered
      // remainder is concentrated in SSE-streaming (deploy / AI-agent) and error-rollback
      // paths that need disproportionate mocking for near-zero real assurance. See task #123.
      thresholds: {
        lines: 90,
        statements: 89,
        functions: 90,
        branches: 80,
      },
    },
  },
});
