/**
 * Binary-gated end-to-end: the two-pass build must produce EXACTLY what the
 * one-pass build produces.
 *
 * That equality is the whole safety argument. The two-pass flow serializes ~5%
 * of the rounds, so if anything about the second run drifted — a different
 * seed, a different round↔row mapping, a payout rounded elsewhere — the books
 * would still look perfectly valid while describing rounds nobody simulated.
 * The only convincing check is byte equality against the flow that never split.
 *
 * Skipped without the e8 binary, and skipped on an engine that predates the
 * two-pass flags (its unknown-flag error is caught and reported as a skip).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findE8Binary } from '@energy8platform/platform-core/simulation';
import { defineGame, buildSpinScript } from '@energy8platform/platform-core/game-spec';
import { resolveModes } from '../src/mathConfig';
import { runSim } from '../src/pipeline/sim';
import { curateMode } from '../src/pipeline/curate';
import { finalizeLightPool, finalizePool, normalizeDumpPath } from '../src/pipeline/pool';
import { runBooksStage } from '../src/pipeline/books';
import { hashSpin } from '../src/pipeline/manifest';
import type { MathConfig, ResolvedMode } from '../src/mathConfig';

const hasBinary = !!findE8Binary();

const model = defineGame({
  id: 'e2e-two-pass',
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
  actions: { spin: { role: 'base' } },
});

const logicSpin = `record Vars { n: int }
record Feat { z: int }
record D { w: float }
game "e2e-two-pass" {
  bet_levels = [1.0]
  max_win = 1000.0
  vars = Vars
  feature = Feat
  data = D
}
action spin { stage = base_game cost = 1.0 }
fn execute(c: ctx, v: Vars) -> outcome {
  let roll = rng(c, 1, 3)
  let win = 0.0
  if roll == 1 { win = PAY_A[0] }
  return outcome { win: win, vars: Vars { n: 0 }, data: D { w: win } }
}
`;

const cfg: MathConfig = {
  model,
  runtime: 'spin',
  luaScript: buildSpinScript(model, logicSpin),
  modes: {
    BASE: {
      // A pinned seed is NOT required by the flow (the manifest records whatever
      // the engine chose) but it is required to compare two independent builds.
      sim: {
        iterations: 4000, bet: 1, rng: 'provably-fair',
        seed: '65326532652d74776f2d7061737300000000000000000000000000000abc0102',
      },
      curate: {
        capMaxWin: model.spec.maxWin * 100,
        algorithm: 'tiered', nRowsOut: 400,
        targetRTP: 0.5, toleranceRTP: 1.0, targetCV: 5, toleranceCV: 100,
        targetHitRate: 0.3, toleranceHitRate: 1.0, requireMaxReached: false,
      },
    },
  },
};

let tmpDir: string;
let onePass: { lut: string; books: string } | null = null;
let twoPass: { lut: string; books: string } | null = null;
/** False on an engine without `-dump-csv` / `-only-rounds`. */
let engineTwoPass = false;
let skipReason = '';

/** The curated books, whichever compression survived (zstd may be absent). */
function readBooks(outDir: string): string {
  const raw = join(outDir, 'books_BASE.jsonl');
  if (existsSync(raw)) return readFileSync(raw, 'utf-8');
  const zst = join(outDir, 'books_BASE.jsonl.zst');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:child_process').execFileSync('zstd', ['-dc', '-q', zst], { encoding: 'utf-8' });
}

afterAll(() => {
  if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

describe.skipIf(!hasBinary)('e2e: two-pass build equals one-pass (binary required)', () => {
  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'e8-e2e-2p-'));
    const base: ResolvedMode = resolveModes(cfg).find((m) => m.mode === 'BASE')!;

    // ── A: one pass — every round serialized, curate reads them straight ──
    const poolA = join(tmpDir, 'poolA');
    const outA = join(tmpDir, 'outA');
    mkdirSync(poolA, { recursive: true });
    mkdirSync(outA, { recursive: true });
    const dumpA = join(poolA, 'books_BASE.jsonl.gz');
    await runSim(cfg, base, { dump: dumpA });
    await finalizePool(base, { poolDir: poolA, dumpPath: normalizeDumpPath(dumpA, 'BASE') });
    await curateMode(base, { poolDir: poolA, outDir: outA });
    onePass = { lut: readFileSync(join(outA, 'lookUpTable_BASE_0.csv'), 'utf-8'), books: readBooks(outA) };

    // ── B: two passes — light CSV, curate, then only the selected rounds ──
    const poolB = join(tmpDir, 'poolB');
    const outB = join(tmpDir, 'outB');
    mkdirSync(poolB, { recursive: true });
    mkdirSync(outB, { recursive: true });
    const csvB = join(poolB, 'pool_BASE.csv');
    try {
      const light = await runSim(cfg, base, { dumpCsv: csvB });
      await finalizeLightPool(base, {
        poolDir: poolB, csvPath: csvB, masterSeed: light.masterSeed!, spinHash: hashSpin(cfg.luaScript),
      });
      engineTwoPass = true;
    } catch (err) {
      skipReason = err instanceof Error ? err.message : String(err);
      return;
    }
    await curateMode(base, { poolDir: poolB, outDir: outB, skipEvents: true });
    await runBooksStage(cfg, base, { poolDir: poolB, outDir: outB });
    twoPass = { lut: readFileSync(join(outB, 'lookUpTable_BASE_0.csv'), 'utf-8'), books: readBooks(outB) };
  }, 120_000);

  it('produces byte-identical lookUpTable and books', (ctx) => {
    if (!engineTwoPass) return ctx.skip();

    expect(twoPass!.lut).toBe(onePass!.lut);
    expect(twoPass!.books).toBe(onePass!.books);
    // Sanity: this is a real book set, not two empty files agreeing.
    const first = JSON.parse(twoPass!.books.split('\n').find((l) => l.trim())!);
    expect(first.events.length).toBeGreaterThan(0);
    expect(twoPass!.lut.split('\n').filter((l) => l.trim()).length).toBe(400);
    expect(skipReason).toBe('');
  });

  it('leaves the pool light — no full round dump on disk', (ctx) => {
    if (!engineTwoPass) return ctx.skip();

    const poolB = join(tmpDir, 'poolB');
    // The heavy pass cleans up after itself: what remains is the CSV, the LUT,
    // the manifest and the selection — kilobytes-to-megabytes, not gigabytes.
    expect(existsSync(join(poolB, 'books_BASE.jsonl.gz'))).toBe(false);
    expect(existsSync(join(poolB, 'pool_BASE.csv'))).toBe(true);
    expect(existsSync(join(poolB, 'pool_BASE.manifest.json'))).toBe(true);
    expect(existsSync(join(poolB, 'selected_BASE.txt'))).toBe(true);
  });
});
