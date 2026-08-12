import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { createHarness } from '@energy8platform/harness';
import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';

const target = process.env.BUILD_TARGET;
const isStake = target === 'stake';
const isHarness = target === 'stake-harness';
const isArtube = target === 'artube';

// `npm run dev:artube` is ONE command. `artubePlugin` starts the game's own backend
// (`@energy8platform/artube-server`) as a child of the dev server — on a free port it picks itself,
// waiting until the backend actually serves — and points the `/api` proxy at it. In production
// Artube serves the game and its backend on ONE origin split by path (`/api/**` → backend) and the
// bridge derives its API base from the page's origin, so proxying `/api` keeps dev the same shape.
//
// Escape hatch: `ARTUBE_BACKEND=http://localhost:8080 npm run dev:artube` proxies at a backend you
// run yourself (debugging the server in an IDE), and starts nothing.
//
// The import is dynamic and lives INSIDE the Artube branch on purpose: `artube-server` is a
// dev-only, Node-side dependency, and a game that only ships to Energy8/Stake must never have to
// resolve it — a static import here would make an uninstalled package break every build.
export default async () => {
  const plugins = [
    ...(isArtube
      ? [
          (await import('@energy8platform/artube-server/vite')).artubePlugin({
            spinPath: './src/game/script.spin',
          }),
        ]
      : []),
    // The dev harness: a Stake RGS backend + the reel-config sidebar panel.
    ...(isHarness
      ? [
          createHarness({
            plugins: [
              stakeRgsPlugin({ config: './math.config.ts', booksDir: 'stake-math' }),
              reelDevtoolsPlugin(),
            ],
          }),
        ]
      : []),
  ];

  return defineGameConfig({
    base: './',
    // Stake builds and harness run inside the Stake RGS shell — no local DevBridge.
    // The Artube target drops it too, so `npm run dev:artube` develops against the REAL backend
    // (math on the server, /api proxied above) instead of local offline math.
    // What this flag does NOT do: change any production bundle. `devBridgePlugin` is `apply: 'serve'`,
    // so no `vite build` has ever injected the DevBridge bootstrapper — `BUILD_TARGET=artube vite
    // build` and a plain `vite build` emit the same bytes. In production what protects a
    // session-less launch is the host's gate (createSlotGame refuses to start), not this flag.
    devBridge: !isStake && !isHarness && !isArtube,
    devBridgeConfig: './dev.config',
    vite: {
      server: { port: 5173 },
      optimizeDeps: { include: ['pixi.js'] },
      // Artube's frontend CI takes the `dist` folder verbatim, so the Artube build IS `dist` — there
      // is deliberately no `dist-artube` for a pipeline that would never look at it. `build:artube`
      // wipes `dist` first: not a security matter (the bytes match a plain build), just so a previous
      // build's stale hashed assets don't ride along to the CDN.
      ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
      plugins,
    },
  });
};
