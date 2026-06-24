import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curateMode } from '../src/pipeline/curate';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * Binary/zstd-INDEPENDENT curate test. We hand-write a raw pool dump in the
 * real Go `-dump` shape (RoundDumpRecord: one JSON object per line, with
 * `spins[].win_x` carrying the per-spin raw bet-multiplier win), run the
 * curate step against it, and assert on the Stake artifacts it writes.
 *
 * The `.zst` is NOT asserted here (zstd may be absent) — that's covered by
 * the binary-gated e2e. We only check the CSV + index.json + OptimizeResult.
 */

const CAP_X = 5000; // maxWin (bet-multiplier)

/** One raw RoundDumpRecord line with a single spin of the given bet-mult win. */
function roundLine(roundIdx: number, winX: number): string {
  return JSON.stringify({
    round_idx: roundIdx,
    worker_idx: 0,
    action: 'spin',
    bet: 1,
    cost_multiplier: 1,
    round_cost: 1,
    total_win: winX,
    total_win_x: winX,
    rng: { server_seed: 'deadbeef', client_seed: 'sim-worker-0' },
    spins: [{ spin_idx: 0, stage: 'base_game', nonce: 1, win: winX, win_x: winX, data: {} }],
  });
}

function makeFixture(): string {
  // 4000 rows: mostly zero, a band of small wins, a band of mid wins,
  // and one near-cap row — enough texture for the tiered optimizer to
  // produce a non-degenerate distribution with payoutMultMax > 0.
  const lines: string[] = [];
  let r = 0;
  for (let i = 0; i < 2800; i++) lines.push(roundLine(r++, 0)); // 70% zero
  for (let i = 0; i < 900; i++) lines.push(roundLine(r++, 1 + (i % 5))); // small 1..5x
  for (let i = 0; i < 299; i++) lines.push(roundLine(r++, 20 + (i % 50))); // mid 20..69x
  lines.push(roundLine(r++, 4900)); // one near-cap (≤ CAP_X)
  return lines.join('\n') + '\n';
}

const resolvedMode: ResolvedMode = {
  mode: 'BASE',
  action: 'spin',
  costMultiplier: 1,
  sim: { iterations: 4000, bet: 1, rng: 'provably-fair' },
  curate: {
    capMaxWin: CAP_X * 100, // CENTS
    costMultiplier: 1,
    // Small output + lenient tolerances so the optimizer converges fast on the fixture.
    nRowsOut: 300,
    targetRTP: 0.5,
    toleranceRTP: 1.0,
    targetCV: 5,
    toleranceCV: 100,
    targetHitRate: 0.3,
    toleranceHitRate: 0.5,
    algorithm: 'tiered',
    requireMaxReached: false,
  },
};

let dir: string;
let poolDir: string;
let outDir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'e8-curate-'));
  poolDir = join(dir, 'pool');
  outDir = join(dir, 'out');
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(poolDir, 'books_BASE.jsonl'), makeFixture());
});

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('curateMode', () => {
  it('writes lookUpTable_<MODE>_0.csv with sim,weight,payoutCents rows', async () => {
    const result = await curateMode(resolvedMode, { poolDir, outDir });

    const csvPath = join(outDir, 'lookUpTable_BASE_0.csv');
    expect(existsSync(csvPath)).toBe(true);
    const csv = readFileSync(csvPath, 'utf-8').trim();
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThan(0);
    // Every line is exactly three integer fields: sim,weight,payoutCents
    for (const line of lines) {
      const parts = line.split(',');
      expect(parts).toHaveLength(3);
      for (const p of parts) expect(Number.isFinite(Number(p))).toBe(true);
    }
    // CSV row count equals the optimized LUT row count.
    expect(lines.length).toBe(result.rows.length);
    // curate renumbers with its OWN 0-based contiguous sim ids (kitsune-style), not the sparse
    // pool sims the optimizer selected.
    const sims = lines.map((l) => Number(l.split(',')[0]));
    expect(sims).toEqual(sims.map((_, i) => i));
  });

  it('writes index.json with a rich BASE mode entry (name/cost/events/weights)', async () => {
    await curateMode(resolvedMode, { poolDir, outDir });

    const idxPath = join(outDir, 'index.json');
    expect(existsSync(idxPath)).toBe(true);
    const idx = JSON.parse(readFileSync(idxPath, 'utf-8')) as {
      modes: { name: string; cost: number; events: string; weights: string }[];
    };
    expect(Array.isArray(idx.modes)).toBe(true);
    const base = idx.modes.find((m) => m.name === 'BASE');
    expect(base).toBeDefined();
    expect(base!.cost).toBe(1);
    expect(base!.events).toBe('books_BASE.jsonl.zst');
    expect(base!.weights).toBe('lookUpTable_BASE_0.csv');
  });

  it('writes the raw books_<MODE>.jsonl with an events array per round (collected from the pool spins)', async () => {
    await curateMode(resolvedMode, { poolDir, outDir });
    // zstd may compress + remove the raw; read whichever exists.
    const rawBooks = join(outDir, 'books_BASE.jsonl');
    const zstBooks = join(outDir, 'books_BASE.jsonl.zst');
    let firstLine: string;
    if (existsSync(rawBooks)) {
      firstLine = readFileSync(rawBooks, 'utf-8').split('\n').find((l) => l.trim())!;
    } else {
      const { execFileSync } = await import('node:child_process');
      firstLine = execFileSync('zstd', ['-dc', '-q', zstBooks], { encoding: 'utf-8' }).split('\n').find((l) => l.trim())!;
    }
    const book = JSON.parse(firstLine) as { id: number; payoutMultiplier: number; events: { type: string; data: unknown }[] };
    expect(typeof book.id).toBe('number');
    expect(typeof book.payoutMultiplier).toBe('number');
    expect(Array.isArray(book.events)).toBe(true);
    expect(book.events.length).toBeGreaterThan(0); // each fixture round has ≥1 spin
    expect(book.events[0].type).toBe('spin'); // base_game stage → 'spin'
  });

  it('returns an OptimizeResult with a populated stakeReport and numeric rtp', async () => {
    const result = await curateMode(resolvedMode, { poolDir, outDir });
    expect(result.stakeReport.payoutMultMax).toBeGreaterThan(0);
    expect(typeof result.achieved.rtp).toBe('number');
  });
});
