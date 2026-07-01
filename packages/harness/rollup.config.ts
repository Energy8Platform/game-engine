import { builtinModules } from 'node:module';
import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig([
  // ── node plugin entry (createHarness) ────────────────────────────────
  {
    input: 'src/index.ts',
    external: nodeBuiltins,
    output: { file: 'dist/harness.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/index.ts',
    external: nodeBuiltins,
    output: { file: 'dist/harness.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  // ── browser core client (self-contained, served verbatim) ────────────
  {
    input: 'src/client/index.ts',
    output: { file: 'dist/client.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  // ── panel contract (types for panel authors) ─────────────────────────
  {
    input: 'src/panel.ts',
    output: { file: 'dist/panel.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/panel.ts',
    output: { file: 'dist/panel.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
