import { readFileSync } from 'node:fs';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

const logic = readFileSync(new URL('./script.logic.lua', import.meta.url), 'utf8');

export default {
  model,
  luaScript: buildLuaScript(model, logic),
  modes: {
    // action: 'spin' → mode: 'SPIN' (toMathModes uppercases the action key)
    SPIN: {
      sim: { iterations: 50_000, bet: 1, rng: 'fast' },
      curate: {
        capMaxWin: model.spec.maxWin * 100,
        algorithm: 'tiered',
        targetRTP: 0.96,
        toleranceRTP: 0.02,
        targetCV: 5,
        toleranceCV: 3,
        targetHitRate: 0.25,
        toleranceHitRate: 0.1,
        nRowsOut: 20_000,
      },
    },
  },
} satisfies MathConfig;
