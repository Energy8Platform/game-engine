/**
 * Pool finalize step: raw Go `-dump` → compressed Stake-style library.
 *
 * The Go binary dumps one `RoundDumpRecord` per line to `books_<MODE>.jsonl`.
 * For real games that raw dump is enormous (80–90 GB), so we do NOT keep it.
 * Mirroring the shipped kitsune-wrath / hot-ross library layout, `finalizePool`
 * turns the raw dump into the same shape Stake ships:
 *
 *   <poolDir>/lookUpTable_<MODE>_0.csv   sim,weight=1,payoutCents (raw 1-weight)
 *   <poolDir>/books_<MODE>.jsonl.zst     the raw rounds, zstd -19 (raw removed)
 *   <poolDir>/index.json                 {modes:[{name,cost,events,weights}]} (upsert)
 *
 * The 1-weight lookUpTable is the small, fast input `curate` reads to optimize
 * (no need to decompress the multi-GB books). The `.zst` keeps the full round
 * data around for inspection / re-curation at a fraction of the disk cost.
 *
 * zstd may not be on PATH: on failure we keep the raw `.jsonl` and log a note
 * rather than failing the run (same policy as the curate step).
 */

import {
  existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, createReadStream,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { roundToRow } from './curate.js';
import { createLineWriter } from './lut-io.js';
import type { ResolvedMode } from '../mathConfig';

/** zstd level for the pool library. Default 12: on multi-GB dumps (kitsune
 *  BASE ≈ 6.7 GB raw) -19 runs for many minutes even with -T0, for ~10% extra
 *  ratio. Override via POOL_ZSTD_LEVEL=19 when archival size matters more
 *  than turnaround (curate's published books stay at the faster -9).
 *
 *  POOL_ZSTD_LEVEL=0 skips compression entirely and keeps the raw `.jsonl`.
 *  The pool is a temporary artifact — curate reads it once, then it is deleted —
 *  and `zstd -T0` does not actually parallelize on a single stream (~100 MB/s),
 *  so on a 50+ GB pool the compression costs more wall clock than the whole rest
 *  of the pipeline. Read per call so a run can flip it without a fresh process. */
export function poolCompressionDisabled(): boolean {
  return poolZstdLevel() <= 0;
}

function poolZstdLevel(): number {
  const level = Number(process.env.POOL_ZSTD_LEVEL ?? 12);
  return Number.isFinite(level) ? level : 12;
}

/**
 * Stream the raw dump into a 1-weight lookUpTable (`sim,weight,payoutCents`).
 * Uses readline (line-at-a-time) so the multi-GB dump never lands in memory at
 * once, and a batching writer so a 6M-row LUT costs ~80 flushes rather than 6M
 * `writeSync` calls. Returns the number of rows written.
 */
async function writePoolLut(
  dumpPath: string,
  poolDir: string,
  mode: string,
  capMaxWin: number,
): Promise<number> {
  const lutPath = join(poolDir, `lookUpTable_${mode}_0.csv`);
  const out = createLineWriter(lutPath);
  let sim = 0;
  try {
    const rl = createInterface({ input: createReadStream(dumpPath, { encoding: 'utf-8' }) });
    for await (const line of rl) {
      const row = roundToRow(line, sim, capMaxWin);
      if (row) {
        out.write(`${row.sim},${row.weight},${row.payoutCents}\n`);
        sim++;
      }
    }
  } finally {
    out.close();
  }
  return sim;
}

/** Compress the raw dump → `books_<MODE>.jsonl.zst`, removing the raw on success.
 *  Returns false (keeping the raw `.jsonl`) when compression is switched off or zstd is absent. */
function compressPoolBooks(dumpPath: string, poolDir: string, mode: string): boolean {
  const level = poolZstdLevel();
  if (level <= 0) return false;
  const zstPath = join(poolDir, `books_${mode}.jsonl.zst`);
  if (existsSync(zstPath)) unlinkSync(zstPath);
  try {
    execFileSync(
      'zstd',
      // -T0: все ядра — на многогигабайтных дампах single-thread -19 длится минуты
      [`-${level}`, '-T0', '-q', '-f', '--rm', dumpPath, '-o', zstPath],
      { stdio: 'inherit' },
    );
    return true;
  } catch {
    process.stderr.write(
      `  [${mode}] zstd not found — kept raw books_${mode}.jsonl in the pool; install zstd for the .zst\n`,
    );
    return false;
  }
}

interface IndexMode { name: string; cost: number; events: string; weights: string }
interface IndexJson { modes: IndexMode[] }

/** Upsert this mode's entry into `<poolDir>/index.json` (keep sibling modes).
 *  `events` names the books file that actually exists — the pool stays raw when
 *  compression is off or zstd is missing, and an index pointing at a `.zst` that
 *  was never written sends every consumer of the pool to a missing file. */
function upsertPoolIndex(poolDir: string, mode: string, cost: number, compressed: boolean): void {
  const path = join(poolDir, 'index.json');
  let index: IndexJson = { modes: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<IndexJson>;
      if (Array.isArray(parsed.modes)) index = { modes: parsed.modes };
    } catch { /* corrupt/empty — start fresh */ }
  }
  const entry: IndexMode = {
    name: mode,
    cost,
    events: compressed ? `books_${mode}.jsonl.zst` : `books_${mode}.jsonl`,
    weights: `lookUpTable_${mode}_0.csv`,
  };
  const i = index.modes.findIndex((m) => m.name === mode);
  if (i >= 0) index.modes[i] = entry;
  else index.modes.push(entry);
  writeFileSync(path, JSON.stringify(index, null, 2) + '\n');
}

export interface FinalizePoolResult {
  /** Rows written to the pool lookUpTable. */
  rows: number;
  /** Whether the raw dump was zstd-compressed (false when zstd is absent). */
  compressed: boolean;
}

/**
 * Turn a freshly-written raw dump into the compressed pool library: write the
 * 1-weight lookUpTable, compress the books to `.zst` (-19, raw removed), and
 * upsert the pool `index.json`. Idempotent per mode.
 */
export async function finalizePool(
  mode: ResolvedMode,
  opts: { poolDir: string; dumpPath: string },
): Promise<FinalizePoolResult> {
  mkdirSync(opts.poolDir, { recursive: true });
  // LUT first (reads the raw dump), THEN compress (which removes the raw with --rm).
  const rows = await writePoolLut(opts.dumpPath, opts.poolDir, mode.mode, mode.curate.capMaxWin);
  const compressed = compressPoolBooks(opts.dumpPath, opts.poolDir, mode.mode);
  upsertPoolIndex(opts.poolDir, mode.mode, mode.costMultiplier, compressed);
  return { rows, compressed };
}
