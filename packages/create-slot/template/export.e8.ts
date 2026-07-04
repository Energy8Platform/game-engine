// export.e8.ts — generate the E8 platform deliverables from the single game spec.
//
//   npm run export:e8   →   dist/e8/{config.json, script.lua}
//
// config.json is the GameDefinition (platform fields only); script.lua is the self-contained Lua
// (auto-generated prelude ⧺ your script.logic.lua). Upload them to S3 as games/{id}/config.json
// and games/{id}/script.lua (see casino_platform game_development_guide.md).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '@energy8platform/platform-core/game-spec';
import { LuaEngine } from '@energy8platform/platform-core/lua';
import { spec } from './src/game.spec';

const root = fileURLToPath(new URL('.', import.meta.url));
const logic = readFileSync(resolve(root, 'src/game/script.logic.lua'), 'utf8');

// exportGame runs structural validation (well-formed config, script defines execute()).
const out = exportGame(spec, { logicLua: logic });
const config = JSON.parse(out['config.json']);

// Boot check: the exported script must load in a clean engine and resolve every non-session action
// (free spins need a live session, so they're exercised by the base spin that opens one).
const engine = new LuaEngine({ script: out['script.lua'], gameDefinition: config, seed: 1 });
for (const [action, def] of Object.entries(config.actions as Record<string, { requires_session?: boolean }>)) {
  if (def.requires_session) continue;
  try {
    engine.execute({ action, bet: spec.defaultBet ?? spec.betLevels[0] });
  } catch (e) {
    engine.destroy();
    throw new Error(`E8 export: action "${action}" threw on a clean boot — ${(e as Error).message}`);
  }
}
engine.destroy();

const outDir = resolve(root, 'dist/e8');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'config.json'), out['config.json']);
writeFileSync(resolve(outDir, 'script.lua'), out['script.lua']);
console.log(`E8 export OK → dist/e8/{config.json, script.lua}  (id=${config.id}, script_path=${config.script_path})`);
