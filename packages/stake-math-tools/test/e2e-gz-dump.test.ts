/**
 * Binary-gated end-to-end test for the gzipped pool dump.
 *
 * `e8 simulate -dump …/books_BASE.jsonl.gz` compresses as it writes, which is
 * the whole point: on a real game the raw dump is tens of GB and packing it
 * afterwards costs more wall clock than the math. What must hold is that the
 * compression changes NOTHING about the run — same seed, same rounds, same
 * bytes once inflated — and that the pipeline reads the archive straight
 * through into a lookUpTable.
 *
 * Skipped without the e8 binary; skipped with an engine that predates gzipped
 * dumps (it writes plain JSONL to the `.gz` path, which `normalizeDumpPath`
 * handles and `pool-gz-dump.test.ts` covers).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findE8Binary } from '@energy8platform/platform-core/simulation';
import { defineGame, buildSpinScript } from '@energy8platform/platform-core/game-spec';
import { resolveModes } from '../src/mathConfig';
import { runSim } from '../src/pipeline/sim';
import { finalizePool } from '../src/pipeline/pool';
import { isGzipFile } from '../src/pipeline/dump-io';
import type { MathConfig } from '../src/mathConfig';

const hasBinary = !!findE8Binary();

const model = defineGame({
  id: 'e2e-gz',
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
game "e2e-gz" {
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

// A fixed seed on both runs: the gz dump and the raw dump must be the SAME run.
const cfg: MathConfig = {
  model,
  runtime: 'spin',
  luaScript: buildSpinScript(model, logicSpin),
  modes: {
    BASE: {
      sim: {
        iterations: 3000,
        bet: 1,
        rng: 'provably-fair',
        seed: '6532652d677a2d64756d70000000000000000000000000000000000000abcd01',
      },
      curate: { capMaxWin: model.spec.maxWin * 100 },
    },
  },
};

let tmpDir: string;
let poolDir: string;
let gzDump: string;
let rawDump: string;
/** False on an engine that ignores the `.gz` extension — nothing to assert here. */
let engineGzips = false;

afterAll(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe.skipIf(!hasBinary)('e2e: gzipped -dump (binary required)', () => {
  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'e8-e2e-gz-'));
    poolDir = join(tmpDir, 'pool');
    mkdirSync(poolDir, { recursive: true });

    const base = resolveModes(cfg).find((m) => m.mode === 'BASE')!;
    gzDump = join(poolDir, 'books_BASE.jsonl.gz');
    rawDump = join(tmpDir, 'books_BASE.jsonl');
    await runSim(cfg, base, { dump: gzDump });
    engineGzips = isGzipFile(gzDump);
    if (engineGzips) await runSim(cfg, base, { dump: rawDump });
  });

  it('writes a real gzip archive that inflates to the raw dump byte for byte', (ctx) => {
    if (!engineGzips) return ctx.skip();

    expect(existsSync(gzDump)).toBe(true);
    // Same seed, same rounds: the container is the only difference.
    expect(gunzipSync(readFileSync(gzDump))).toEqual(readFileSync(rawDump));
    // The archive is worth having.
    expect(readFileSync(gzDump).length).toBeLessThan(readFileSync(rawDump).length / 2);
    // No worker part files left behind.
    expect(existsSync(`${gzDump}.part0`)).toBe(false);
  });

  it('finalizes the pool straight off the .gz — same LUT as from the raw dump', async (ctx) => {
    if (!engineGzips) return ctx.skip();

    const base = resolveModes(cfg).find((m) => m.mode === 'BASE')!;
    const rawPoolDir = join(tmpDir, 'raw-pool');
    mkdirSync(rawPoolDir, { recursive: true });

    const gz = await finalizePool(base, { poolDir, dumpPath: gzDump });
    process.env.POOL_ZSTD_LEVEL = '0';
    try {
      await finalizePool(base, { poolDir: rawPoolDir, dumpPath: rawDump });
    } finally {
      delete process.env.POOL_ZSTD_LEVEL;
    }

    expect(gz.rows).toBe(3000);
    expect(gz.books).toBe('books_BASE.jsonl.gz');
    expect(readFileSync(join(poolDir, 'lookUpTable_BASE_0.csv'), 'utf-8')).toBe(
      readFileSync(join(rawPoolDir, 'lookUpTable_BASE_0.csv'), 'utf-8'),
    );
  });
});
