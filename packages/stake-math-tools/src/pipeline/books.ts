/**
 * Books stage: the heavy half of the two-pass build.
 *
 * curate has already picked which rounds ship and under which book id. This
 * re-runs the same simulation — same master seed, so the same rounds — but
 * hands the engine that list, so only those rounds are computed at all. On a
 * real game the selected rounds are ~5% of the pool.
 *
 * There are three ways to get from there to `books_<MODE>.jsonl.zst`, and the
 * pipeline picks by what the config asks for:
 *
 *   1. no `transformEvents`      the engine writes the finished books itself.
 *                                Nothing is parsed on this side at all.
 *   2. gated `transformEvents`   the engine writes the books, and a byte-level
 *                                pass rewrites only the lines big enough for the
 *                                transform to care about (paper-duel's 1 MiB
 *                                guard touches a handful of books in 400k).
 *   3. ungated `transformEvents` the engine dumps rounds and the pipeline
 *                                assembles every book, as it always has.
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runSim } from './sim.js';
import { assembleBooks, readSelection, selectionPath, upsertIndex } from './curate.js';
import { rewriteOversizedBooks } from './books-rewrite.js';
import { readManifest, assertManifestMatches, hashSpin } from './manifest.js';
import type { MathConfig, ResolvedMode } from '../mathConfig';

export interface BooksResult {
  /** Books written (== curated lookUpTable rows). */
  rows: number;
  /** Distinct pool rounds the engine was asked to serialize. */
  rounds: number;
  /** Largest serialized `events` field, in bytes. */
  maxEventsBytes: number;
  /** Book id holding it. */
  maxEventsBytesBookId: number;
  /** Books over Stake's per-book `events` limit. */
  booksOverEventsLimit: number;
  /** Which of the three routes above produced the books. */
  route: 'engine' | 'engine+rewrite' | 'pipeline';
  /** Books the gated transform actually rewrote (route 2 only). */
  rewritten?: number;
}

/** Compress `<books>.jsonl` → `.jsonl.zst`, removing the raw. Best-effort: zstd may be absent. */
function compressBooks(rawPath: string, zstPath: string, mode: string): void {
  try {
    execFileSync('zstd', ['-9', '-T0', '-q', '-f', '--rm', rawPath, '-o', zstPath], { stdio: 'inherit' });
  } catch {
    process.stderr.write(
      `  [${mode}] zstd not found — wrote raw books_${mode}.jsonl; install zstd for the .zst\n`,
    );
  }
}

/**
 * Run the heavy pass for one mode and write its books.
 *
 * `keepDump` leaves the intermediate round dump in the pool (routes 2 and 3
 * only — route 1 never writes one).
 */
export async function runBooksStage(
  cfg: MathConfig,
  mode: ResolvedMode,
  opts: { poolDir: string; outDir: string; keepDump?: boolean },
): Promise<BooksResult> {
  const manifest = readManifest(opts.poolDir, mode.mode);
  if (!manifest) {
    throw new Error(
      `[${mode.mode}] no pool manifest in ${opts.poolDir} — the books stage replays the pool's ` +
        `own run and needs its master seed. Run \`e8-math pool --mode ${mode.mode}\` first.`,
    );
  }
  assertManifestMatches(manifest, mode, hashSpin(cfg.luaScript));

  mkdirSync(opts.outDir, { recursive: true });
  const originalSims = readSelection(opts.poolDir, mode.mode);
  const rounds = new Set(originalSims.filter((s) => s >= 0)).size;
  if (rounds === 0) {
    throw new Error(`[${mode.mode}] the selection holds no real pool rounds — nothing to serialize.`);
  }
  const mapPath = selectionPath(opts.poolDir, mode.mode);
  const zstPath = join(opts.outDir, `books_${mode.mode}.jsonl.zst`);
  const gate = mode.transformEventsWhenBytesOver;

  // ── Route 3: an ungated transform has to see every book, so the engine dumps
  //    rounds and the pipeline assembles them line by line.
  if (mode.transformEvents && gate === undefined) {
    const dumpPath = join(opts.poolDir, `books_${mode.mode}.jsonl.gz`);
    if (existsSync(dumpPath)) unlinkSync(dumpPath);
    await runSim(cfg, mode, { dump: dumpPath, onlyRounds: mapPath, seed: manifest.masterSeed });
    const stats = await assembleBooks(mode, { poolDir: opts.poolDir, outDir: opts.outDir, dumpPath });
    if (!opts.keepDump && existsSync(dumpPath)) unlinkSync(dumpPath);
    return {
      rows: stats.rows, rounds, route: 'pipeline',
      maxEventsBytes: stats.maxEventsBytes,
      maxEventsBytesBookId: stats.maxEventsBytesBookId,
      booksOverEventsLimit: stats.booksOverEventsLimit,
    };
  }

  // ── Routes 1 & 2: the engine writes the finished books. Route 2 needs them
  //    readable in-process afterwards, so it asks for gzip (zlib is built into
  //    Node; zstd would mean spawning a decompressor to read our own output).
  const rewriting = mode.transformEvents !== undefined;
  const enginePath = rewriting
    ? join(opts.poolDir, `books_${mode.mode}.engine.jsonl.gz`)
    : zstPath;
  if (existsSync(enginePath)) unlinkSync(enginePath);
  if (existsSync(zstPath)) unlinkSync(zstPath);

  const out = await runSim(cfg, mode, {
    booksMap: mapPath,
    booksOut: enginePath,
    booksCap: mode.curate.capMaxWin,
    seed: manifest.masterSeed,
  });
  const engineStats = out.books;
  if (!engineStats) {
    throw new Error(
      `[${mode.mode}] the engine did not report book stats — it is too old for \`-books-map\`. ` +
        `Update the e8 binary, or run the pool with --full for the one-pass build.`,
    );
  }

  if (!rewriting) {
    upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);
    return {
      rows: engineStats.written, rounds, route: 'engine',
      maxEventsBytes: engineStats.maxEventsBytes,
      maxEventsBytesBookId: engineStats.maxEventsBookId,
      booksOverEventsLimit: engineStats.overEventsLimit,
    };
  }

  const rawPath = join(opts.outDir, `books_${mode.mode}.jsonl`);
  const rewrite = await rewriteOversizedBooks({
    inPath: enginePath, outPath: rawPath, mode, gate: gate!,
  });
  if (!opts.keepDump && existsSync(enginePath)) unlinkSync(enginePath);
  compressBooks(rawPath, zstPath, mode.mode);
  upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);
  return {
    rows: engineStats.written, rounds, route: 'engine+rewrite',
    rewritten: rewrite.rewritten,
    maxEventsBytes: rewrite.maxEventsBytes,
    maxEventsBytesBookId: rewrite.maxEventsBytesBookId,
    booksOverEventsLimit: rewrite.booksOverEventsLimit,
  };
}
