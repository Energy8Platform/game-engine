import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

// A predicate, not a fixed list: platform-core and stake-bridge are reached only through their
// subpaths ('@energy8platform/platform-core/dev-bridge', '.../stake-bridge/...'), never their bare
// package names. An exact-match list would miss those subpaths — Rollup would then fall through to
// its default "can't resolve, so warn and treat as external" behaviour, which happens to be safe
// today only because no resolver plugin is configured. Add one later (@rollup/plugin-node-resolve)
// and an unmatched subpath gets resolved and INLINED into the runtime bundle, silently defeating the
// entire reason platform-core/stake-bridge stay behind a dynamic import: they are optional peers.
const external = (id) =>
  id === '@energy8engine/kernel' ||
  id.startsWith('@energy8platform/') ||
  id.startsWith('node:');

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
  {
    input: 'src/vite/projectPlugin.ts',
    external,
    output: { file: 'dist/vite.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/vite/projectPlugin.ts',
    external,
    output: { file: 'dist/vite.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
