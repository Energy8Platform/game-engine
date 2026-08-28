import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curateMode } from '../src/pipeline/curate';
import { finalizePool } from '../src/pipeline/pool';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * The engine's `books` command writes the round dump gzipped (`--out x.jsonl.gz`),
 * which is much cheaper than dumping raw and re-compressing with zstd afterwards.
 * curate must read that pool directly — both for the source rows and for the
 * per-round events — so nobody has to inflate a multi-GB pool to disk first.
 */

const CAP_X = 5000;

function roundLine(roundIdx: number, winX: number): string {
  return JSON.stringify({
    round_idx: roundIdx, worker_idx: 0, action: 'spin', bet: 1,
    cost_multiplier: 1, round_cost: 1, total_win: winX, total_win_x: winX,
    spins: [{ spin_idx: 0, stage: 'base_game', nonce: 1, win: winX, win_x: winX, data: { reels: [1, 2, 3] } }],
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

let dir: string, poolDir: string, outDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-gz-'));
  poolDir = join(dir, 'pool');
  outDir = join(dir, 'out');
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

/** First book line from the curated output, whichever compression survived. */
async function firstBook(): Promise<{ events: { type: string; spin: Record<string, unknown> }[] }> {
  const raw = join(outDir, 'books_BASE.jsonl');
  const zst = join(outDir, 'books_BASE.jsonl.zst');
  const text = existsSync(raw)
    ? readFileSync(raw, 'utf-8')
    : (await import('node:child_process')).execFileSync('zstd', ['-dc', '-q', zst], { encoding: 'utf-8' });
  return JSON.parse(text.split('\n').find((l) => l.trim())!);
}

describe('gzipped pool', () => {
  it('curates from books_<MODE>.jsonl.gz alone (no lookUpTable, no raw dump)', async () => {
    writeFileSync(join(poolDir, 'books_BASE.jsonl.gz'), gzipSync(Buffer.from(makeFixture())));

    const result = await curateMode(mode, { poolDir, outDir });

    expect(result.rows.length).toBe(30);
    // Events prove the .gz was actually inflated and parsed, not just counted.
    expect((await firstBook()).events.length).toBeGreaterThan(0);
  });

  it('reads events from the .gz when a prebuilt lookUpTable supplies the rows', async () => {
    const fixture = makeFixture();
    const dumpPath = join(poolDir, 'books_BASE.jsonl');
    writeFileSync(dumpPath, fixture);
    await finalizePool(mode, { poolDir, dumpPath });          // writes lookUpTable_BASE_0.csv
    for (const p of [dumpPath, join(poolDir, 'books_BASE.jsonl.zst')]) {
      if (existsSync(p)) rmSync(p);
    }
    writeFileSync(join(poolDir, 'books_BASE.jsonl.gz'), gzipSync(Buffer.from(fixture)));

    await curateMode(mode, { poolDir, outDir });

    const book = await firstBook();
    expect(book.events.length).toBeGreaterThan(0);
    expect(Object.keys(book.events[0]).sort()).toEqual(['spin', 'type']);
  });
});
