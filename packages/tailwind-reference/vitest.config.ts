import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // `generated.ts` is a single data literal with no executable branches — counting it drags the
      // ratio toward "100% of one statement" and says nothing about the code that reads it.
      exclude: ['src/generated.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
