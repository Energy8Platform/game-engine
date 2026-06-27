import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

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
    { input, external, output: { file: `dist/${name}.d.ts`, format: 'esm' }, plugins: [dts()] },
  ];
}

export default defineConfig([
  ...bundle('src/core/index.ts', 'index'),
  ...bundle('src/ui/html/index.ts', 'html'),
  ...bundle('src/ui/pixi/index.ts', 'pixi', ['pixi.js']),
]);
