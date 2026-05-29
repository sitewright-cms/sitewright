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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Catches injection foot-guns (eval, child_process, fs with tainted paths, etc.)
  // as runtime-bearing packages (api, renderer, cli) come online.
  security.configs.recommended,
  {
    // Scoped to @sitewright/core only: it performs legitimate dynamic property
    // access (tree walks, dataset field lookups) where this rule has a very high
    // false-positive rate. Prototype-pollution is mitigated structurally at the
    // schema boundary (see @sitewright/schema `safeRecord`). Future runtime
    // packages (api, cli, renderer) keep the rule enabled.
    files: ['packages/core/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
);
