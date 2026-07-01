import type { Answers } from '../answers';

/**
 * Generate src/slot/reelConfig.ts — the presentational reel config the GameScene feeds
 * to createReelSystem, and the target of the harness "Reels" sidebar's live tuning.
 */
export function genReelConfig(a: Answers): string {
  const cascade = a.cascades === true;
  // Map the game's win mechanic to the reel system's presentational evaluation mode.
  const evaluation = a.mechanic === 'custom' ? 'lines' : a.mechanic;
  const cascadeLine = cascade ? `\n    cascade: { enabled: true },` : '';

  return `import { resolveReelConfig } from '@energy8platform/game-engine/slot';
import { model } from '../game.spec';

/**
 * Presentational reel config for the configurable reel system: cell geometry, motion,
 * anticipation, cascade, win FX and features. Board SHAPE (cols/rows) comes from the game
 * spec (the math source of truth), so it is set from there and NOT tuned live.
 *
 * Tune everything else LIVE in the harness "Reels" sidebar (\`npm run stake\`), then click
 * "Copy config" and paste the result over this object to persist your changes. Live edits
 * in the sidebar are ephemeral — they are lost on reload until you copy them back here.
 */
export const reelConfig = resolveReelConfig({
  grid: {
    cols: model.spec.grid.cols,
    rows: model.spec.grid.rows,
    cellSize: 110,
    gap: 6,
    evaluation: '${evaluation}',
  },${cascadeLine}
});
`;
}
