import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8platform/game-sdk',
  '@energy8platform/game-sdk/protocol',
];

const globals = {
  '@energy8platform/game-sdk': 'CasinoGameSDK',
  '@energy8platform/game-sdk/protocol': 'CasinoGameSDKProtocol',
};

const ts = () => typescript({ tsconfig: './tsconfig.json', declaration: false });

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/artube-bridge.esm.js', format: 'esm', sourcemap: true },
    plugins: [ts()],
  },
  {
    input: 'src/index.ts',
    external,
    output: {
      file: 'dist/artube-bridge.umd.js', format: 'umd', name: 'ArtubeBridge',
      sourcemap: true, exports: 'named', globals,
    },
    plugins: [ts()],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.esm.js', format: 'esm', sourcemap: true },
    plugins: [ts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: {
      file: 'dist/detect.umd.js', format: 'umd', name: 'ArtubeBridgeDetect',
      sourcemap: true, exports: 'named', globals,
    },
    plugins: [ts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  // Artube's vendored loading-screen controller. Its own entry so a game's
  // main.ts can import it statically on EVERY target without dragging the
  // bridge (and the game-sdk) into a non-Artube bundle.
  {
    input: 'src/loader.ts',
    external,
    output: { file: 'dist/loader.esm.js', format: 'esm', sourcemap: true },
    plugins: [ts()],
  },
  {
    input: 'src/loader.ts',
    external,
    output: {
      file: 'dist/loader.umd.js', format: 'umd', name: 'ArtubeBridgeLoader',
      sourcemap: true, exports: 'named', globals,
    },
    plugins: [ts()],
  },
  {
    input: 'src/loader.ts',
    external,
    output: { file: 'dist/loader.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
