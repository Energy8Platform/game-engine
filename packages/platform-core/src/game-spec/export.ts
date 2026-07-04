import type { GameSpec, GameModel } from './types';
import { defineGame } from './defineGame';

/** Compose the self-contained Lua the platform runs: generated prelude ⧺ author logic. */
export function buildLuaScript(model: GameModel, logicLua: string): string {
  return model.luaPrelude + '\n' + logicLua;
}

/** The two E8-platform deliverables, keyed by their on-disk filenames. */
export interface E8Bundle {
  /** GameDefinition JSON — uploaded to S3 as `games/{id}/config.json`. */
  'config.json': string;
  /** Self-contained Lua (prelude ⧺ logic) — uploaded to S3 as `games/{id}/script.lua`. */
  'script.lua': string;
}

/**
 * Produce the E8 platform deliverables from one spec + the author's `script.logic.lua`.
 * The config carries `script_path` so the platform can locate the uploaded script; the script is
 * the prelude-prepended, self-contained source. Structurally validated before returning.
 */
export function exportGame(spec: GameSpec, opts: { logicLua: string }): E8Bundle {
  const model = defineGame(spec);
  const bundle: E8Bundle = {
    'config.json': JSON.stringify(model.gameDefinition, null, 2),
    'script.lua': buildLuaScript(model, opts.logicLua),
  };
  validateE8Bundle(bundle);
  return bundle;
}

/**
 * Structural (fengari-free) checks that catch the obvious ways an export is unusable before it
 * reaches the platform: malformed config, missing `script_path`/`actions`, or a script with no
 * `execute` entry point. A full boot check (running the script in a LuaEngine) is the caller's job.
 */
export function validateE8Bundle(bundle: E8Bundle): void {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(bundle['config.json']);
  } catch (e) {
    throw new Error(`E8 export: config.json is not valid JSON — ${(e as Error).message}`);
  }
  if (!config.id || typeof config.id !== 'string') throw new Error('E8 export: config.json missing "id"');
  if (config.type !== 'SLOT' && config.type !== 'TABLE') throw new Error('E8 export: config.json "type" must be SLOT or TABLE');
  if (!config.script_path) throw new Error('E8 export: config.json missing "script_path"');
  if (!config.actions || typeof config.actions !== 'object' || Object.keys(config.actions as object).length === 0) {
    throw new Error('E8 export: config.json has no actions');
  }
  if (!/function\s+execute\s*\(/.test(bundle['script.lua'])) {
    throw new Error('E8 export: script.lua does not define a global `execute(state)` function');
  }
}
