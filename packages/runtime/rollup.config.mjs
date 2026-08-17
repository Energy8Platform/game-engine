import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8engine/kernel',
  '@energy8platform/platform-core',
  '@energy8platform/stake-bridge',
  'node:fs',
  'node:path',
];

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
