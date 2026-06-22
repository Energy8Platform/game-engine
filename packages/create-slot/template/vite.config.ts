import { defineGameConfig } from '@energy8platform/game-engine/vite';

export default defineGameConfig({
  base: './',
  devBridge: true,
  devBridgeConfig: './dev.config',
  vite: { server: { port: 5173 }, optimizeDeps: { include: ['pixi.js'], exclude: ['fengari'] } },
});
