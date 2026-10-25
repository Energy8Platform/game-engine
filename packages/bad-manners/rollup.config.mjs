import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const EXTERNAL = [/^pixi\.js/, /^@energy8platform\//];
const ENTRIES = { preloader: 'src/preloader/index.ts', shell: 'src/shell/index.ts' };

export default defineConfig([
  ...Object.entries(ENTRIES).map(([name, input]) => ({
    input,
    external: EXTERNAL,
    output: [
      { file: `dist/${name}.esm.js`, format: 'esm', sourcemap: true },
      { file: `dist/${name}.cjs.js`, format: 'cjs', sourcemap: true },
    ],
    plugins: [typescript({ tsconfig: './tsconfig.build.json', declaration: false, declarationMap: false })],
  })),
  {
    input: ENTRIES,
    external: EXTERNAL,
    output: { dir: 'dist', format: 'esm', entryFileNames: '[name].d.ts' },
    plugins: [dts()],
  },
]);
