import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noBareNumbers from './eslint-rules/no-bare-numbers.js';

export default defineConfig([
  globalIgnores(['dist', 'test-results', 'playwright-report', 'src/wasm', 'eslint-rules/*.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // R16: a number reaches the screen through <Q> or <Num> (ADR 0022).
    files: ['src/**/*.tsx'],
    ignores: ['src/quantity/**'],
    plugins: { gpuviz: { rules: { 'no-bare-numbers': noBareNumbers } } },
    rules: { 'gpuviz/no-bare-numbers': 'error' },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
