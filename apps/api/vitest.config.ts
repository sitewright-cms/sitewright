import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/server.ts', 'src/db/schema.ts'],
      reporter: ['text', 'lcov'],
      // Auth + tenant isolation are security-critical; gate high.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
