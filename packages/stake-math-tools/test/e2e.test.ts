/**
 * Binary-gated end-to-end test: real Go binary sim → curate → Stake artifacts.
 *
 * Skipped when the native binary is not present (CI without the binary).
 * When present this test actually invokes the binary, verifies the real
 * RoundDumpRecord dump shape, and checks that curate produces valid artifacts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNativeBinary } from '@energy8platform/platform-core/simulation';
import { defineGame, buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { resolveModes } from '../src/mathConfig';
import { runSim } from '../src/pipeline/sim';
import { curateMode } from '../src/pipeline/curate';
import type { MathConfig } from '../src/mathConfig';

const hasBinary = !!findNativeBinary();

/** Trivial 1-action game model for the e2e. */
const model = defineGame({
  id: 'e2e-test',
  type: 'slot',
  grid: { cols: 3, rows: 3 },
  betLevels: [1],
  defaultBet: 1,
  maxWin: 1000,
  currency: 'EUR',
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 10 } },
    { id: 'B', kind: 'low', pay: { 3: 2 } },
  ],
  actions: {
    spin: { role: 'base' },
  },
});

/** Trivial Lua: always returns 0 or small win to produce a valid pool. */
const logicLua = `function execute(state)
  local roll = engine.random(1, 3)
  local win = 0
  if roll == 1 then win = PAYTABLE["A"][3] end
  return { total_win = win }
end
`;

// Note: action 'spin' with role 'base' → mode 'BASE' (Stake convention).
const cfg: MathConfig = {
  model,
  luaScript: buildLuaScript(model, logicLua),
  modes: {
    BASE: {
      sim: { iterations: 2000, bet: 1, rng: 'fast' },
      curate: {
        capMaxWin: model.spec.maxWin * 100, // cents
        algorithm: 'tiered',
        nRowsOut: 500,
        targetRTP: 0.5,
        toleranceRTP: 1.0,      // lenient — we just want it to converge
        targetCV: 5,
        toleranceCV: 100,
        targetHitRate: 0.3,
        toleranceHitRate: 1.0,
        requireMaxReached: false,
      },
    },
  },
};

let tmpDir: string;

afterAll(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe.skipIf(!hasBinary)('e2e: go-native sim → curate (binary required)', () => {
  let poolDir: string;
  let outDir: string;
  let dump: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'e8-e2e-'));
    poolDir = join(tmpDir, 'pool');
    outDir = join(tmpDir, 'out');
    mkdirSync(poolDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const resolved = resolveModes(cfg);
    const base = resolved.find((m) => m.mode === 'BASE')!;
    dump = join(poolDir, `books_BASE.jsonl`);
    await runSim(cfg, base, { dump });
  });

  it('pools then curates: sim writes dump + curate produces valid Stake artifacts', async () => {
    // ── 1. Dump assertions (was the first test) ──────────────────────────────
    expect(existsSync(dump)).toBe(true);

    const firstLine = readFileSync(dump, 'utf-8').split('\n').find((l) => l.trim());
    expect(firstLine).toBeTruthy();

    const rec = JSON.parse(firstLine!) as {
      spins?: { win_x?: number }[];
      total_win?: number;
      round_idx?: number;
    };

    // The dump record must have a spins array (real RoundDumpRecord shape).
    expect(Array.isArray(rec.spins)).toBe(true);
    expect(rec.spins!.length).toBeGreaterThan(0);

    // Each spin entry has a numeric win_x (bet-multiplier per spin).
    for (const sp of rec.spins!) {
      expect(typeof sp.win_x).toBe('number');
    }

    // ── 2. Curate assertions (was the second test) ────────────────────────────
    const resolved = resolveModes(cfg);
    const base = resolved.find((m) => m.mode === 'BASE')!;

    const result = await curateMode(base, { poolDir, outDir });

    // lookUpTable CSV exists with sim,weight,payoutCents lines.
    const csvPath = join(outDir, 'lookUpTable_BASE_0.csv');
    expect(existsSync(csvPath)).toBe(true);
    const csv = readFileSync(csvPath, 'utf-8').trim();
    const lines = csv.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parts = line.split(',');
      expect(parts).toHaveLength(3);
      for (const p of parts) expect(Number.isFinite(Number(p))).toBe(true);
    }

    // index.json has a BASE entry with name/cost/events/weights.
    const idxPath = join(outDir, 'index.json');
    expect(existsSync(idxPath)).toBe(true);
    const idx = JSON.parse(readFileSync(idxPath, 'utf-8')) as {
      modes: { name: string; cost: number; events: string; weights: string }[];
    };
    expect(Array.isArray(idx.modes)).toBe(true);
    const baseEntry = idx.modes.find((m) => m.name === 'BASE');
    expect(baseEntry).toBeDefined();
    expect(baseEntry!.events).toBe('books_BASE.jsonl.zst');
    expect(baseEntry!.weights).toBe('lookUpTable_BASE_0.csv');
    // spin action has no explicit cost → costMultiplier defaults to 1
    expect(baseEntry!.cost).toBe(1);

    // OptimizeResult has numeric rtp and non-negative payoutMultMax.
    expect(typeof result.achieved.rtp).toBe('number');
    expect(result.stakeReport.payoutMultMax).toBeGreaterThanOrEqual(0);
  });
});
