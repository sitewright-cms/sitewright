import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.astro/**', // Astro-generated types/content
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Catches injection foot-guns (eval, child_process, fs with tainted paths, etc.)
  // as runtime-bearing packages (api, renderer, cli) come online.
  security.configs.recommended,
  {
    // @sitewright/core performs legitimate dynamic property access (tree walks,
    // dataset field lookups) where this rule has a very high false-positive rate.
    // Prototype-pollution is mitigated structurally at the schema boundary (see
    // @sitewright/schema `safeRecord`). Runtime packages (api, cli) keep it enabled.
    files: ['packages/core/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Trusted build-time file I/O: the project-format loader, the media loader,
    // and the image pipeline read/write files at known, operator-controlled paths.
    files: [
      'packages/image-pipeline/src/optimize.ts',
    ],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    // Vendored component runtime ENTRIES (bundled for the browser by gen-vendor.mjs):
    // browser globals, and the same dynamic-index allowance as the equivalent inline
    // runtimes — they only ever index runtime-built arrays, never tenant objects.
    files: ['packages/blocks/vendor-src/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Node build scripts (plain ESM): provide Node globals and exempt their
    // trusted, operator-controlled file I/O.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Test files legitimately use dynamic property access and read fixtures /
    // build output from disk; they are not a runtime attack surface.
    files: ['**/*.test.ts'],
    rules: {
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    // Browser code run via page.evaluate (Playwright serializes the function source): the mechanical-nativizer
    // DOM walk + the fidelity-gate extract. Intentionally unchecked against the Node tsconfig (no DOM lib) and
    // indexes fixed property lists, not tenant objects — same allowance as the vendored browser runtimes above.
    files: ['apps/api/src/render/nativize-walk.ts', 'apps/api/src/render/fidelity-extract.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    // The clone-fidelity gate CLI tools are Node ESM scripts that ALSO embed browser-context functions
    // serialized into Playwright's page.evaluate (document/window/getComputedStyle/scroll*/timers) — so
    // they need BOTH global sets. They do trusted, operator-controlled file I/O (glob the .pnpm store,
    // write reports) and index runtime-built arrays, same allowance as the build scripts + browser runtimes.
    files: ['packages/site-import/tools/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      // Best-effort capture steps (font-ready waits, optional scrolls) intentionally swallow errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
