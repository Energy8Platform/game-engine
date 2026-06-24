import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { stakeHarnessPlugin } from '@energy8platform/stake-kit/harness';

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
    optimizeDeps: { include: ['pixi.js'], exclude: ['fengari'] },
    ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
    ...(isHarness ? { plugins: [stakeHarnessPlugin({ config: './math.config.ts', booksDir: 'stake-math' })] } : {}),
  },
});
