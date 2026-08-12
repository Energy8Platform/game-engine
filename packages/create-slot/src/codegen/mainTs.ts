import type { Answers } from '../answers';

export function genMainTs(a: Answers): string {
  const stakeImport = a.stake ? `import adapter from './stake/adapter';\n` : '';
  const artubeLoaderImport = a.artube ? `import { LoaderViewController } from '@artube/loader';\n` : '';
  const stakeOpt = a.stake ? `  stake: { adapter },\n` : '';
  // Artube needs no per-game artifact: the game's backend (artube-server) owns the round shape, so
  // the loader IS the opt-in. The host classifies the launch, refuses a malformed one, and only
  // then constructs the bridge. The GAME passes the import so the specifier never ends up in
  // game-engine's own bundle (games without the dependency must still build).
  const artubeOpt = a.artube
    ? `  // Artube: enabled by the launch URL (?sessionId=…). Build with \`npm run build:artube\`;
  // the backend runs separately (\`artube-server --spin ./game.spin --sandbox --port 8080\`).
  artube: { load: () => import('@energy8platform/artube-bridge') },
  // Artube's own loading screen replaces the engine's CSS preloader (see artubeLoader above).
  // tapToStart/minDisplayTime are the host's own defaults, spelled out so the loading behaviour is
  // identical on every target — passing \`loading\` at all opts out of those defaults.
  ...(artubeLoader
    ? { loading: { externalOverlay: artubeLoader, tapToStart: false, minDisplayTime: 600 } }
    : {}),\n`
    : '';
  // Artube ships its own branded loading screen; `artubePartnerLoader` (vite.config.ts) injects it
  // into index.html so it is on screen before this bundle runs. Handing the engine the controller
  // suppresses OUR preloader and routes the same progress into theirs — one continuous overlay.
  const artubeLoaderSetup = a.artube
    ? `
// Artube's branded loading screen — the markup is injected into index.html by \`artubePartnerLoader\`
// (vite.config.ts), so it is already on screen when this runs. Only an Artube build has that
// markup, and the controller's constructor throws without it, so construct it only when it's there:
// every other target keeps the engine's own CSS preloader.
const artubeLoader = document.getElementById('loader') ? new LoaderViewController() : null;
`
    : '';
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { ScaleMode } from '@energy8platform/game-engine';
import { model } from './game.spec';
import { GameScene } from './scenes/GameScene';
import { IntroScene } from './scenes/IntroScene';
import { normalize } from './game/normalize';
import { i18n } from './i18n';
${artubeLoaderImport}${stakeImport}${artubeLoaderSetup}
createSlotGame({
  model,
  normalize,
  // Scenes in order — the first eligible one starts. 'intro' is skipped on a replay launch, so a
  // replay opens directly on the game scene.
  scenes: [
    { key: 'intro', scene: IntroScene, skipOnReplay: true },
    { key: 'game', scene: GameScene },
  ],
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  scaleMode: ScaleMode.FILL,
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
${stakeOpt}${artubeOpt}  shell: {
    // Per-game localisation map (english-as-key). Fill other languages in src/i18n.ts.
    i18n,
    // buy/ante cards + currency derive from the spec + initData.
    // Base game-info sections. Wrap player-facing copy in t(...) so restricted gambling words are
    // rewritten to social-casino vocabulary in social mode (t is the identity otherwise). The
    // built-in sections (max win, paytable, controls, disclaimer) and the spec's buy/ante card copy
    // are socialized automatically; t() is how YOUR custom copy joins in.
    gameInfo: (t) => ({
      sections: [
        {
          type: 'custom',
          title: t('How to Play'),
          html: \`<p>\${t('Spin the reels and match symbols to win. Buy the bonus to trigger free spins instantly.')}</p>\`,
        },
      ],
    }),
  },
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
}
