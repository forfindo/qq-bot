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
    // sandbox.code.js 是交给 vm.runInContext 执行的脚本（非模块、非严格模式），
    // 且其中部分标识符只在 vm 内通过字符串调用（如 contextify），不适用常规 lint
    ignores: ['dist/', 'node_modules/', 'packages/sandbox/src/sandbox.code.js']
  },
  {
    rules: {
      ...prettierConfig.rules,
      curly: ['error', 'all'],
      'no-undefined': 'error'
    }
  }
);
