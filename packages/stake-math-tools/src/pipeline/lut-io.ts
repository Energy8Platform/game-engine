/**
 * `lookUpTable_<MODE>_0.csv` I/O — the hot path of the curate stage.
 *
 * A real mode's pool LUT is one row per simulated round (BASE: 6M rows, ~79 MB),
 * and the whole pipeline reads it once per curate pass and writes it once per
 * pool pass. Both directions are therefore byte-oriented rather than idiomatic:
 *
 * - `readLut` parses digits straight out of the read buffer. The idiomatic
 *   `readline` + `split(',')` + `map(Number)` allocates a string, two arrays and
 *   an object per row — on BASE that is ~24M short-lived allocations and the GC
 *   shows up as a double-digit share of the curate profile.
 * - `writeLut` / `createLineWriter` batch lines into a ~1 MiB buffer instead of
 *   one `writeSync` syscall per row (400k syscalls on a BASE output LUT).
 *
 * Both must stay bit-identical to the naive versions they replaced — the CSV is
 * a published Stake artifact, and `test/lut-io.test.ts` pins that equivalence.
 */

import { openSync, readSync, writeSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import type { LookupRow } from '../types';

/** Read/flush granularity. 1 MiB keeps the syscall count low without holding the file in memory. */
const CHUNK = 1 << 20;

const CH_NEWLINE = 10;
const CH_COMMA = 44;
const CH_MINUS = 45;
const CH_ZERO = 48;
const CH_NINE = 57;

/**
 * Parse a `sim,weight,payoutCents` CSV into rows, reading the file in 1 MiB
 * chunks and accumulating integers digit-by-digit — no per-row string or array.
 * Blank lines are skipped and a missing trailing newline is fine, matching the
 * `readline` + `split` parse this replaces.
 *
 * Async only so it stays a drop-in for the streaming reader it replaced; the
 * work itself is synchronous (the file is local and read in full either way).
 */
export async function readLut(path: string): Promise<LookupRow[]> {
  const rows: LookupRow[] = [];
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);

  // Row being accumulated across chunk boundaries: which column we're in, the
  // digits seen so far, and the two columns already closed by a comma.
  let field = 0;
  let value = 0;
  let negative = false;
  let sawDigit = false;
  let sim = 0;
  let weight = 0;

  const endRow = (): void => {
    // A row exists once we've seen any digit or column separator; a blank line has neither.
    if (sawDigit || field > 0) {
      rows.push({ sim, weight, payoutCents: negative ? -value : value });
    }
    field = 0;
    value = 0;
    negative = false;
    sawDigit = false;
  };

  try {
    for (;;) {
      const read = readSync(fd, buf, 0, CHUNK, null);
      if (read === 0) break;
      for (let i = 0; i < read; i++) {
        const b = buf[i];
        if (b >= CH_ZERO && b <= CH_NINE) {
          value = value * 10 + (b - CH_ZERO);
          sawDigit = true;
        } else if (b === CH_COMMA) {
          const closed = negative ? -value : value;
          if (field === 0) sim = closed;
          else if (field === 1) weight = closed;
          field++;
          value = 0;
          negative = false;
          sawDigit = false;
        } else if (b === CH_NEWLINE) {
          endRow();
        } else if (b === CH_MINUS) {
          negative = true;
        }
        // Anything else (CR, stray whitespace) is ignored — the writer never emits it.
      }
    }
    endRow(); // final line with no trailing newline
  } finally {
    closeSync(fd);
  }
  return rows;
}

/** A batching line writer: appends into a ~1 MiB buffer and flushes with one `writeSync`. */
export interface LineWriter {
  /** Append one already-newline-terminated line. */
  write(line: string): void;
  /** Flush the tail and close the file descriptor. */
  close(): void;
}

/** Open `path` for writing (truncating any existing file) with batched writes. */
export function createLineWriter(path: string): LineWriter {
  if (existsSync(path)) unlinkSync(path);
  const fd = openSync(path, 'w');
  let pending = '';
  return {
    write(line: string): void {
      pending += line;
      if (pending.length >= CHUNK) {
        writeSync(fd, pending);
        pending = '';
      }
    },
    close(): void {
      try {
        if (pending) writeSync(fd, pending);
      } finally {
        closeSync(fd);
      }
    },
  };
}

/** Write rows as `sim,weight,payoutCents` lines, truncating any existing file. */
export function writeLut(rows: LookupRow[], path: string): void {
  const w = createLineWriter(path);
  try {
    for (const r of rows) w.write(`${r.sim},${r.weight},${r.payoutCents}\n`);
  } finally {
    w.close();
  }
}
