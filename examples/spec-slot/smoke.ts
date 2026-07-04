// examples/spec-slot/smoke.ts
// Proves: one spec drives BOTH the runtime LuaEngine path and the export path.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame, buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { LuaEngine } from '@energy8platform/platform-core/lua';
import { spec, model } from './game.spec.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const logic = readFileSync(resolve(__dirname, 'script.logic.lua'), 'utf8');

// 1) runtime path
const engine = new LuaEngine({
  script: buildLuaScript(model, logic),
  gameDefinition: model.gameDefinition,
  seed: 7,
});
const result = engine.execute({ action: 'spin', bet: 1 });
engine.destroy();
if (typeof result.totalWin !== 'number') throw new Error('spin did not return a numeric win');
console.log('runtime spin OK — totalWin =', result.totalWin);

// 2) export path — the E8 deliverables (config.json + self-contained script.lua)
const out = exportGame(spec, { logicLua: logic });
const distDir = resolve(__dirname, 'dist', 'game');
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, 'config.json'), out['config.json']);
writeFileSync(resolve(distDir, 'script.lua'), out['script.lua']);
const gd = JSON.parse(out['config.json']);
if (gd.id !== 'spec-slot' || gd.type !== 'SLOT') throw new Error('exported config.json malformed');
if (!gd.script_path) throw new Error('exported config.json missing script_path');
if (!out['script.lua'].includes('PAYTABLE')) throw new Error('exported script.lua missing prelude');
console.log('export OK — wrote dist/game/{config.json, script.lua}');
console.log('SMOKE PASS');
