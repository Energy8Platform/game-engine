// Demonstrates: one game.spec.ts → createSlotGame host boot.
// Not run headless (Pixi init hangs); verified via `tsc --noEmit`.
import { createSlotGame } from '@energy8platform/game-engine/host';
import { ScaleMode } from '@energy8platform/game-engine';
import { model } from './game.spec';
import { GameScene } from './GameScene';
import { normalize } from './normalize';
import { IntroScene } from './scenes/IntroScene';

createSlotGame({
  model,
  normalize,
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
  shell: {}, // buy/ante cards + currency derive from the spec + initData
}).catch((err) => { console.error('[spec-slot] failed to start', err); });
