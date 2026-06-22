import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8platform/game-sdk',
  '@energy8platform/stake-bridge',
  '@energy8platform/platform-core',
  '@energy8platform/platform-core/game-spec',
  'zod',
];

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/stake-kit.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/stake-kit.umd.js', format: 'umd', name: 'StakeKit', sourcemap: true, exports: 'named' },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
