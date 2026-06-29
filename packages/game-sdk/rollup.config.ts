import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default defineConfig([
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/casino-game-sdk.esm.js',
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
    output: {
      file: 'dist/casino-game-sdk.umd.js',
      format: 'umd',
      name: 'CasinoGameSDK',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // Protocol sub-export (ESM)
  {
    input: 'src/protocol.ts',
    output: {
      file: 'dist/protocol.js',
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
  // Social sub-export (ESM) — canonical social-mode replacement dictionary
  {
    input: 'src/social.ts',
    output: {
      file: 'dist/social.js',
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
  // Bundled type declarations — main
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Bundled type declarations — protocol
  {
    input: 'src/protocol.ts',
    output: {
      file: 'dist/protocol.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Bundled type declarations — social
  {
    input: 'src/social.ts',
    output: {
      file: 'dist/social.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
]);
