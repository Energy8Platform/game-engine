import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { createHarness } from '@energy8platform/harness';
import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';

const target = process.env.BUILD_TARGET;
const isStake = target === 'stake';
const isHarness = target === 'stake-harness';
const isArtube = target === 'artube';

// `artubePlugin` is ONE call site and both halves of the Artube target.
//
// DEV (`apply: 'serve'`) — `npm run dev:artube` is ONE command. The plugin starts the game's own
// backend (`@energy8platform/artube-server`) as a child of the dev server — on a free port it picks
// itself, waiting until the backend actually serves — and points the `/api` proxy at it. In
// production Artube serves the game and its backend at ONE address split by path (`/api/**` →
// backend), so proxying `/api` keeps dev the same shape.
//
// Where dev and production DIFFER is where the game is mounted, and it is the one thing not to
// hard-code. The dev server serves the game at `/`, so the proxy above is a bare `/api`; production
// mounts each game under a per-game PATH PREFIX (`https://dev.artube-888.live/artube-o7df8qem5k/`),
// where the same route is `<prefix>/api`. `artube-bridge` derives the backend address from the
// directory of the page it is running on — the root in dev, the prefix in production — so one build
// covers both. (Deriving it from the page's *origin* is exactly the bug that made the bridge work in
// dev and fail on every real deployment; fixed in artube-bridge@0.1.1.)
//
// BUILD (`apply: 'build'`) — `npm run build:artube` emits `dist-artube-server/`: the deployable
// backend, with THIS game's `.spin` copied into it byte-for-byte, a plain-JS entry point, a
// `package.json` and a `Dockerfile`. The plugin already knows the spin path (it hands it to the dev
// backend above), so it is the one place that cannot ship the frontend against one version of the
// math and the backend against another. `docker build` the directory as-is, or commit it into the
// server repo; see its README.
//
// Escape hatch: `ARTUBE_BACKEND=http://localhost:8080 npm run dev:artube` proxies at a backend you
// run yourself (debugging the server in an IDE), and starts nothing.
//
// `artubePartnerLoader` is Artube's OWN branded loading screen. It injects its markup into
// index.html, so the loader is painted before this game's bundle is even fetched — the property
// no JS-mounted preloader can have. It covers exactly that gap: `src/main.ts` hands the engine the
// matching controller, and the engine dismisses Artube's screen the moment its own loading screen
// has painted its first frame. Everything after that frame is the same on every target.
//
// It is Artube's code VENDORED into `@energy8platform/artube-server` (the Node half) and
// `@energy8platform/artube-bridge` (the browser half), so a game installs no Artube package, needs
// no private registry and no token. Both halves of the import below are dev-time Node-side: the
// dynamic, branch-local form is because `artube-server` is a devDependency an Energy8/Stake-only
// build must never have to resolve — a static import would make it break every build.
export default async () => {
  const artube = isArtube ? await import('@energy8platform/artube-server/vite') : null;

  const plugins = [
    ...(artube
      ? [
          artube.artubePlugin({ spinPath: './src/game/script.spin' }),
          artube.artubePartnerLoader(),
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
      // One folder per target, so no build can silently ship another target's bytes: `dist` (plain),
      // `dist-stake`, `dist-artube`. `build:artube` wipes its folders first so a previous build's
      // stale hashed assets don't ride along to the CDN.
      //
      // CONSEQUENCE: Artube's CI pipeline deploys the repo's `dist` folder (their hosting/devops
      // docs). A game built with `build:artube` therefore needs that pipeline pointed at
      // `dist-artube` — change the job's artifact path, or copy the folder in CI. That is the
      // accepted trade for keeping the two targets visibly separate.
      ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
      ...(isArtube ? { build: { outDir: 'dist-artube' } } : {}),
      plugins,
    },
  });
};
