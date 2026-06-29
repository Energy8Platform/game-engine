import typescript from '@rollup/plugin-typescript';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('./src', import.meta.url));
const aliasPlugin = alias({ entries: [{ find: /^@\/(.*)$/, replacement: `${SRC}/$1` }] });

function bundle(input, name, external = []) {
  return [
    {
      input, external,
      output: [
        { file: `dist/${name}.esm.js`, format: 'esm', sourcemap: true },
        { file: `dist/${name}.cjs.js`, format: 'cjs', sourcemap: true },
      ],
      plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false })],
    },
    { input, external, output: { file: `dist/${name}.d.ts`, format: 'esm' }, plugins: [aliasPlugin, dts()] },
  ];
}

export default defineConfig([
  ...bundle('src/core/index.ts', 'index'),
  ...bundle('src/ui/html/index.ts', 'html'),
  ...bundle('src/ui/pixi/index.ts', 'pixi', ['pixi.js']),
]);
