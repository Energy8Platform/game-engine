import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { createHarness } from '@energy8platform/harness';
import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';

const target = process.env.BUILD_TARGET;
const isStake = target === 'stake';
const isHarness = target === 'stake-harness';
const isArtube = target === 'artube';

// `npm run dev:artube` serves the FRONTEND only; the game's backend is a second process:
//   artube-server --spin ./game.spin --sandbox --port 8080
// In production Artube serves both under ONE origin, split by path (`/api/**` → backend), and the
// bridge derives its API base from the page's origin — so proxy /api in dev to keep the same shape.
const artubeBackend = process.env.ARTUBE_BACKEND ?? 'http://localhost:8080';

export default defineGameConfig({
  base: './',
  // Stake builds and harness run inside the Stake RGS shell — no local DevBridge.
  // The Artube target drops it too, so `npm run dev:artube` develops against the REAL backend
  // (math on the server, /api proxied below) instead of local offline math.
  // What this flag does NOT do: change any production bundle. `devBridgePlugin` is `apply: 'serve'`,
  // so no `vite build` has ever injected the DevBridge bootstrapper — `BUILD_TARGET=artube vite
  // build` and a plain `vite build` emit the same bytes. In production what protects a
  // session-less launch is the host's gate (createSlotGame refuses to start), not this flag.
  devBridge: !isStake && !isHarness && !isArtube,
  devBridgeConfig: './dev.config',
  vite: {
    server: {
      port: 5173,
      ...(isArtube
        ? { proxy: { '/api': { target: artubeBackend, ws: true, changeOrigin: true } } }
        : {}),
    },
    optimizeDeps: { include: ['pixi.js'] },
    // Artube's frontend CI takes the `dist` folder verbatim, so the Artube build IS `dist` — there
    // is deliberately no `dist-artube` for a pipeline that would never look at it. `build:artube`
    // wipes `dist` first: not a security matter (the bytes match a plain build), just so a previous
    // build's stale hashed assets don't ride along to the CDN.
    ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
    // The dev harness: a Stake RGS backend + the reel-config sidebar panel.
    ...(isHarness
      ? {
          plugins: [
            createHarness({
              plugins: [
                stakeRgsPlugin({ config: './math.config.ts', booksDir: 'stake-math' }),
                reelDevtoolsPlugin(),
              ],
            }),
          ],
        }
      : {}),
  },
});
