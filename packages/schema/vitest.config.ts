import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      // This package is pure declarative Zod schemas, so `functions`/`branches`
      // are noisy here; gate on lines/statements (the standard 80% bar).
      // Logic-heavy packages (core, renderer) add branch/function gates.
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
