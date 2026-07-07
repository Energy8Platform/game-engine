import type { Answers } from '../answers';

export function genMathConfig(_a: Answers): string {
  return `import { readFileSync } from 'node:fs';
import { buildSpinScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

// node-only (the e8-math CLI runs in node) — reads the math via node:fs, not Vite raw imports.
const logic = readFileSync(new URL('./src/game/script.spin', import.meta.url), 'utf8');

export default {
  model,
  runtime: 'spin',
  luaScript: buildSpinScript(model, logic),
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
    // Feature modes. Only sim.iterations is set by default — the remaining sim params and all
    // curate targets fall back to seeded defaults (capMaxWin from spec.maxWin); tune as needed.
    BUY_BONUS: { sim: { iterations: 100_000 } },
    ANTE: { sim: { iterations: 100_000 } },
  },
} satisfies MathConfig;
`;
}
