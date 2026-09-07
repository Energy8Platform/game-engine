import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizePool } from '../src/pipeline/pool';
import { curateMode } from '../src/pipeline/curate';
import type { ResolvedMode } from '../src/mathConfig';

const CAP_X = 5000;
const hasZstd = (() => {
  try { execFileSync('zstd', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

function roundLine(roundIdx: number, winX: number): string {
  return JSON.stringify({
    round_idx: roundIdx, worker_idx: 0, action: 'spin', bet: 1,
    cost_multiplier: 1, round_cost: 1, total_win: winX, total_win_x: winX,
    spins: [{ spin_idx: 0, stage: 'base_game', nonce: 1, win: winX, win_x: winX, data: {} }],
  });
}

function makeFixture(): string {
  const lines: string[] = [];
  let r = 0;
  for (let i = 0; i < 60; i++) lines.push(roundLine(r++, 0));
  for (let i = 0; i < 30; i++) lines.push(roundLine(r++, 1 + (i % 5)));
  for (let i = 0; i < 9; i++) lines.push(roundLine(r++, 20 + i));
  lines.push(roundLine(r++, 4900));
  return lines.join('\n') + '\n';
}

const mode: ResolvedMode = {
  mode: 'BASE', action: 'spin', costMultiplier: 1,
  sim: { iterations: 100, bet: 1, rng: 'provably-fair' },
  curate: {
    capMaxWin: CAP_X * 100, costMultiplier: 1, nRowsOut: 30,
    targetRTP: 0.5, toleranceRTP: 1.0, targetCV: 5, toleranceCV: 100,
    targetHitRate: 0.3, toleranceHitRate: 0.5, algorithm: 'tiered', requireMaxReached: false,
  },
};

let dir: string, poolDir: string, dumpPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-pool-'));
  poolDir = join(dir, 'pool');
  mkdirSync(poolDir, { recursive: true });
  dumpPath = join(poolDir, 'books_BASE.jsonl');
  writeFileSync(dumpPath, makeFixture());
});

afterEach(() => {
  delete process.env.POOL_ZSTD_LEVEL;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** The BASE entry of the pool index.json. */
function readIndexEntry(): { name: string; cost: number; events: string; weights: string } {
  const idx = JSON.parse(readFileSync(join(poolDir, 'index.json'), 'utf-8')) as {
    modes: { name: string; cost: number; events: string; weights: string }[];
  };
  return idx.modes.find((m) => m.name === 'BASE')!;
}

describe('finalizePool', () => {
  it('writes a 1-weight lookUpTable (sim,weight,payoutCents) from the raw dump', async () => {
    const res = await finalizePool(mode, { poolDir, dumpPath });
    expect(res.rows).toBe(100);

    const lutPath = join(poolDir, 'lookUpTable_BASE_0.csv');
    expect(existsSync(lutPath)).toBe(true);
    const lines = readFileSync(lutPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(100);
    for (const line of lines) {
      const parts = line.split(',');
      expect(parts).toHaveLength(3);
      expect(Number(parts[1])).toBe(1); // weight always 1
    }
    // First 60 rounds are zero-win → payoutCents 0; the near-cap row is 490000 (4900×100).
    expect(lines[0]).toBe('0,1,0');
    expect(lines[99]).toBe('99,1,490000');
  });

  it.skipIf(!hasZstd)('writes a pool index.json pointing at the .zst + lookUpTable', async () => {
    await finalizePool(mode, { poolDir, dumpPath });
    const base = readIndexEntry();
    expect(base.events).toBe('books_BASE.jsonl.zst');
    expect(base.weights).toBe('lookUpTable_BASE_0.csv');
  });

  it('names the file that actually exists in index.json when the books stay raw', async () => {
    // Compression off → the pool keeps books_BASE.jsonl, so index.json must say so.
    // A hardcoded `.zst` here points curate (and any consumer of the pool) at a
    // file that was never written.
    process.env.POOL_ZSTD_LEVEL = '0';
    const res = await finalizePool(mode, { poolDir, dumpPath });
    expect(res.compressed).toBe(false);
    expect(readIndexEntry().events).toBe('books_BASE.jsonl');
  });

  it('keeps the pool raw when POOL_ZSTD_LEVEL=0 (the pool is a temp artifact, not an archive)', async () => {
    // zstd -12 -T0 on a 59 GB pool is ~10 minutes of wall clock for a file that
    // curate reads once and deletes. Opting out must leave the dump readable.
    process.env.POOL_ZSTD_LEVEL = '0';
    const res = await finalizePool(mode, { poolDir, dumpPath });
    expect(res.compressed).toBe(false);
    expect(existsSync(dumpPath)).toBe(true);
    expect(existsSync(join(poolDir, 'books_BASE.jsonl.zst'))).toBe(false);
    expect(res.rows).toBe(100);
  });

  it('still curates from an uncompressed pool', async () => {
    process.env.POOL_ZSTD_LEVEL = '0';
    await finalizePool(mode, { poolDir, dumpPath });
    const outDir = join(dir, 'out');
    const result = await curateMode(mode, { poolDir, outDir });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasZstd)('compresses books to .zst (-19) and removes the raw dump', async () => {
    const res = await finalizePool(mode, { poolDir, dumpPath });
    expect(res.compressed).toBe(true);
    expect(existsSync(join(poolDir, 'books_BASE.jsonl.zst'))).toBe(true);
    expect(existsSync(dumpPath)).toBe(false); // raw removed by --rm
  });

  it('curate reads the pool lookUpTable (no raw dump needed)', async () => {
    await finalizePool(mode, { poolDir, dumpPath });
    // Raw dump is gone when zstd is present; curate must still work off the LUT.
    const outDir = join(dir, 'out');
    const result = await curateMode(mode, { poolDir, outDir });
    expect(existsSync(join(outDir, 'lookUpTable_BASE_0.csv'))).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
