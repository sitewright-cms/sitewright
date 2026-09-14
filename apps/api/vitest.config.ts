import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // ★ Above vitest's 5s default, for the same reason apps/editor raised its own (see that config):
    // under the full parallel `turbo run test` load every package's workers oversubscribe the CPU,
    // and a test that takes ~2.6s of its own work can be starved past 5s. `runtime-parity` — which
    // builds a publish AND a preview — was the one that tipped over, failing a forced full run and
    // passing alone seconds later. That is a scheduling artefact being reported as a broken build.
    // Costs the fast path nothing: a quick test still finishes quickly, only the failure ceiling moves.
    testTimeout: 20000,
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
