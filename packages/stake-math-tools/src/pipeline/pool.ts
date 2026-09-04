/**
 * Pool finalize step: the engine's `-dump` → a compressed Stake-style library.
 *
 * The engine dumps one `RoundDumpRecord` per line. For real games that dump is
 * enormous (80–90 GB raw), so we do NOT keep it raw. Mirroring the shipped
 * kitsune-wrath / hot-ross library layout, `finalizePool` leaves the pool as:
 *
 *   <poolDir>/lookUpTable_<MODE>_0.csv   sim,weight=1,payoutCents (raw 1-weight)
 *   <poolDir>/books_<MODE>.jsonl.gz      the rounds, gzipped BY THE ENGINE
 *   <poolDir>/index.json                 {modes:[{name,cost,events,weights}]} (upsert)
 *
 * The dump normally arrives already compressed — `e8 simulate -dump x.jsonl.gz`
 * gzips as it writes — so there is nothing left to do here but the lookUpTable.
 * When the dump is raw (an engine without gz dumps, or POOL_ZSTD_LEVEL set on
 * purpose) the old path still runs: `zstd` the raw file into
 * `books_<MODE>.jsonl.zst` and remove the raw.
 *
 * The 1-weight lookUpTable is the small, fast input `curate` reads to optimize
 * (no need to decompress the multi-GB books). The archive keeps the full round
 * data around for inspection / re-curation at a fraction of the disk cost.
 *
 * zstd may not be on PATH: on failure we keep the raw `.jsonl` and log a note
 * rather than failing the run (same policy as the curate step).
 */

import {
  existsSync, mkdirSync, unlinkSync, renameSync, readFileSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { roundToRow } from './curate.js';
import { createLineWriter, readPoolCsv, writeLut } from './lut-io.js';
import { writeManifest } from './manifest.js';
import { dumpLineStream, isGzipFile } from './dump-io.js';
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

/**
 * True when POOL_ZSTD_LEVEL is set in the environment.
 *
 * Unset means "let the engine gzip the dump as it writes it" — the default, and
 * the only path that never materializes the raw pool. Setting the variable is
 * an explicit request for the legacy behaviour: dump raw, then zstd it (`=0`
 * keeps the raw file). Read per call so a run can flip it without a fresh
 * process, same as the level itself.
 */
export function poolZstdRequested(): boolean {
  return process.env.POOL_ZSTD_LEVEL !== undefined;
}

function poolZstdLevel(): number {
  const level = Number(process.env.POOL_ZSTD_LEVEL ?? 12);
  return Number.isFinite(level) ? level : 12;
}

/**
 * Stream the dump into a 1-weight lookUpTable (`sim,weight,payoutCents`).
 * Uses readline (line-at-a-time) so the multi-GB dump never lands in memory at
 * once — gzipped dumps are inflated through the same stream, never onto disk —
 * and a batching writer so a 6M-row LUT costs ~80 flushes rather than 6M
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
    const rl = dumpLineStream(dumpPath);
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
 *  `books` names the file that actually exists — `.gz` from the engine, `.zst`
 *  from our zstd pass, or the raw `.jsonl` when compression is off or zstd is
 *  missing. An index pointing at an archive that was never written sends every
 *  consumer of the pool to a missing file. */
function upsertPoolIndex(poolDir: string, mode: string, cost: number, books: string): void {
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
    events: books,
    weights: `lookUpTable_${mode}_0.csv`,
  };
  const i = index.modes.findIndex((m) => m.name === mode);
  if (i >= 0) index.modes[i] = entry;
  else index.modes.push(entry);
  writeFileSync(path, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Reconcile the dump path we ASKED the engine for with what it actually wrote.
 *
 * An engine that predates gzipped dumps writes plain JSONL to whatever `-dump`
 * names, `.gz` included — a file every later reader would try to gunzip and
 * fail on. Rather than probing the binary's version, we look at the two magic
 * bytes and, when they are missing, rename the file to its honest `.jsonl` name
 * and let the legacy zstd path take over. Returns the path to use from here on.
 */
export function normalizeDumpPath(dumpPath: string, label?: string): string {
  if (!dumpPath.toLowerCase().endsWith('.gz')) return dumpPath;
  if (!existsSync(dumpPath) || isGzipFile(dumpPath)) return dumpPath;
  const rawPath = dumpPath.slice(0, -'.gz'.length);
  if (existsSync(rawPath)) unlinkSync(rawPath);
  renameSync(dumpPath, rawPath);
  process.stderr.write(
    `  ${label ? `[${label}] ` : ''}engine wrote the dump uncompressed — ` +
      `update the e8 binary for gzipped dumps; falling back to ${basename(rawPath)} + zstd\n`,
  );
  return rawPath;
}

/**
 * Finalize a LIGHT pool: the engine's `round,payoutCents` CSV → the 1-weight
 * lookUpTable curate optimizes, plus the manifest the heavy pass replays from.
 *
 * No JSON is parsed here at all — that is the point of the light pass. The CSV
 * for 14M rounds is ~120 MB against ~51 GB of full dump, and reading it is the
 * same digit-accumulating pass the LUT reader already uses.
 */
export async function finalizeLightPool(
  mode: ResolvedMode,
  opts: { poolDir: string; csvPath: string; masterSeed: string; spinHash: string },
): Promise<{ rows: number }> {
  mkdirSync(opts.poolDir, { recursive: true });
  const rows = await readPoolCsv(opts.csvPath, mode.curate.capMaxWin);
  writeLut(rows, join(opts.poolDir, `lookUpTable_${mode.mode}_0.csv`));
  writeManifest(opts.poolDir, {
    mode: mode.mode,
    action: mode.action,
    bet: mode.sim.bet,
    iterations: mode.sim.iterations,
    rng: mode.sim.rng,
    masterSeed: opts.masterSeed,
    params: mode.sim.params,
    spinHash: opts.spinHash,
    rounds: rows.length,
    createdAt: new Date().toISOString(),
  });
  upsertPoolIndex(opts.poolDir, mode.mode, mode.costMultiplier, basename(opts.csvPath));
  return { rows: rows.length };
}

export interface FinalizePoolResult {
  /** Rows written to the pool lookUpTable. */
  rows: number;
  /** Whether the pool's books are compressed (gzipped by the engine, or zstd'd here). */
  compressed: boolean;
  /** The books file the pool actually holds — what `index.json` points at. */
  books: string;
}

/**
 * Turn a freshly-written dump into the pool library: write the 1-weight
 * lookUpTable, make sure the books are compressed, and upsert the pool
 * `index.json`. Idempotent per mode.
 *
 * A dump the engine already gzipped is left exactly as it is — re-packing a
 * multi-GB archive to change its container buys nothing. Only a raw dump goes
 * through zstd (which removes the raw with `--rm`).
 */
export async function finalizePool(
  mode: ResolvedMode,
  opts: { poolDir: string; dumpPath: string },
): Promise<FinalizePoolResult> {
  mkdirSync(opts.poolDir, { recursive: true });
  const preCompressed = isGzipFile(opts.dumpPath);
  // LUT first (reads the dump), THEN compress (which removes the raw with --rm).
  const rows = await writePoolLut(opts.dumpPath, opts.poolDir, mode.mode, mode.curate.capMaxWin);
  const compressed = preCompressed || compressPoolBooks(opts.dumpPath, opts.poolDir, mode.mode);
  const books = preCompressed
    ? basename(opts.dumpPath)
    : `books_${mode.mode}.jsonl${compressed ? '.zst' : ''}`;
  upsertPoolIndex(opts.poolDir, mode.mode, mode.costMultiplier, books);
  return { rows, compressed, books };
}
