import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const external = [
  'pixi.js',
  '@energy8platform/platform-core',
  '@energy8platform/platform-core/shell',
];

function createBundle(input, outputName) {
  return [
    {
      input,
      external,
      output: [
        { file: `dist/${outputName}.esm.js`, format: 'esm', sourcemap: true },
        { file: `dist/${outputName}.cjs.js`, format: 'cjs', sourcemap: true },
      ],
      plugins: [
        typescript({
          tsconfig: './tsconfig.json',
          declaration: false,
          declarationMap: false,
        }),
      ],
    },
    {
      input,
      external,
      output: { file: `dist/${outputName}.d.ts`, format: 'esm' },
      plugins: [dts()],
    },
  ];
}

export default defineConfig([...createBundle('src/index.ts', 'index')]);
