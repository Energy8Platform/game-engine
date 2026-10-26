import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const EXTERNAL = [/^pixi\.js/, /^@energy8platform\//];
const ENTRIES = { preloader: 'src/preloader/index.ts', shell: 'src/shell/index.ts' };

// One build for both entries, so the artwork both use lands in ONE shared chunk (a game that takes the
// loader and the shell downloads it once).
export default defineConfig([
  {
    input: ENTRIES,
    external: EXTERNAL,
    output: [
      { dir: 'dist', format: 'esm', sourcemap: true, entryFileNames: '[name].esm.js', chunkFileNames: 'chunks/[name]-[hash].esm.js' },
      { dir: 'dist', format: 'cjs', sourcemap: true, entryFileNames: '[name].cjs.js', chunkFileNames: 'chunks/[name]-[hash].cjs.js' },
    ],
    plugins: [typescript({ tsconfig: './tsconfig.build.json', declaration: false, declarationMap: false })],
  },
  {
    input: ENTRIES,
    external: EXTERNAL,
    output: { dir: 'dist', format: 'esm', entryFileNames: '[name].d.ts' },
    plugins: [dts()],
  },
]);
