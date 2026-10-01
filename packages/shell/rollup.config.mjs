import typescript from '@rollup/plugin-typescript';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('./src', import.meta.url));
const aliasPlugin = alias({ entries: [{ find: /^@\/(.*)$/, replacement: `${SRC}/$1` }] });

function bundle(input, name, external = []) {
  return {
    input, external,
    output: [
      { file: `dist/${name}.esm.js`, format: 'esm', sourcemap: true },
      { file: `dist/${name}.cjs.js`, format: 'cjs', sourcemap: true },
    ],
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false })],
  };
}

// The canonical social-mode dictionary is externalized (never inlined) so the chrome shares the
// single source of truth in @energy8platform/game-sdk/social with the game canvas and Stake bridge.
const SOCIAL = '@energy8platform/game-sdk/social';

const ENTRIES = {
  index: 'src/core/index.ts',
  html: 'src/ui/html/index.ts',
  pixi: 'src/ui/pixi/index.ts',
  'pixi-hb': 'src/ui/pixi-hb/index.ts',
  'pixi-s': 'src/ui/pixi-s/index.ts',
};

export default defineConfig([
  bundle(ENTRIES.index, 'index', [SOCIAL]),
  bundle(ENTRIES.html, 'html', [SOCIAL]),
  bundle(ENTRIES.pixi, 'pixi', ['pixi.js', SOCIAL]),
  bundle(ENTRIES['pixi-hb'], 'pixi-hb', ['pixi.js', SOCIAL]),
  bundle(ENTRIES['pixi-s'], 'pixi-s', ['pixi.js', SOCIAL]),
  // ONE declaration build for every entry: shared types (ShellController and its private
  // `renderer`) land in one chunk the entries import, so `/pixi-hb`'s Shell IS `/pixi`'s Shell. Built
  // per entry, each .d.ts inlined its own copy of the class, and TS treats classes with private
  // members nominally — `shellFactory: createPixiHbShell` failed against game-engine's ShellFactory.
  {
    input: ENTRIES,
    external: ['pixi.js', SOCIAL],
    output: { dir: 'dist', format: 'esm', entryFileNames: '[name].d.ts', chunkFileNames: 'types/[name]-[hash].d.ts' },
    plugins: [aliasPlugin, dts()],
  },
]);
