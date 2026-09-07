import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLut, writeLut, createLineWriter } from '../src/pipeline/lut-io';
import type { LookupRow } from '../src/types';

/**
 * `lookUpTable_<MODE>_0.csv` I/O. The pool LUT for a real mode is millions of
 * rows, so both directions are byte-oriented: read parses digits straight out
 * of the read buffer, write batches lines into one buffer instead of a
 * `writeSync` per row. Both must stay bit-identical to the naive versions.
 */

/** The naive parse these helpers replace — the equivalence oracle. */
function naiveParse(text: string): LookupRow[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [sim, weight, payoutCents] = line.split(',').map(Number);
      return { sim, weight, payoutCents };
    });
}

function naiveSerialize(rows: LookupRow[]): string {
  return rows.map((r) => `${r.sim},${r.weight},${r.payoutCents}\n`).join('');
}

/** Deterministic pseudo-random rows (LCG) — no test-run-to-test-run drift. */
function makeRows(n: number): LookupRow[] {
  const rows: LookupRow[] = [];
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    rows.push({ sim: i, weight: 1, payoutCents: s % 7 === 0 ? s % 490000 : 0 });
  }
  return rows;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'e8-lutio-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

describe('readLut', () => {
  it('parses sim,weight,payoutCents lines into rows', async () => {
    const path = join(dir, 'lut.csv');
    writeFileSync(path, '0,1,0\n1,1,250\n2,1,490000\n');
    expect(await readLut(path)).toEqual([
      { sim: 0, weight: 1, payoutCents: 0 },
      { sim: 1, weight: 1, payoutCents: 250 },
      { sim: 2, weight: 1, payoutCents: 490000 },
    ]);
  });

  it('reads a final line with no trailing newline', async () => {
    const path = join(dir, 'lut.csv');
    writeFileSync(path, '0,1,0\n1,1,7');
    expect(await readLut(path)).toEqual([
      { sim: 0, weight: 1, payoutCents: 0 },
      { sim: 1, weight: 1, payoutCents: 7 },
    ]);
  });

  it('skips blank lines', async () => {
    const path = join(dir, 'lut.csv');
    writeFileSync(path, '0,1,0\n\n1,1,7\n\n');
    expect(await readLut(path)).toEqual([
      { sim: 0, weight: 1, payoutCents: 0 },
      { sim: 1, weight: 1, payoutCents: 7 },
    ]);
  });

  it('returns no rows for an empty file', async () => {
    const path = join(dir, 'lut.csv');
    writeFileSync(path, '');
    expect(await readLut(path)).toEqual([]);
  });

  it('parses weights beyond 32-bit (curated LUTs carry ~1.99e11)', async () => {
    const path = join(dir, 'lut.csv');
    writeFileSync(path, '0,199000000000,4200\n');
    expect(await readLut(path)).toEqual([{ sim: 0, weight: 199000000000, payoutCents: 4200 }]);
  });

  it('parses rows identically to the naive split/Number parse across a multi-MiB file', async () => {
    // 200k rows ≈ 2.5 MB — several read-buffer refills, so lines straddle chunk
    // boundaries. This is the case a byte parser gets wrong.
    const rows = makeRows(200_000);
    const text = naiveSerialize(rows);
    const path = join(dir, 'big.csv');
    writeFileSync(path, text);
    expect(await readLut(path)).toEqual(naiveParse(text));
  });
});

describe('writeLut', () => {
  it('writes the same bytes as the naive per-row serialization', () => {
    const rows = makeRows(5);
    const path = join(dir, 'out.csv');
    writeLut(rows, path);
    expect(readFileSync(path, 'utf-8')).toBe(naiveSerialize(rows));
  });

  it('writes every row when the batch buffer flushes mid-file', () => {
    const rows = makeRows(200_000);
    const path = join(dir, 'out.csv');
    writeLut(rows, path);
    expect(readFileSync(path, 'utf-8')).toBe(naiveSerialize(rows));
  });

  it('truncates an existing file instead of appending to it', () => {
    const path = join(dir, 'out.csv');
    writeLut(makeRows(50), path);
    writeLut(makeRows(3), path);
    expect(readFileSync(path, 'utf-8')).toBe(naiveSerialize(makeRows(3)));
  });

  it('round-trips through readLut', async () => {
    const rows = makeRows(1000);
    const path = join(dir, 'rt.csv');
    writeLut(rows, path);
    expect(await readLut(path)).toEqual(rows);
  });
});

describe('createLineWriter', () => {
  it('writes streamed lines in order', () => {
    const path = join(dir, 'stream.csv');
    const w = createLineWriter(path);
    w.write('0,1,0\n');
    w.write('1,1,7\n');
    w.close();
    expect(readFileSync(path, 'utf-8')).toBe('0,1,0\n1,1,7\n');
  });

  it('loses no line when the batch buffer flushes mid-stream', () => {
    const rows = makeRows(200_000);
    const path = join(dir, 'stream-big.csv');
    const w = createLineWriter(path);
    for (const r of rows) w.write(`${r.sim},${r.weight},${r.payoutCents}\n`);
    w.close();
    expect(readFileSync(path, 'utf-8')).toBe(naiveSerialize(rows));
  });

  it('truncates an existing file instead of appending to it', () => {
    const path = join(dir, 'stream-trunc.csv');
    const first = createLineWriter(path);
    first.write('9,9,9\n');
    first.close();
    const second = createLineWriter(path);
    second.write('1,1,1\n');
    second.close();
    expect(readFileSync(path, 'utf-8')).toBe('1,1,1\n');
  });
});
