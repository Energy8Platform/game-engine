import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const external = [
  'pixi.js',
  '@energy8platform/game-sdk',
  '@energy8platform/platform-core',
  '@energy8platform/platform-core/lua',
  '@energy8platform/platform-core/game-spec',
  '@energy8platform/platform-core/dev-bridge',
  '@energy8platform/platform-core/shell',
  '@energy8platform/platform-core/slot-result',
  '@energy8platform/platform-core/vite',
  '@energy8platform/platform-core/loading',
  '@esotericsoftware/spine-pixi-v8',
  '@pixi/sound',
  'vite',
  'react',
  'react-dom',
  'react-reconciler',
  'react-reconciler/constants',
  'react/jsx-runtime',
  'fengari',
  '@energy8platform/stake-bridge',
  '@energy8platform/stake-bridge/detect',
];

function createBundle(input, outputName, opts = {}) {
  return [
    {
      input,
      external,
      output: [
        {
          file: `dist/${outputName}.esm.js`,
          format: 'esm',
          sourcemap: true,
          inlineDynamicImports: opts.inlineDynamicImports ?? false,
        },
        {
          file: `dist/${outputName}.cjs.js`,
          format: 'cjs',
          sourcemap: true,
          inlineDynamicImports: opts.inlineDynamicImports ?? false,
        },
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
      output: {
        file: `dist/${outputName}.d.ts`,
        format: 'esm',
        inlineDynamicImports: opts.inlineDynamicImports ?? false,
      },
      plugins: [dts()],
    },
  ];
}

export default defineConfig([
  ...createBundle('src/index.ts', 'index'),
  ...createBundle('src/core/index.ts', 'core'),
  ...createBundle('src/assets/index.ts', 'assets'),
  ...createBundle('src/audio/index.ts', 'audio'),
  ...createBundle('src/ui/index.ts', 'ui'),
  ...createBundle('src/animation/index.ts', 'animation'),
  ...createBundle('src/debug/index.ts', 'debug'),
  ...createBundle('src/shell/index.ts', 'shell'),
  ...createBundle('src/vite/index.ts', 'vite'),
  ...createBundle('src/react/index.ts', 'react'),
  ...createBundle('src/react/jsx-runtime.ts', 'react-jsx'),
  ...createBundle('src/lua/index.ts', 'lua'),
  ...createBundle('src/game-spec/index.ts', 'game-spec'),
  // host inlines dynamic imports: createSlotGame lazy-imports internal modules (./slotPlay, ./shellConfig, ./replay); without this Rollup splits them into chunks that conflict with output.file. External deps (platform-core/shell, stake-bridge) stay lazy.
  ...createBundle('src/host/index.ts', 'host', { inlineDynamicImports: true }),
  ...createBundle('src/slot/index.ts', 'slot'),
]);
