import { defineGameConfig } from '@energy8platform/game-engine/vite';

const isStake = process.env.BUILD_TARGET === 'stake';

export default defineGameConfig({
  base: './',
  // Stake builds run inside the Stake RGS shell — no local DevBridge, separate output dir.
  devBridge: !isStake,
  devBridgeConfig: './dev.config',
  vite: {
    server: { port: 5173 },
    optimizeDeps: { include: ['pixi.js'], exclude: ['fengari'] },
    ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
  },
});
