import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { createHarness } from '@energy8platform/harness';
import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';

const target = process.env.BUILD_TARGET;
const isStake = target === 'stake';
const isHarness = target === 'stake-harness';

export default defineGameConfig({
  base: './',
  // Stake builds and harness run inside the Stake RGS shell — no local DevBridge.
  devBridge: !isStake && !isHarness,
  devBridgeConfig: './dev.config',
  vite: {
    server: { port: 5173 },
    optimizeDeps: { include: ['pixi.js'] },
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
