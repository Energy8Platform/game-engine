import type { Answers } from '../answers';

export function genMainTs(a: Answers): string {
  const stakeImport = a.stake ? `import adapter from './stake/adapter';\n` : '';
  const artubeLoaderImport = a.artube
    ? `import { createArtubeLoader } from '@energy8platform/artube-bridge/loader';\n`
    : '';
  const stakeOpt = a.stake ? `  stake: { adapter },\n` : '';
  // Artube needs no per-game artifact: the game's backend (artube-server) owns the round shape, so
  // the loader IS the opt-in. The host classifies the launch, refuses a malformed one, and only
  // then constructs the bridge. The GAME passes the import so the specifier never ends up in
  // game-engine's own bundle (games without the dependency must still build).
  const artubeOpt = a.artube
    ? `  // Artube: enabled by the launch URL (?sessionId=…). Build with \`npm run build:artube\`;
  // the backend runs separately (\`artube-server --spin ./game.spin --sandbox --port 8080\`).
  artube: { load: () => import('@energy8platform/artube-bridge') },
  // Artube's loader covers the gap this game cannot paint — bundle download, Pixi init, the SDK
  // handshake — and the engine dismisses it the moment ITS loading screen has painted. Nothing
  // else is set here on purpose: from that frame on, loading looks the same as on every other
  // target, so any loading options this game wants belong outside this branch.
  ...(artubeLoader ? { loading: { externalOverlay: artubeLoader } } : {}),\n`
    : '';
  // Artube ships its own branded loading screen; `artubePartnerLoader` (vite.config.ts) injects it
  // into index.html so it is on screen before this bundle runs. Handing the engine the controller
  // suppresses OUR preloader and routes the same progress into theirs — one continuous overlay.
  const artubeLoaderSetup = a.artube
    ? `
// Artube's branded loading screen — its markup is injected into index.html by \`artubePartnerLoader\`
// (vite.config.ts), so it is already on screen when this module runs. It covers the gap this game
// cannot paint (bundle, Pixi init, SDK handshake); the engine dismisses it once ITS loading screen
// has painted its first frame. Only an Artube build has that markup, so this is null everywhere
// else and every other target simply shows the engine's preloader from the start. The controller is
// Artube's own code, vendored into @energy8platform/artube-bridge — nothing to install from Artube.
const artubeLoader = createArtubeLoader();
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
