import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8platform/game-sdk',
  '@energy8platform/game-sdk/protocol',
  '@energy8platform/game-sdk/social',
];

export default defineConfig([
  // ESM build
  {
    input: 'src/index.ts',
    external,
    output: {
      file: 'dist/stake-bridge.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // UMD build
  {
    input: 'src/index.ts',
    external,
    output: {
      file: 'dist/stake-bridge.umd.js',
      format: 'umd',
      name: 'StakeBridge',
      sourcemap: true,
      exports: 'named',
      globals: {
        '@energy8platform/game-sdk': 'CasinoGameSDK',
        '@energy8platform/game-sdk/protocol': 'CasinoGameSDKProtocol',
        '@energy8platform/game-sdk/social': 'CasinoGameSDKSocial',
      },
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // Bundled type declarations
  {
    input: 'src/index.ts',
    external,
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // detect ESM
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  // detect UMD
  {
    input: 'src/detect.ts',
    external,
    output: {
      file: 'dist/detect.umd.js',
      format: 'umd',
      name: 'StakeBridgeDetect',
      sourcemap: true,
      exports: 'named',
      globals: {
        '@energy8platform/game-sdk': 'CasinoGameSDK',
        '@energy8platform/game-sdk/protocol': 'CasinoGameSDKProtocol',
        '@energy8platform/game-sdk/social': 'CasinoGameSDKSocial',
      },
    },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  // detect type declarations
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
