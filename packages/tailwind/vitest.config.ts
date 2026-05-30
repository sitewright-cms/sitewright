import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The Tailwind compile is native-backed and slower than a unit test.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 90,
        branches: 75,
      },
    },
  },
});
