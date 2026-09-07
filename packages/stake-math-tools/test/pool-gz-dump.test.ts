import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizePool, normalizeDumpPath } from '../src/pipeline/pool';
import { isGzipFile } from '../src/pipeline/dump-io';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * The pool dump arrives already gzipped — `e8 simulate -dump x.jsonl.gz` writes
 * it compressed in one pass, so the raw file (tens of GB on a real game) never
 * exists and no second compression pass runs. finalizePool has to build the
 * lookUpTable straight off that archive, leave it alone, and point index.json
 * at it. An older engine that ignores the extension must still work: the file
 * is renamed to its honest `.jsonl` name and the legacy zstd path takes over.
 */

const CAP_X = 5000;

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
  for (let i = 0; i < 10; i++) lines.push(roundLine(r++, 20 + i));
  return lines.join('\n') + '\n';
}

const mode: ResolvedMode = {
  mode: 'BASE', action: 'spin', costMultiplier: 1,
  sim: { iterations: 100, bet: 1, rng: 'provably-fair' },
  curate: { capMaxWin: CAP_X * 100, costMultiplier: 1 },
};

let dir: string, poolDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-gzdump-'));
  poolDir = join(dir, 'pool');
  mkdirSync(poolDir, { recursive: true });
});

afterEach(() => {
  delete process.env.POOL_ZSTD_LEVEL;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function readIndexEntry(): { name: string; events: string; weights: string } {
  const idx = JSON.parse(readFileSync(join(poolDir, 'index.json'), 'utf-8')) as {
    modes: { name: string; events: string; weights: string }[];
  };
  return idx.modes.find((m) => m.name === 'BASE')!;
}

describe('finalizePool on a gzipped dump', () => {
  it('builds the lookUpTable from the .gz and keeps the archive as-is', async () => {
    const gzPath = join(poolDir, 'books_BASE.jsonl.gz');
    writeFileSync(gzPath, gzipSync(Buffer.from(makeFixture())));

    const fin = await finalizePool(mode, { poolDir, dumpPath: gzPath });

    expect(fin.rows).toBe(100);
    expect(fin.compressed).toBe(true);
    expect(fin.books).toBe('books_BASE.jsonl.gz');
    // The engine's archive is the pool's archive — nothing re-packed, nothing removed.
    expect(existsSync(gzPath)).toBe(true);
    expect(existsSync(join(poolDir, 'books_BASE.jsonl.zst'))).toBe(false);
    expect(existsSync(join(poolDir, 'books_BASE.jsonl'))).toBe(false);
    // index.json must name the file that exists, or every pool consumer 404s.
    expect(readIndexEntry().events).toBe('books_BASE.jsonl.gz');
  });

  it('derives the same lookUpTable from the .gz as from the raw dump', async () => {
    const fixture = makeFixture();
    const rawDir = join(dir, 'raw');
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, 'books_BASE.jsonl'), fixture);
    writeFileSync(join(poolDir, 'books_BASE.jsonl.gz'), gzipSync(Buffer.from(fixture)));

    process.env.POOL_ZSTD_LEVEL = '0'; // keep the raw comparison run uncompressed
    await finalizePool(mode, { poolDir: rawDir, dumpPath: join(rawDir, 'books_BASE.jsonl') });
    delete process.env.POOL_ZSTD_LEVEL;
    await finalizePool(mode, { poolDir, dumpPath: join(poolDir, 'books_BASE.jsonl.gz') });

    expect(readFileSync(join(poolDir, 'lookUpTable_BASE_0.csv'), 'utf-8')).toBe(
      readFileSync(join(rawDir, 'lookUpTable_BASE_0.csv'), 'utf-8'),
    );
  });

  it('reads a dump written as several concatenated gzip members', async () => {
    // Each engine worker gzips its own part and the parts are byte-copied
    // together — a valid multi-member gzip stream that must read to the end.
    const lines = makeFixture().split('\n').filter(Boolean);
    const half = Math.floor(lines.length / 2);
    const a = gzipSync(Buffer.from(lines.slice(0, half).join('\n') + '\n'));
    const b = gzipSync(Buffer.from(lines.slice(half).join('\n') + '\n'));
    writeFileSync(join(poolDir, 'books_BASE.jsonl.gz'), Buffer.concat([a, b]));

    const fin = await finalizePool(mode, { poolDir, dumpPath: join(poolDir, 'books_BASE.jsonl.gz') });

    expect(fin.rows).toBe(lines.length);
  });

  it('does not re-compress an already gzipped dump even with POOL_ZSTD_LEVEL set', async () => {
    process.env.POOL_ZSTD_LEVEL = '19';
    const gzPath = join(poolDir, 'books_BASE.jsonl.gz');
    writeFileSync(gzPath, gzipSync(Buffer.from(makeFixture())));

    const fin = await finalizePool(mode, { poolDir, dumpPath: gzPath });

    expect(fin.books).toBe('books_BASE.jsonl.gz');
    expect(existsSync(gzPath)).toBe(true);
    expect(existsSync(join(poolDir, 'books_BASE.jsonl.zst'))).toBe(false);
  });
});

describe('normalizeDumpPath', () => {
  it('keeps a real gzip dump at its .gz path', () => {
    const gzPath = join(poolDir, 'books_BASE.jsonl.gz');
    writeFileSync(gzPath, gzipSync(Buffer.from(makeFixture())));

    expect(normalizeDumpPath(gzPath, 'BASE')).toBe(gzPath);
    expect(isGzipFile(gzPath)).toBe(true);
  });

  it('renames a .gz-named RAW dump (older engine) back to .jsonl', async () => {
    const gzPath = join(poolDir, 'books_BASE.jsonl.gz');
    const rawPath = join(poolDir, 'books_BASE.jsonl');
    writeFileSync(gzPath, makeFixture()); // engine ignored the extension

    expect(normalizeDumpPath(gzPath, 'BASE')).toBe(rawPath);
    expect(existsSync(gzPath)).toBe(false);
    expect(existsSync(rawPath)).toBe(true);

    // …and the legacy path still finalizes it into a usable pool.
    process.env.POOL_ZSTD_LEVEL = '0';
    const fin = await finalizePool(mode, { poolDir, dumpPath: rawPath });
    expect(fin.rows).toBe(100);
    expect(fin.books).toBe('books_BASE.jsonl');
    expect(readIndexEntry().events).toBe('books_BASE.jsonl');
  });

  it('leaves a non-.gz path and a missing file alone', () => {
    const rawPath = join(poolDir, 'books_BASE.jsonl');
    writeFileSync(rawPath, makeFixture());
    expect(normalizeDumpPath(rawPath, 'BASE')).toBe(rawPath);

    const missing = join(poolDir, 'books_MISSING.jsonl.gz');
    expect(normalizeDumpPath(missing, 'MISSING')).toBe(missing);
  });
});
