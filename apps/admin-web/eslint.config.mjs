// App-local ESLint flat config. ESLint >= 10 uses the nearest config, so this file re-uses the root
// configuration and layers the React / hooks / fast-refresh rules on top of it.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

export default tseslint.config(
  ...rootConfig,
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Helpers are deliberately colocated with components; HMR still works for those files.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['vite.config.ts', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
