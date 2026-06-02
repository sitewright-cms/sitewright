import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 2004 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Gate the pure logic (API client + dataset/preview helpers). UI flows are covered
      // by the Playwright browser E2E against the deployed app.
      include: [
        'src/api.ts',
        'src/lib/entry-form.ts',
        'src/lib/live-target.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
