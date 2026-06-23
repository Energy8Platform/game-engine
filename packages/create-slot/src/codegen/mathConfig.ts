import type { Answers } from '../answers';

export function genMathConfig(_a: Answers): string {
  return `import { readFileSync } from 'node:fs';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

// node-only (the e8-math CLI runs in node) — reads the Lua via node:fs, not Vite raw imports.
const logic = readFileSync(new URL('./src/game/script.logic.lua', import.meta.url), 'utf8');

export default {
  model,
  luaScript: buildLuaScript(model, logic),
  // One block per Stake mode key. Tune sim iterations + curate targets per mode.
  // Missing modes use seeded defaults (see resolveModes in stake-math-tools).
  modes: {
    BASE: {
      sim: { iterations: 100_000, bet: 1, rng: 'provably-fair' },
      curate: {
        capMaxWin: model.spec.maxWin * 100, // cents (bet-multiplier × 100)
        algorithm: 'tiered',
        targetRTP: 0.96,
        toleranceRTP: 0.01,
        targetCV: 5,
        toleranceCV: 2,
        targetHitRate: 0.25,
        toleranceHitRate: 0.05,
        nRowsOut: 50_000, // keep nRowsOut < iterations
      },
    },
    // Uncomment and tune BUY_BONUS / ANTE blocks to override their defaults:
    // BUY_BONUS: { sim: { iterations: 100_000 }, curate: { targetRTP: 0.96 } },
  },
} satisfies MathConfig;
`;
}
