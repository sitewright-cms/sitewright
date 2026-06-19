import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      // Logic-heavy package: gate on branches and functions too.
      // Lines/statements/functions stay high; branches is set to 80 — the remaining
      // uncovered branches are defensive guards / near-unreachable fallbacks.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 80,
      },
    },
  },
});
