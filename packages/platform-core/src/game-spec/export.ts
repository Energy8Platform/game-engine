import type { GameSpec, GameModel } from './types';
import { defineGame } from './defineGame';

/** Compose the self-contained .spin: generated const prelude ⧺ author math. */
export function buildSpinScript(model: GameModel, logicSpin: string): string {
  return model.spinPrelude + '\n' + logicSpin;
}

/** The spin-runtime platform deliverables, keyed by on-disk filenames. */
export interface E8SpinBundle {
  /** GameDefinition JSON (engine_mode=spin) — S3: games/{id}/config.json. */
  'config.json': string;
  /** Self-contained SpinML (prelude ⧺ math) — S3: games/{id}/script.spin. */
  'script.spin': string;
}

/**
 * Produce the spin-runtime deliverables from one spec + the author's
 * `script.spin`. The platform routes engine_mode="spin" games to the e8
 * engine; script_path points at the uploaded .spin.
 */
export function exportGameSpin(spec: GameSpec, opts: { logicSpin: string }): E8SpinBundle {
  const model = defineGame(spec);
  const config = {
    ...(model.gameDefinition as unknown as Record<string, unknown>),
    engine_mode: 'spin',
    script_path: 'script.spin',
  };
  const script = buildSpinScript(model, opts.logicSpin);
  if (!/fn\s+execute\s*\(/.test(script)) {
    throw new Error('E8 spin export: script.spin does not define `fn execute(...)`');
  }
  return {
    'config.json': JSON.stringify(config, null, 2),
    'script.spin': script,
  };
}
