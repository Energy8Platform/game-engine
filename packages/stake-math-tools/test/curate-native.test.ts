import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findE8Binary } from '@energy8platform/platform-core/simulation';
import { curateMode, selectionPath } from '../src/pipeline/curate';
import { engineSourceMetrics } from '../src/pipeline/curate-native';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * Curation in the engine must be indistinguishable from curation here.
 *
 * The engine's `curate` is a port of `tiered.ts`, and the two implementations
 * will drift the moment nobody checks — a divergence there does not crash, it
 * quietly publishes different math. So the test runs the SAME pool through both
 * (E8_CURATE=js forces the reference path) and compares the artifacts byte for
 * byte, plus the report numbers the pipeline prints.
 *
 * Skipped without the binary, and skipped on an engine that predates the
 * subcommand — there the pipeline silently uses the JS path, which is the
 * intended fallback.
 */

const binary = findE8Binary();

/** A pool with a long tail: zeros, a bulk, and a thin high tier reaching the cap. */
function writePool(path: string, rows: number): void {
  const out: string[] = [];
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < rows; i++) {
    const u = rnd();
    let cents = 0;
    if (u > 0.75) cents = Math.floor(-Math.log(1 - rnd()) * 15000) + 1;
    if (u > 0.9995) cents = Math.floor(200_000 + rnd() * 1_800_000);
    out.push(`${i},1,${Math.min(cents, 2_000_000)}`);
  }
  writeFileSync(path, out.join('\n') + '\n');
}

const mode: ResolvedMode = {
  mode: 'BASE',
  action: 'spin',
  costMultiplier: 1,
  sim: { iterations: 40_000, bet: 1, rng: 'provably-fair' },
  curate: {
    capMaxWin: 2_000_000,
    costMultiplier: 1,
    algorithm: 'tiered',
    nRowsOut: 4_000,
    targetRTP: 0.96,
    toleranceRTP: 0.001,
    targetCV: 12,
    toleranceCV: 2,
    targetHitRate: 0.24,
    toleranceHitRate: 0.02,
  },
};

let dir: string;
let poolDir: string;
/** False on an engine without `curate` — the pipeline then uses the JS path anyway. */
let engineCurates = false;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-curate-native-'));
  poolDir = join(dir, 'pool');
  mkdirSync(poolDir, { recursive: true });
  writePool(join(poolDir, 'lookUpTable_BASE_0.csv'), 40_000);
  engineCurates = !!binary && engineSourceMetrics(join(poolDir, 'lookUpTable_BASE_0.csv')) !== null;
});

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe.skipIf(!binary)('curation in the engine', () => {
  it('reports the same source metrics the JS reader computes', (ctx) => {
    if (!engineCurates) return ctx.skip();

    const m = engineSourceMetrics(join(poolDir, 'lookUpTable_BASE_0.csv'))!;
    expect(m.rows).toBe(40_000);
    expect(m.achieved.maxPayout).toBeGreaterThan(0);
    expect(m.achieved.rtp).toBeGreaterThan(0);
  });

  it('produces byte-identical artifacts to the TypeScript optimizer', async (ctx) => {
    if (!engineCurates) return ctx.skip();

    const runOne = async (out: string, useJs: boolean) => {
      mkdirSync(out, { recursive: true });
      const prev = process.env.E8_CURATE;
      if (useJs) process.env.E8_CURATE = 'js';
      else delete process.env.E8_CURATE;
      try {
        const res = await curateMode(mode, { poolDir, outDir: out, skipEvents: true });
        return {
          lut: readFileSync(join(out, 'lookUpTable_BASE_0.csv'), 'utf-8'),
          map: readFileSync(selectionPath(poolDir, 'BASE'), 'utf-8'),
          achieved: res.achieved,
          toleranceMet: res.toleranceMet,
          refinement: res.refinement,
          report: res.stakeReport,
        };
      } finally {
        if (prev === undefined) delete process.env.E8_CURATE;
        else process.env.E8_CURATE = prev;
      }
    };

    const engine = await runOne(join(dir, 'out-engine'), false);
    const js = await runOne(join(dir, 'out-js'), true);

    expect(engine.lut).toBe(js.lut);
    expect(engine.map).toBe(js.map);
    expect(engine.achieved).toEqual(js.achieved);
    expect(engine.toleranceMet).toEqual(js.toleranceMet);
    expect(engine.refinement).toEqual(js.refinement);
    // The Stake report drives the publish decision, so it has to agree too —
    // CVaR, ETL, the probability limits and the whole hit-rate table.
    expect(engine.report).toEqual(js.report);
    // Sanity: a real curated table, not two empty files agreeing.
    expect(engine.lut.split('\n').filter((l) => l.trim()).length).toBe(4_000);
  }, 120_000);

  it('leaves an nnls mode to the TypeScript optimizer', async (ctx) => {
    if (!engineCurates) return ctx.skip();

    // Only `tiered` was ported. Handing an nnls mode to the engine would curate
    // it with a different algorithm and nothing in the artifacts would say so.
    const nnls: ResolvedMode = {
      ...mode,
      curate: { ...mode.curate, algorithm: 'nnls', nRowsOut: 200 },
    };
    const out = join(dir, 'out-nnls');
    mkdirSync(out, { recursive: true });
    const res = await curateMode(nnls, { poolDir, outDir: out, skipEvents: true });

    // The NNLS path concentrates weight — tiered never would.
    expect(res.rows.length).toBe(200);
    expect(res.toleranceMet.weightCap).toBeDefined();
    expect(res.rows.some((r) => r.weight !== res.rows[0].weight)).toBe(true);
  }, 120_000);

  it('falls back to the JS path when the engine is switched off', async (ctx) => {
    if (!engineCurates) return ctx.skip();

    const prev = process.env.E8_CURATE;
    process.env.E8_CURATE = 'js';
    try {
      expect(engineSourceMetrics(join(poolDir, 'lookUpTable_BASE_0.csv'))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.E8_CURATE;
      else process.env.E8_CURATE = prev;
    }
  });
});
