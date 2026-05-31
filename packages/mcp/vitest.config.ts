import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Gate the pure logic (REST client + tool wiring). The stdio entry point
      // (bin.ts) is exercised by the spawned end-to-end test, not unit-gated.
      include: ['src/client.ts', 'src/server.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
