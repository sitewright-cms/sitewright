import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

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
    // @sitewright/core and the render-app's build-time code perform legitimate
    // dynamic property access (tree walks, dataset field lookups) where this rule
    // has a very high false-positive rate. Prototype-pollution is mitigated
    // structurally at the schema boundary (see @sitewright/schema `safeRecord`).
    // Future runtime packages (api, cli) keep the rule enabled.
    files: ['packages/core/**/*.ts', 'apps/render-app/src/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Trusted build-time file I/O: the project-format loader and the image
    // pipeline read/write files at known, operator-controlled paths. Not request-facing.
    files: ['apps/render-app/src/lib/project.ts', 'packages/image-pipeline/src/**/*.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
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
);
