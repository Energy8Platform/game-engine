// Demonstrates: one game.spec.ts → createSlotGame host boot.
// Not run headless (Pixi init hangs); verified via `tsc --noEmit`.
import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';

createSlotGame({
  model,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
}).catch((err) => {
  console.error('[spec-slot] failed to start', err);
});
