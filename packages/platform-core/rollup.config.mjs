import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const external = [
  '@energy8platform/game-sdk',
  'fengari',
  'fengari-web',
  'vite',
  // Node built-ins used by simulation runners
  'worker_threads',
  'os',
  'url',
  'path',
  'child_process',
  'fs',
  'fs/promises',
  'crypto',
];

function createBundle(input, outputName) {
  return [
    {
      input,
      external,
      output: [
        {
          file: `dist/${outputName}.esm.js`,
          format: 'esm',
          sourcemap: true,
        },
        {
          file: `dist/${outputName}.cjs.js`,
          format: 'cjs',
          sourcemap: true,
        },
      ],
      plugins: [
        typescript({
          tsconfig: './tsconfig.json',
          declaration: false,
          declarationMap: false,
        }),
      ],
    },
    {
      input,
      external,
      output: {
        file: `dist/${outputName}.d.ts`,
        format: 'esm',
      },
      plugins: [dts()],
    },
  ];
}

export default defineConfig([
  ...createBundle('src/index.ts', 'index'),
  ...createBundle('src/lua/index.ts', 'lua'),
  ...createBundle('src/simulation/index.ts', 'simulation'),
  ...createBundle('src/dev-bridge/index.ts', 'dev-bridge'),
  ...createBundle('src/vite/index.ts', 'vite'),
  ...createBundle('src/loading/index.ts', 'loading'),
  ...createBundle('src/shell/index.ts', 'shell'),
]);
