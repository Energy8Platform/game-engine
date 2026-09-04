/**
 * Books stage: the heavy half of the two-pass build.
 *
 * curate has already picked which rounds ship. This re-runs the same simulation
 * — same master seed, so the same rounds — but hands the engine that list, so
 * only those rounds are serialized. Everything else is still simulated (the RNG
 * stream has to be identical) and then thrown away without ever becoming JSON,
 * which is where the time goes: on a real game the selected rounds are ~5% of
 * the pool.
 *
 * The dump it writes holds exactly the selected rounds, in ascending round
 * order, each with its `round_idx` — which is how `assembleBooks` matches a
 * round to the lookUpTable row that chose it.
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { runSim } from './sim.js';
import { assembleBooks, readSelection } from './curate.js';
import { createLineWriter } from './lut-io.js';
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
}

/**
 * Write the engine's round list: distinct, ascending, padding rows dropped.
 *
 * Curated rows may repeat a pool round (the optimizer can select the same round
 * for several output rows) and synthetic padding rows carry `sim < 0`. The
 * engine wants plain round indices; the row↔round mapping stays in the
 * selection file, which `assembleBooks` reads.
 */
function writeRoundList(path: string, originalSims: readonly number[]): number {
  const rounds = [...new Set(originalSims.filter((s) => s >= 0))].sort((a, b) => a - b);
  const w = createLineWriter(path);
  try {
    for (const r of rounds) w.write(`${r}\n`);
  } finally {
    w.close();
  }
  return rounds.length;
}

/**
 * Run the heavy pass for one mode and write its books.
 *
 * `keepDump` leaves the filtered round dump in the pool (a few GB at most —
 * only the selected rounds); by default it is removed once the books are
 * written, since re-running the stage regenerates it from the same seed.
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
  const listPath = join(opts.poolDir, `only_${mode.mode}.txt`);
  const rounds = writeRoundList(listPath, originalSims);
  if (rounds === 0) {
    throw new Error(`[${mode.mode}] the selection holds no real pool rounds — nothing to serialize.`);
  }

  const dumpPath = join(opts.poolDir, `books_${mode.mode}.jsonl.gz`);
  if (existsSync(dumpPath)) unlinkSync(dumpPath);
  await runSim(cfg, mode, { dump: dumpPath, onlyRounds: listPath, seed: manifest.masterSeed });

  const stats = await assembleBooks(mode, { poolDir: opts.poolDir, outDir: opts.outDir, dumpPath });
  if (!opts.keepDump) {
    for (const p of [dumpPath, listPath]) if (existsSync(p)) unlinkSync(p);
  }
  return {
    rows: stats.rows,
    rounds,
    maxEventsBytes: stats.maxEventsBytes,
    maxEventsBytesBookId: stats.maxEventsBytesBookId,
    booksOverEventsLimit: stats.booksOverEventsLimit,
  };
}
