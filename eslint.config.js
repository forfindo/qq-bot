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
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // 允许名称以下划线 _ 开头的变量不使用
          varsIgnorePattern: '^_',
          // 允许函数参数以 _ 开头不使用
          argsIgnorePattern: '^_',
          // 解构出来的变量也生效
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
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
      curly: ['error', 'all']
    }
  }
);
