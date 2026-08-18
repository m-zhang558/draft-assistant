import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const domainBoundary = {
  files: ['src/domain/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              'react',
              'react-dom',
              'zustand',
              '@/state',
              '@/features',
              '@/ui',
              '@/app',
              '@/data',
            ],
            message:
              'domain/ is pure TypeScript: no React, no Zustand, no I/O, no importing higher layers.',
          },
        ],
      },
    ],
  },
};

const uiBoundary = {
  files: ['src/ui/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/domain', '@/state', '@/features', '@/app'],
            message:
              'ui/ holds generic presentational primitives: it must not know about domain, state, features, or app.',
          },
        ],
      },
    ],
  },
};

const stateBoundary = {
  files: ['src/state/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/features', '@/app'],
            message:
              'state/ must not import from features/ or app/ — dependencies flow the other way.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Standalone Node ESM scripts (e.g. dataset generators) — no build step, no TS.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  domainBoundary,
  uiBoundary,
  stateBoundary,
  eslintConfigPrettier
);
