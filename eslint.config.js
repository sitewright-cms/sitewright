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
);
