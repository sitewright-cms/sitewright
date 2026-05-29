import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only the pure TS units are covered here; `.astro` rendering is exercised
      // by the integration build test (test/build.test.ts).
      include: ['src/lib/**', 'src/blocks/props.ts', 'src/blocks/registry.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 80,
      },
    },
  },
});
