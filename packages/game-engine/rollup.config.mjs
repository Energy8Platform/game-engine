import { builtinModules } from 'node:module';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const external = [
  '@energy8platform/harness',
  '@energy8platform/harness/panel',
  'pixi.js',
  '@energy8platform/game-sdk',
  '@energy8platform/platform-core',
  '@energy8platform/platform-core/lua',
  '@energy8platform/platform-core/game-spec',
  '@energy8platform/platform-core/dev-bridge',
  '@energy8platform/platform-core/slot-result',
  '@energy8platform/platform-core/vite',
  '@energy8platform/platform-core/loading',
  '@energy8platform/shell',
  '@energy8platform/shell/html',
  '@energy8platform/shell/pixi',
  '@esotericsoftware/spine-pixi-v8',
  '@pixi/sound',
  'vite',
  'fengari',
  '@energy8platform/stake-bridge',
  '@energy8platform/stake-bridge/detect',
];

function createBundle(input, outputName, opts = {}) {
  return [
    {
      input,
      external,
      treeshake: opts.treeshake ?? true,
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
  ...createBundle('src/animation/index.ts', 'animation'),
  ...createBundle('src/debug/index.ts', 'debug'),
  ...createBundle('src/shell/index.ts', 'shell'),
  ...createBundle('src/vite/index.ts', 'vite'),
  ...createBundle('src/lua/index.ts', 'lua'),
  ...createBundle('src/game-spec/index.ts', 'game-spec'),
  // host inlines dynamic imports: createSlotGame lazy-imports internal modules (./slotPlay, ./shellConfig, ./replay); without this Rollup splits them into chunks that conflict with output.file. External deps (@energy8platform/shell, stake-bridge) stay lazy.
  ...createBundle('src/host/index.ts', 'host', { inlineDynamicImports: true, treeshake: false }),
  ...createBundle('src/slot/index.ts', 'slot'),
  // Reel devtools: browser barrel (bridge + shared builders, pixi-free).
  ...createBundle('src/slot/devtools/index.ts', 'devtools'),
  // Self-contained panel client the harness serves verbatim (no bare imports).
  ...createBundle('src/slot/devtools/panelClient.ts', 'reel-panel-client'),
  // Node-only harness plugin (reelDevtoolsPlugin) — externalise node builtins.
  {
    input: 'src/harness/index.ts',
    external: [...external, ...nodeBuiltins],
    output: [
      { file: 'dist/harness.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/harness.cjs.js', format: 'cjs', sourcemap: true },
    ],
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false })],
  },
  {
    input: 'src/harness/index.ts',
    external: [...external, ...nodeBuiltins],
    output: { file: 'dist/harness.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
