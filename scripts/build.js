import alias from '@rollup/plugin-alias';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import path from 'node:path';

/** @type {import('rollup').RollupOptions} */
export function genRollupConfig(pkg, __dirname) {
  return [
    {
      input: 'src/index.ts',
      output: {
        dir: 'dist',
        format: 'esm',
        preserveModules: true,
        preserveModulesRoot: 'src'
      },
      external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        /^node:/
      ],
      plugins: [
        alias({
          entries: [{ find: '@', replacement: path.resolve(__dirname, 'src') }]
        }),
        nodeResolve({
          extensions: ['.ts', '.js'],
          preferBuiltins: true
        }),
        esbuild({
          tsconfig: path.resolve(__dirname, 'tsconfig.json'),
          sourceMap: false,
          minify: false,
          loaders: { '.md': 'text' }
        })
      ]
    },
    {
      input: 'src/index.ts',
      output: {
        dir: 'dist',
        format: 'esm',
        preserveModules: true,
        preserveModulesRoot: 'src'
      },
      external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        /^node:/
      ],
      plugins: [
        dts({
          tsconfig: path.resolve(__dirname, 'tsconfig.json')
        })
      ]
    }
  ];
}
