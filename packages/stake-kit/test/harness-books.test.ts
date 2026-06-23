import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import { loadIndex, hasBooks, pickWeighted, readBook } from '../src/harness/books';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let dir: string;
let lutPath: string;
let zstPath: string;

const JSONL_LINES = [
  '{"id":0,"payoutMultiplier":0}',
  '{"id":1,"payoutMultiplier":250}',
  '{"id":2,"payoutMultiplier":5000}',
].join('\n') + '\n';

// LUT: row 0 weight=1, row 1 weight=1000 (overwhelming), row 2 weight=1
const LUT_CSV = '0,1,0\n1,1000,250\n2,1,5000\n';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-books-'));

  // index.json
  const index = {
    modes: [{ name: 'BASE', cost: 1, events: 'books_BASE.jsonl.zst', weights: 'lookUpTable_BASE_0.csv' }],
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));

  // LUT csv
  lutPath = join(dir, 'lookUpTable_BASE_0.csv');
  writeFileSync(lutPath, LUT_CSV);

  // books zstd-compressed JSONL
  zstPath = join(dir, 'books_BASE.jsonl.zst');
  writeFileSync(zstPath, zstdCompressSync(Buffer.from(JSONL_LINES)));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------

describe('loadIndex', () => {
  it('returns modes from a valid index.json', () => {
    const modes = loadIndex(dir);
    expect(modes).not.toBeNull();
    expect(modes).toHaveLength(1);
    expect(modes![0]).toEqual({
      name: 'BASE',
      cost: 1,
      events: 'books_BASE.jsonl.zst',
      weights: 'lookUpTable_BASE_0.csv',
    });
  });

  it('returns null for a nonexistent directory', () => {
    expect(loadIndex('/nonexistent/__no_such_dir__')).toBeNull();
  });

  it('returns null for a directory with no index.json', () => {
    const empty = mkdtempSync(join(tmpdir(), 'harness-books-empty-'));
    try {
      expect(loadIndex(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// hasBooks
// ---------------------------------------------------------------------------

describe('hasBooks', () => {
  it('returns true when both LUT and zst exist', () => {
    expect(hasBooks(dir, 'BASE')).toBe(true);
  });

  it('returns false for a mode with no files', () => {
    expect(hasBooks(dir, 'NOPE')).toBe(false);
  });

  it('returns false when only one of the two files exists', () => {
    // mode where only the zst would exist (we only have BASE fully set up)
    // Manufacture a HALF mode: write only the LUT, not the zst
    const half = mkdtempSync(join(tmpdir(), 'harness-books-half-'));
    try {
      writeFileSync(join(half, 'lookUpTable_HALF_0.csv'), LUT_CSV);
      expect(hasBooks(half, 'HALF')).toBe(false);
    } finally {
      rmSync(half, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// pickWeighted
// ---------------------------------------------------------------------------

describe('pickWeighted', () => {
  it('returns the high-weight row (sim=1) when rng consistently returns 0.5', async () => {
    // With weights [1, 1000, 1]:
    // Row 0: cumWeight=1,   accept if rng() < 1/1     → 0.5 < 1     → chosen = row 0
    // Row 1: cumWeight=1001, accept if rng() < 1000/1001 → 0.5 < ~0.999 → chosen = row 1
    // Row 2: cumWeight=1002, accept if rng() < 1/1002 → 0.5 < ~0.001 → NOT replaced
    // Final result: sim=1
    const row = await pickWeighted(lutPath, () => 0.5);
    expect(row.sim).toBe(1);
    expect(row.weight).toBe(1000);
    expect(row.payoutCents).toBe(250);
  });

  it('forces selection of row 0 with rng=()=>0 (always replaces, last = row 2)', async () => {
    // rng() always returns 0, which is always < weight/cumWeight (any positive ratio)
    // So each row replaces the previous → final chosen = last row (row 2)
    const row = await pickWeighted(lutPath, () => 0);
    expect(row.sim).toBe(2);
  });

  it('forces selection of only row 0 with rng that accepts first then rejects all', async () => {
    // First call: 0.5 < 1/1 = 1.0 → row 0 chosen
    // Second call: 0.5 < 1000/1001 → row 1 replaces (overwhelms), wait — actually we need
    // a sequence that picks row 0 and never replaces.
    // Row 0: cumWeight=1,    threshold=1/1=1.0    → rng() < 1.0 always accepts
    // Row 1: cumWeight=1001, threshold=1000/1001≈0.999 → rng() must be >= 0.999 to NOT replace
    // Row 2: cumWeight=1002, threshold=1/1002≈0.001 → rng() must be >= 0.001 to NOT replace
    let call = 0;
    const seqRng = () => {
      call++;
      if (call === 1) return 0.5;   // row 0: 0.5 < 1.0 → chosen
      if (call === 2) return 0.9995; // row 1: 0.9995 >= 0.999 → NOT replaced
      return 0.9995;                 // row 2: 0.9995 >= ~0.001 → NOT replaced
    };
    const row = await pickWeighted(lutPath, seqRng);
    expect(row.sim).toBe(0);
  });

  it('throws on a missing LUT file', async () => {
    await expect(pickWeighted('/nonexistent/__no_such.csv')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readBook
// ---------------------------------------------------------------------------

describe('readBook', () => {
  it('returns the line for id=1 containing payoutMultiplier:250', async () => {
    const line = await readBook(zstPath, 1);
    expect(line).not.toBeNull();
    expect(line).toContain('"id":1');
    expect(line).toContain('"payoutMultiplier":250');
  });

  it('returns the line for id=0', async () => {
    const line = await readBook(zstPath, 0);
    expect(line).not.toBeNull();
    expect(line).toContain('"id":0');
  });

  it('returns the line for id=2', async () => {
    const line = await readBook(zstPath, 2);
    expect(line).not.toBeNull();
    expect(line).toContain('"id":2');
    expect(line).toContain('"payoutMultiplier":5000');
  });

  it('returns null for a missing id', async () => {
    const line = await readBook(zstPath, 99);
    expect(line).toBeNull();
  });

  it('throws or rejects on a missing file', async () => {
    await expect(readBook('/nonexistent/__no_such.jsonl.zst', 0)).rejects.toThrow();
  });
});
