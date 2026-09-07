import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curateMode } from '../src/pipeline/curate';
import { finalizePool } from '../src/pipeline/pool';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * The lookUpTable and the round dump are two files that must describe the SAME run: a curated
 * row's `sim` is the dump's line index. When they don't line up — a pool from a different run,
 * a partially-written dump — the rows whose line is missing would otherwise be published as
 * books with an empty `events` array: valid JSON, accepted by every check we run, and dead on
 * screen. That must fail loudly instead.
 *
 * The one case that is NOT an error is a pool with no dump at all (curate off a bare LUT, e.g.
 * while tuning weights): nothing to read, nothing lost — but the books are event-less, so it
 * warns.
 */

const CAP_X = 5000;

function roundLine(roundIdx: number, winX: number): string {
  return JSON.stringify({
    round_idx: roundIdx, worker_idx: 0, action: 'spin', bet: 1,
    cost_multiplier: 1, round_cost: 1, total_win: winX, total_win_x: winX,
    spins: [{ spin_idx: 0, stage: 'base_game', nonce: 1, win: winX, win_x: winX, data: {} }],
  });
}

const FULL = Array.from({ length: 200 }, (_, i) => roundLine(i, i % 7)).join('\n') + '\n';

function makeMode(nRowsOut: number): ResolvedMode {
  return {
    mode: 'BASE', action: 'spin', costMultiplier: 1,
    sim: { iterations: 200, bet: 1, rng: 'provably-fair' },
    curate: {
      capMaxWin: CAP_X * 100, costMultiplier: 1, nRowsOut,
      targetRTP: 0.5, toleranceRTP: 1.0, targetCV: 5, toleranceCV: 100,
      targetHitRate: 0.3, toleranceHitRate: 0.5, algorithm: 'tiered', requireMaxReached: false,
    },
  };
}

let dir: string, poolDir: string, outDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-integrity-'));
  poolDir = join(dir, 'pool');
  outDir = join(dir, 'out');
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

/** Build lookUpTable_BASE_0.csv from the complete dump, then drop every dump file. */
async function buildLutOnly(mode: ResolvedMode): Promise<void> {
  const dumpPath = join(poolDir, 'books_BASE.jsonl');
  writeFileSync(dumpPath, FULL);
  await finalizePool(mode, { poolDir, dumpPath });
  for (const p of [dumpPath, join(poolDir, 'books_BASE.jsonl.zst')]) {
    if (existsSync(p)) rmSync(p);
  }
}

describe('LUT ↔ pool consistency', () => {
  it('fails when the pool is missing rounds the lookUpTable selected', async () => {
    const mode = makeMode(40);
    await buildLutOnly(mode);
    // A valid pool — but only the first 50 of the 200 rounds the LUT was built from.
    writeFileSync(
      join(poolDir, 'books_BASE.jsonl.gz'),
      gzipSync(Buffer.from(FULL.split('\n').slice(0, 50).join('\n') + '\n')),
    );

    await expect(curateMode(mode, { poolDir, outDir })).rejects.toThrow(/round/i);
  });

  it('names how many rounds were missing so the mismatch is diagnosable', async () => {
    const mode = makeMode(40);
    await buildLutOnly(mode);
    writeFileSync(
      join(poolDir, 'books_BASE.jsonl.gz'),
      gzipSync(Buffer.from(FULL.split('\n').slice(0, 50).join('\n') + '\n')),
    );

    await expect(curateMode(mode, { poolDir, outDir })).rejects.toThrow(/books_BASE/);
  });

  it('curates a matching pool without complaint', async () => {
    const mode = makeMode(40);
    await buildLutOnly(mode);
    writeFileSync(join(poolDir, 'books_BASE.jsonl.gz'), gzipSync(Buffer.from(FULL)));

    const result = await curateMode(mode, { poolDir, outDir });

    const raw = join(outDir, 'books_BASE.jsonl');
    const text = existsSync(raw)
      ? readFileSync(raw, 'utf-8')
      : (await import('node:child_process'))
          .execFileSync('zstd', ['-dc', '-q', join(outDir, 'books_BASE.jsonl.zst')], { encoding: 'utf-8' });
    const books = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect(books.every((b) => b.events.length > 0)).toBe(true);
    expect(result.warnings.join(' ')).not.toMatch(/without events/i);
  });

  it('warns, but does not fail, when the pool has no dump at all', async () => {
    const mode = makeMode(40);
    await buildLutOnly(mode); // LUT only — no .jsonl, no .gz, no .zst

    const result = await curateMode(mode, { poolDir, outDir });

    expect(result.rows.length).toBe(40);
    expect(result.warnings.join(' ')).toMatch(/without events/i);
  });
});
