import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import unicorn from 'eslint-plugin-unicorn';

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(item => ({
    files: ['**/*.ts'],
    ...item
  })),
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts']
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: ['**/__tests__/**'],
    plugins: {
      unicorn
    },
    rules: {
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase'
        }
      ]
    }
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked
  },
  {
    ignores: ['dist/', 'node_modules/']
  },
  {
    rules: {
      ...prettierConfig.rules,
      curly: ['error', 'all'],
      '@typescript-eslint/ban-ts-comment': 'off'
    }
  }
);
