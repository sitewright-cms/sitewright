import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Gate the pure logic (PKCE/URL/parse, OAuth client, credential store, login
      // orchestration). The arg-dispatch entry point (bin.ts) is covered indirectly.
      include: ['src/pkce.ts', 'src/oauth.ts', 'src/credentials.ts', 'src/login.ts', 'src/session.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
