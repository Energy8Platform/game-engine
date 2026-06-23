import { builtinModules } from 'node:module';
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

// Node entry (the harness): externalise node builtins, `vite`, and ALL
// @energy8platform/* sub-paths (e.g. platform-core/lua) — never bundle them.
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const nodeExternal = [
  ...nodeBuiltins,
  'vite',
  /^@energy8platform\//,
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
  // ── harness (node-only) ──────────────────────────────────────────────
  {
    input: 'src/harness/index.ts',
    external: nodeExternal,
    output: { file: 'dist/harness.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  {
    input: 'src/harness/index.ts',
    external: nodeExternal,
    output: { file: 'dist/harness.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
