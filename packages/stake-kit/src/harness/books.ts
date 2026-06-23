/**
 * dev-RGS data layer — pure node-only functions for reading e8-math curate artifacts.
 *
 * Consumers: dev-RGS handler (stake-kit/harness) and the vite plugin.
 * No vite, no pixi, no browser — node:fs / node:readline / node:zlib only.
 */

import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookMode {
  name: string;
  cost: number;
  events: string;
  weights: string;
}

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------

/**
 * Read <booksDir>/index.json and return its modes array.
 * Returns null if the file is absent or cannot be parsed.
 */
export function loadIndex(booksDir: string): BookMode[] | null {
  const indexPath = join(booksDir, 'index.json');
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as { modes: BookMode[] };
    if (!Array.isArray(parsed?.modes)) return null;
    return parsed.modes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// hasBooks
// ---------------------------------------------------------------------------

/**
 * Returns true iff BOTH books_<MODE>.jsonl.zst AND lookUpTable_<MODE>_0.csv
 * exist under booksDir.
 */
export function hasBooks(booksDir: string, mode: string): boolean {
  const zst = join(booksDir, `books_${mode}.jsonl.zst`);
  const lut = join(booksDir, `lookUpTable_${mode}_0.csv`);
  return existsSync(zst) && existsSync(lut);
}

// ---------------------------------------------------------------------------
// pickWeighted
// ---------------------------------------------------------------------------

/** Result row from the LUT. */
export interface LutRow {
  sim: number;
  weight: number;
  payoutCents: number;
}

/**
 * Single-pass weighted reservoir pick (size 1) over the LUT CSV rows,
 * proportional to `weight`. The injectable `rng` defaults to Math.random.
 *
 * Algorithm: for each row, cumWeight += weight; accept this row if
 *   rng() < weight / cumWeight   (correct reservoir-1 weighted sampling).
 *
 * Throws if the LUT file is missing or contains no valid rows.
 */
export async function pickWeighted(
  lutPath: string,
  rng: () => number = Math.random,
): Promise<LutRow> {
  // Read the whole file synchronously — LUT files are small CSV integers.
  let raw: string;
  try {
    raw = readFileSync(lutPath, 'utf8');
  } catch (err) {
    throw new Error(`pickWeighted: cannot read LUT at ${lutPath}: ${(err as Error).message}`);
  }

  let chosen: LutRow | null = null;
  let cumWeight = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(',');
    if (parts.length < 3) continue;

    const sim = parseInt(parts[0], 10);
    const weight = parseInt(parts[1], 10);
    const payoutCents = parseInt(parts[2], 10);

    if (!Number.isFinite(sim) || !Number.isFinite(weight) || !Number.isFinite(payoutCents)) continue;
    if (weight <= 0) continue;

    cumWeight += weight;
    if (rng() < weight / cumWeight) {
      chosen = { sim, weight, payoutCents };
    }
  }

  if (chosen === null) {
    throw new Error(`pickWeighted: LUT at ${lutPath} is empty or contains no valid rows`);
  }

  return chosen;
}

// ---------------------------------------------------------------------------
// readBook
// ---------------------------------------------------------------------------

/**
 * Stream books_<MODE>.jsonl.zst (zstd-decompress on the fly), return the raw
 * JSONL line whose top-level `id` field equals `id`, or null if not found.
 * Early-outs on first match (books can be hundreds of MB).
 *
 * Rejects if the file cannot be opened.
 */
export function readBook(eventsZstPath: string, id: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let stream: ReturnType<typeof createReadStream>;
    try {
      // createReadStream throws synchronously for missing files in some Node versions;
      // in others it emits 'error'. Handle both.
      stream = createReadStream(eventsZstPath);
    } catch (err) {
      reject(err);
      return;
    }

    const decompress = createZstdDecompress();
    const rl = createInterface({
      input: stream.pipe(decompress),
      crlfDelay: Infinity,
    });

    let found = false;
    let errored = false;

    const fail = (err: Error) => {
      if (found || errored) return;
      errored = true;
      rl.close();
      reject(err);
    };

    stream.on('error', fail);
    decompress.on('error', fail);
    rl.on('error', fail);

    rl.on('line', (line) => {
      if (found || errored) return;
      // Match top-level id only: lines start `{"id":<digits>,...`
      const m = /^\{"id":(\d+)/.exec(line);
      if (m && Number(m[1]) === id) {
        found = true;
        rl.close();
        resolve(line);
      }
    });

    rl.on('close', () => {
      if (!found && !errored) {
        resolve(null);
      }
    });
  });
}
