/**
 * Curate step: raw Go pool dump → Stake artifacts.
 *
 * Reads the raw per-round JSONL the `pool` command wrote
 * (`<poolDir>/books_<MODE>.jsonl`, one `RoundDumpRecord` per line),
 * derives a 1-weight lookup table (one row per simulation), runs it
 * through `optimizeLookupTable`, then writes the Stake-shaped outputs:
 *
 *   <outDir>/lookUpTable_<MODE>_0.csv   sim,weight,payoutCents (optimized rows)
 *   <outDir>/books_<MODE>.jsonl.zst     {"id","payoutMultiplier"} per optimized row
 *   <outDir>/index.json                 rich {modes:[{name,cost,events,weights}]} (upsert)
 *
 * Mirrors the shipped kitsune-wrath go-native→curate pipeline (native.ts +
 * optimize-lut.ts), minus its game-specific spin categorization — the payout
 * here is the generic sum of every spin's raw bet-multiplier (`win_x`).
 */

import {
  existsSync, mkdirSync, openSync, writeSync, readSync, closeSync, readFileSync,
  writeFileSync, unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { optimizeLookupTable } from '../optimize-lookup.js';
import { computeMetrics } from '../metrics.js';
import { STAKE_EVENTS_MAX_BYTES } from '../types.js';
import type { LookupRow, OptimizeParams, OptimizeResult } from '../types.js';
import type { ResolvedMode, CurateEventsTransform } from '../mathConfig';
import { createLineWriter, readLut, writeLut } from './lut-io.js';
import { dumpLineStream, poolDumpLineStream, poolDumpPath, type LineStream } from './dump-io.js';
import { readManifest } from './manifest.js';
import { mapWithConcurrency } from './concurrency.js';

export interface CurateOptions {
  /** Directory holding the pool (light CSV + lookUpTable, or a full round dump). */
  poolDir: string;
  /** Directory the Stake artifacts (CSV / books.zst / index.json) are written to. */
  outDir: string;
  /**
   * Skip the events pass and leave the books to the `books` stage.
   *
   * Left unset it is decided per mode: a LIGHT pool (a manifest and no round
   * dump) means the selected rounds have not been serialized yet — that is the
   * whole idea of the two-pass build — so there is nothing to read them from,
   * and curate stops after the lookUpTable and the selection. A pool with a
   * dump, or a bare lookUpTable with neither, behaves as it always has.
   */
  skipEvents?: boolean;
}

/**
 * curate's handoff to the books stage: `round,id,payoutCents` per curated row.
 *
 * The first column is what the JS path calls `originalSims` — which pool round
 * backs each row. The other two make the file directly usable as the engine's
 * `-books-map`, so the engine can write the finished book without the pipeline
 * parsing anything. One file rather than two: a separate selection and map could
 * drift apart, and they describe the same thing.
 *
 * `round = -1` marks a synthetic padding row — a book with empty events.
 */
export const selectionPath = (poolDir: string, mode: string): string =>
  join(poolDir, `selected_${mode}.csv`);

/** Read the selection back as `originalSims` (curated-row order preserved). */
export function readSelection(poolDir: string, mode: string): number[] {
  const path = selectionPath(poolDir, mode);
  if (!existsSync(path)) {
    throw new Error(
      `[${mode}] no selection in the pool (${path}) — run \`e8-math curate --mode ${mode}\` first; ` +
        `the books stage serializes exactly the rounds curate picked.`,
    );
  }
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => Number(l.split(',')[0]));
}

function writeSelection(poolDir: string, mode: string, rows: readonly LookupRow[], originalSims: readonly number[]): void {
  const w = createLineWriter(selectionPath(poolDir, mode));
  try {
    for (let i = 0; i < rows.length; i++) {
      w.write(`${originalSims[i]},${rows[i].sim},${rows[i].payoutCents}\n`);
    }
  } finally {
    w.close();
  }
}

/**
 * Map one raw Go `-dump` round line to a 1-weight lookup row.
 *
 * The per-round RAW payout (bet-multiplier) is `Σ spins[].win_x` — each
 * `win_x` is that spin's raw bet-multiplier win (verified against the live
 * binary). We do NOT use `total_win_x` (that's ÷round_cost, RTP-adjusted)
 * nor `total_win`. `payoutCents = min(round(rawWin × 100), capMaxWin)`,
 * where `capMaxWin` is in CENTS (= spec.maxWin × 100).
 *
 * Returns null for blank lines so the caller can skip them. `sim` is the
 * line's 0-based index in the file (Go workers write out of order, but the
 * line index is the canonical sim_id the LUT/events are positionally
 * validated against).
 */
export function roundToRow(line: string, sim: number, capMaxWin: number): LookupRow | null {
  if (!line.trim()) return null;
  const rec = JSON.parse(line) as { spins?: { win_x?: number }[]; total_win?: number };
  const rawWin = Array.isArray(rec.spins)
    ? rec.spins.reduce((s, sp) => s + (sp.win_x ?? 0), 0)
    : (rec.total_win ?? 0);
  const payoutCents = Math.min(Math.round(rawWin * 100), capMaxWin);
  return { sim, weight: 1, payoutCents };
}

/** Stream a pool dump line stream (raw / `.gz` / `.zst`) into a 1-weight LUT. */
async function readPoolDump(rl: LineStream, capMaxWin: number): Promise<LookupRow[]> {
  const rows: LookupRow[] = [];
  let sim = 0;
  for await (const line of rl) {
    const row = roundToRow(line, sim, capMaxWin);
    if (row) { rows.push(row); sim++; }
  }
  return rows;
}

/**
 * Read the source rows for one mode from the pool. Prefers the pre-built
 * `lookUpTable_<MODE>_0.csv` (written by `finalizePool` — small + fast, no need
 * to touch the multi-GB books); falls back to the raw `books_<MODE>.jsonl`
 * dump when no LUT is present (e.g. a bare `runSim --dump` without finalize).
 */
async function readPoolRows(poolDir: string, mode: string, capMaxWin: number): Promise<LookupRow[]> {
  const lutPath = join(poolDir, `lookUpTable_${mode}_0.csv`);
  if (existsSync(lutPath)) return readLut(lutPath);
  const rl = poolDumpLineStream(poolDir, mode);
  if (rl) return readPoolDump(rl, capMaxWin);
  throw new Error(
    `pool not found for ${mode}: expected lookUpTable_${mode}_0.csv or books_${mode}.jsonl[.gz|.zst] in ${poolDir} — run \`e8-math pool\` (or \`all\`) first`,
  );
}

/** Non-decreasing? Then the books can be written as they are read. */
function isAscending(sims: readonly number[]): boolean {
  for (let i = 1; i < sims.length; i++) if (sims[i] < sims[i - 1]) return false;
  return true;
}

/** The event stream for one mode: an explicit dump (the heavy pass's output) when given,
 *  otherwise whatever the pool holds. */
function openEvents(poolDir: string, mode: string, dumpPath?: string): LineStream | null {
  if (dumpPath) return existsSync(dumpPath) ? dumpLineStream(dumpPath) : null;
  return poolDumpLineStream(poolDir, mode);
}

/** One dumped spin → one canonical Stake book event: `{ type, spin }` and NOTHING else. Stake's
 *  book validator rejects extra event-level fields (`index`/`win`/`winX`/`data`/`stage`/`spinIdx`),
 *  so the per-spin payload (grid/wins/free_spins the game renders) is renamed `data` → `spin`. The
 *  per-segment win lives in `spin.total_win` (injected from the dump's top-level `win_x`, which the
 *  raw Lua/Go payload omits) — the adapter reads it from there. `type` is stage-derived so the game
 *  can tell a free spin from the trigger; a bonus book is the trigger + every free spin in one
 *  `events` array (the kitsune shape). */
function spinToEvent(spin: Record<string, unknown>): Record<string, unknown> {
  const stage = typeof spin.stage === 'string' ? spin.stage : undefined;
  const type = stage === 'free_spins' ? 'free_spin' : 'spin';
  const winX = typeof spin.win_x === 'number' ? spin.win_x : 0;
  const rawData = spin.data;
  const payload: Record<string, unknown> =
    rawData !== null && typeof rawData === 'object' && !Array.isArray(rawData)
      ? { ...(rawData as Record<string, unknown>), total_win: winX }
      : { total_win: winX };
  return { type, spin: payload };
}

/** Stake stratification label for a round (`criteria` enum): `"0"` (no win), `"freegame"` (ran a
 *  feature), `"wincap"` (reached the declared cap), else `"basegame"`. */
function deriveCriteria(
  payoutCents: number,
  events: Record<string, unknown>[],
  capCents: number,
): string {
  if (payoutCents <= 0) return '0';
  if (capCents > 0 && payoutCents >= capCents) return 'wincap';
  return events.some((e) => e.type === 'free_spin') ? 'freegame' : 'basegame';
}

/**
 * Resolve the optimizer params from the mode's curate overrides, defaulting
 * any unspecified target to the source distribution (preserve it) — same
 * policy kitsune's optimize-lut uses. `capMaxWin` is required (in cents) and
 * supplied by `resolveModes`.
 */
function resolveOptimizeParams(curate: ResolvedMode['curate'], source: LookupRow[]): OptimizeParams {
  const m = computeMetrics(source);
  const nRowsOut = curate.nRowsOut ?? Math.max(1, Math.min(100_000, Math.floor(source.length / 2)));
  return {
    targetRTP: curate.targetRTP ?? m.rtp,
    toleranceRTP: curate.toleranceRTP ?? 0.001,
    targetCV: curate.targetCV ?? m.cv,
    toleranceCV: curate.toleranceCV ?? 1,
    targetHitRate: curate.targetHitRate ?? m.hitRate,
    toleranceHitRate: curate.toleranceHitRate ?? 0.005,
    ...curate,
    nRowsOut,
    capMaxWin: curate.capMaxWin,
  };
}

/**
 * Emit one `{"id","payoutMultiplier","events":[...]}` line per optimized LUT row (guarantees
 * LUT↔events positional consistency — Stake validates that an event's payoutMultiplier equals its
 * LUT row's payoutCents), then zstd `-9` compress to `books_<MODE>.jsonl.zst` and remove the raw.
 *
 * `events[i]` are the round's spins (trigger + all free spins) collected into one array — so a
 * bonus book is a SINGLE round the game can replay spin-by-spin, matching the kitsune library.
 * When no per-round events were available (no dump), `events` is `[]`.
 *
 * MEMORY: the pool dump is streamed once and each selected round's events are serialized to a
 * temp file the moment they're read — only ONE round's parsed payload is ever resident. This is
 * why curate memory is O(1 round) instead of O(nRowsOut × book-size): a high-cost bonus mode with
 * 150k selected rounds of ~40KB each would otherwise materialize ~20GB of parsed objects at once.
 *
 * Ordering: the dump is in pool-sim order but the published books MUST be in curated-row order
 * (0,1,2,… — the LUT sim column lines up positionally with the book `id`). We record each output
 * row's (offset,len) in the temp file, then a second pass reads the temp file in row order (random
 * access by offset) and writes the final `books_<MODE>.jsonl`. The `slot` index is a few MB; the
 * event payloads never all land in the heap.
 *
 * `zstd` may not be on PATH. On failure we keep the raw `.jsonl`, log a note, and do NOT fail.
 */
/** Byte-size stats for the serialized `events` arrays, surfaced to the curate report. */
interface EventsSizeStats {
  /** Largest serialized `events` field across all books, in UTF-8 bytes. */
  maxEventsBytes: number;
  /** Book id (== LUT sim) that holds the largest `events` field, or -1 when no books. */
  maxEventsBytesBookId: number;
  /** How many books exceed `STAKE_EVENTS_MAX_BYTES`. */
  booksOverEventsLimit: number;
  /** False when the pool holds no round dump at all — every book is written event-less. */
  dumpFound: boolean;
}

async function streamWriteEvents(
  rows: LookupRow[],
  originalSims: number[],
  poolDir: string,
  outDir: string,
  mode: string,
  capCents: number,
  transformEvents?: CurateEventsTransform,
  dumpPath?: string,
): Promise<EventsSizeStats> {
  const rawPath = join(outDir, `books_${mode}.jsonl`);
  const zstPath = join(outDir, `books_${mode}.jsonl.zst`);
  const tmpPath = join(outDir, `books_${mode}.tmp.jsonl`);
  for (const p of [rawPath, zstPath, tmpPath]) if (existsSync(p)) unlinkSync(p);

  // Pool sim → output-row indices that need that round's events. Synthetic padding rows
  // (sim < 0) carry no events and are filled with `[]` in the fill pass below.
  const simToOut = new Map<number, number[]>();
  for (let i = 0; i < originalSims.length; i++) {
    const s = originalSims[i];
    if (s < 0) continue;
    const arr = simToOut.get(s);
    if (arr) arr.push(i);
    else simToOut.set(s, [i]);
  }

  // Per-output-row location of its serialized book line in the temp file (null until written).
  const slot: ({ off: number; len: number } | null)[] = new Array(rows.length).fill(null);

  const stats: EventsSizeStats = { maxEventsBytes: 0, maxEventsBytesBookId: -1, booksOverEventsLimit: 0, dumpFound: false };

  // Ascending rows (what curate now produces) mean the dump — itself ascending by round — arrives
  // in exactly the order the books must be written, so each line goes straight to its final home.
  // A pool whose rows are NOT ascending (an older selection, a hand-built LUT) still works: books
  // are staged in a temp file and reordered by offset below.
  const streaming = isAscending(originalSims);
  const outPath = streaming ? rawPath : tmpPath;
  const tmpFd = openSync(outPath, 'w');
  let tmpOff = 0;
  const appendBook = (outIdx: number, events: Record<string, unknown>[]): void => {
    const r = rows[outIdx];
    // Optional per-book (per-line) events conversion, applied before size-check + criteria so both
    // reflect exactly what ships. Must return an array; a throw here fails the run loudly (config bug).
    let outEvents = events;
    if (transformEvents) {
      outEvents = transformEvents(events, {
        mode, bookId: r.sim, payoutCents: r.payoutCents, capCents,
      });
      if (!Array.isArray(outEvents)) {
        throw new Error(
          `transformEvents must return an array (book id ${r.sim}, mode ${mode}), got ${typeof outEvents}`,
        );
      }
    }
    // Canonical Stake book row: {id, payoutMultiplier (integer cents = CSV col3), events:[{type,spin}], criteria}.
    // Serialize `events` ONCE and splice it into the line so we can measure its exact UTF-8 size
    // (Stake caps a book's `events` field at STAKE_EVENTS_MAX_BYTES) without a second stringify pass.
    const eventsJson = JSON.stringify(outEvents);
    const eventsBytes = Buffer.byteLength(eventsJson, 'utf8');
    if (eventsBytes > stats.maxEventsBytes) {
      stats.maxEventsBytes = eventsBytes;
      stats.maxEventsBytesBookId = r.sim;
    }
    if (eventsBytes > STAKE_EVENTS_MAX_BYTES) stats.booksOverEventsLimit++;
    const criteria = deriveCriteria(r.payoutCents, outEvents, capCents);
    const line =
      `{"id":${r.sim},"payoutMultiplier":${r.payoutCents},"events":${eventsJson},` +
      `"criteria":${JSON.stringify(criteria)}}\n`;
    const buf = Buffer.from(line, 'utf8');
    writeSync(tmpFd, buf, 0, buf.length, tmpOff);
    slot[outIdx] = { off: tmpOff, len: buf.length };
    tmpOff += buf.length;
  };

  // Pass 1: stream the dump once, serializing each selected round as it's read.
  //
  // A round is identified by its `round_idx` when the record carries one (every
  // `e8 simulate` dump does) and by its line index otherwise. Those agree in a
  // full pool — the dump is ordered by round — but only the former survives the
  // heavy pass of the two-pass build, where the file holds just the ~5% of
  // rounds that were selected and line 0 is round 4172.
  const rl = simToOut.size > 0 ? openEvents(poolDir, mode, dumpPath) : null;
  stats.dumpFound = rl !== null;
  if (rl) {
    let line_no = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      let events: Record<string, unknown>[] = [];
      let sim = line_no;
      let parsed = false;
      try {
        const rec = JSON.parse(line) as { spins?: Record<string, unknown>[]; round_idx?: number };
        if (typeof rec.round_idx === 'number') sim = rec.round_idx;
        const outIdxs = simToOut.get(sim);
        if (outIdxs) {
          const spins = Array.isArray(rec.spins) ? rec.spins : [];
          events = spins.map(spinToEvent);
          parsed = true;
        }
      } catch { /* malformed line → treat as unselected/empty (graceful) */ }
      if (parsed) {
        const outIdxs = simToOut.get(sim)!;
        for (const outIdx of outIdxs) appendBook(outIdx, events);
        simToOut.delete(sim); // done with this sim — free the mapping
      }
      line_no++;
    }
  }

  // A curated row's `sim` IS the dump's line index, so every selected sim must have been found.
  // Whatever is still in `simToOut` is a round the pool does not contain — the pool and the
  // lookUpTable describe different runs, or the dump is short. Those rows would otherwise ship as
  // books with an empty `events` array: valid JSON, accepted by every check we run, and dead on
  // screen. Padding rows never get here (they carry sim < 0 and were skipped when the map was built).
  if (rl && simToOut.size > 0) {
    const affected = [...simToOut.values()].reduce((n, idxs) => n + idxs.length, 0);
    closeSync(tmpFd);
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    throw new Error(
      `[${mode}] pool is missing ${simToOut.size} of the ${originalSims.filter((s) => s >= 0).length} ` +
        `rounds the lookUpTable selected (${affected} curated row(s) affected) — ` +
        `books_${mode}.jsonl[.gz|.zst] does not describe the same run as lookUpTable_${mode}_0.csv. ` +
        `Re-run the pool stage, or curate against the dump that produced this LUT.`,
    );
  }

  // Pass 2: fill the rows that legitimately have no dump line — synthetic padding rows (sim < 0),
  // and every row when the pool carries no dump at all (curate off a bare LUT).
  for (let i = 0; i < rows.length; i++) {
    if (slot[i] === null) appendBook(i, []);
  }
  closeSync(tmpFd);

  // Pass 3: reorder temp → final raw books in curated-row order (random access by offset). One
  // reusable buffer sized to the largest line; only one book line is resident at a time.
  // Skipped entirely on the streaming path — `appendBook` already wrote in row order.
  if (!streaming) {
    let maxLen = 1;
    for (const s of slot) if (s && s.len > maxLen) maxLen = s.len;
    const buf = Buffer.allocUnsafe(maxLen);
    const readFd = openSync(tmpPath, 'r');
    const outFd = openSync(rawPath, 'w');
    for (let i = 0; i < rows.length; i++) {
      const s = slot[i]!; // pass 2 guarantees every row is filled
      readSync(readFd, buf, 0, s.len, s.off);
      writeSync(outFd, buf, 0, s.len);
    }
    closeSync(readFd);
    closeSync(outFd);
    unlinkSync(tmpPath);
  }

  try {
    // `--rm` removes the raw .jsonl on success; same call kitsune's native.ts uses.
    execFileSync('zstd', ['-9', '-T0', '-q', '-f', '--rm', rawPath, '-o', zstPath], { stdio: 'inherit' });
  } catch {
    process.stderr.write(
      `  [${mode}] zstd not found — wrote raw books_${mode}.jsonl; install zstd for the .zst\n`,
    );
  }

  return stats;
}

interface IndexMode { name: string; cost: number; events: string; weights: string }
interface IndexJson { modes: IndexMode[] }

/** Upsert this mode's entry into `<outDir>/index.json` (keep sibling modes). */
export function upsertIndex(outDir: string, mode: string, cost: number): void {
  const path = join(outDir, 'index.json');
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
    events: `books_${mode}.jsonl.zst`,
    weights: `lookUpTable_${mode}_0.csv`,
  };
  const i = index.modes.findIndex((m) => m.name === mode);
  if (i >= 0) index.modes[i] = entry;
  else index.modes.push(entry);
  writeFileSync(path, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Read the raw pool dump for one mode, optimize it, and write the Stake
 * artifacts into `outDir`. Returns the full `OptimizeResult` for reporting.
 */
export async function curateMode(mode: ResolvedMode, opts: CurateOptions): Promise<OptimizeResult> {
  mkdirSync(opts.outDir, { recursive: true });
  const rawRows = await readPoolRows(opts.poolDir, mode.mode, mode.curate.capMaxWin);

  const params = resolveOptimizeParams(mode.curate, rawRows);
  const result = optimizeLookupTable(rawRows, params);

  // Capture each selected row's original pool round BEFORE renumbering — the event stream keys
  // off it. Held as a flat number[] (a few MB), not the parsed event payloads.
  //
  // Sorted by that round first, which costs nothing here and saves a whole pass over the books
  // later: the dump is written in ascending round order, so ascending rows let the writer stream
  // it straight out instead of buffering every book and reordering by offset. Synthetic padding
  // rows (sim < 0) sort to the front and are filled with empty events either way. Row order is
  // ours to choose — Stake only requires that ids be contiguous and line up with the LUT.
  result.rows.sort((a, b) => a.sim - b.sim);
  const originalSims = result.rows.map((r) => r.sim);

  // Renumber the curated rows with curate's OWN 0-based contiguous ids (matching the shipped
  // kitsune library: lookUpTable sim column and books `id` both run 0,1,2,…). The optimizer keeps
  // each surviving row's original pool sim, which is sparse after selection — Stake expects the
  // published set to be contiguous and the LUT sim ↔ book id to line up positionally.
  result.rows.forEach((r, i) => { r.sim = i; });

  writeLut(result.rows, join(opts.outDir, `lookUpTable_${mode.mode}_0.csv`));
  // The selection is curate's real output in a two-pass build: these are the rounds
  // worth serializing. Written even on the one-pass path — it costs a few MB and it
  // is the only record of which pool round each published book came from.
  writeSelection(opts.poolDir, mode.mode, result.rows, originalSims);

  if (opts.skipEvents) {
    upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);
    result.warnings.push(
      `books not written yet — ${result.rows.length} round(s) selected into ` +
        `selected_${mode.mode}.csv; run \`e8-math books --mode ${mode.mode}\` to serialize them.`,
    );
    return result;
  }

  const eventsSize = await streamWriteEvents(
    result.rows, originalSims, opts.poolDir, opts.outDir, mode.mode, mode.curate.capMaxWin,
    mode.transformEvents,
  );
  upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);

  // Fold the just-measured events-size stats into the stake report + warnings.
  result.stakeReport.maxEventsBytes = eventsSize.maxEventsBytes;
  result.stakeReport.maxEventsBytesBookId = eventsSize.maxEventsBytesBookId;
  result.stakeReport.booksOverEventsLimit = eventsSize.booksOverEventsLimit;
  if (!eventsSize.dumpFound) {
    result.warnings.push(
      `no round dump in the pool — books_${mode.mode}.jsonl was written without events ` +
        `(every book has an empty \`events\` array). Fine while tuning weights off the ` +
        `lookUpTable; NOT publishable. Run \`e8-math pool\` to restore the dump.`,
    );
  }
  if (eventsSize.booksOverEventsLimit > 0) {
    result.warnings.push(
      `${eventsSize.booksOverEventsLimit} book(s) exceed Stake's ${STAKE_EVENTS_MAX_BYTES}-byte events ` +
        `limit (largest ${eventsSize.maxEventsBytes} bytes at book id ${eventsSize.maxEventsBytesBookId}) — ` +
        `these will be rejected on publication`,
    );
  }

  return result;
}

/** One mode's curate outcome, tagged so reports stay attributable after a parallel run. */
/**
 * Serialize the books for one mode from a dump that holds the selected rounds.
 *
 * This is the second half of `curateMode`, split out for the two-pass build: by
 * the time the heavy pass has run, the lookUpTable and the selection are already
 * on disk, so the rows come from `<outDir>/lookUpTable_<MODE>_0.csv` and the
 * pool-round mapping from `selected_<MODE>.csv`. Every book's `id` still lines
 * up positionally with its LUT row — that is what the selection preserves.
 */
export async function assembleBooks(
  mode: ResolvedMode,
  opts: { poolDir: string; outDir: string; dumpPath: string },
): Promise<EventsSizeStats & { rows: number }> {
  const rows = await readLut(join(opts.outDir, `lookUpTable_${mode.mode}_0.csv`));
  const originalSims = readSelection(opts.poolDir, mode.mode);
  if (rows.length !== originalSims.length) {
    throw new Error(
      `[${mode.mode}] the selection has ${originalSims.length} round(s) but the curated ` +
        `lookUpTable has ${rows.length} row(s) — they are from different curate runs. ` +
        `Re-run \`e8-math curate --mode ${mode.mode}\`.`,
    );
  }
  const stats = await streamWriteEvents(
    rows, originalSims, opts.poolDir, opts.outDir, mode.mode, mode.curate.capMaxWin,
    mode.transformEvents, opts.dumpPath,
  );
  upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);
  return { ...stats, rows: rows.length };
}

export interface CuratedMode {
  mode: string;
  result: OptimizeResult;
}

export interface CurateModesOptions extends CurateOptions {
  /** Modes curated at once. Default 1 — see the note on memory below. */
  jobs?: number;
}

/**
 * Curate several modes, up to `jobs` at a time, returning their reports in the
 * order the modes were given (not the order they finished).
 *
 * Modes share nothing but `outDir`, and the one thing they all write —
 * `index.json` — is upserted with a synchronous read-modify-write, so a task
 * switch can never land inside it.
 *
 * `jobs` defaults to 1 because the cost is memory, not CPU: each in-flight mode
 * holds its entire source LUT plus the optimizer's working copies (a 6M-round
 * BASE is several hundred MB), so the useful setting depends on the game and
 * the machine rather than on the core count.
 */
export async function curateModes(
  modes: readonly ResolvedMode[],
  opts: CurateModesOptions,
): Promise<CuratedMode[]> {
  return mapWithConcurrency(modes, opts.jobs ?? 1, async (m) => ({
    mode: m.mode,
    // Per mode, not per run: a pool can hold a light mode next to one that was
    // dumped in full, and deciding once for all of them would either skip books
    // that could be written now or try to read a dump that does not exist.
    result: await curateMode(m, { ...opts, skipEvents: opts.skipEvents ?? isLightPool(opts.poolDir, m.mode) }),
  }));
}

/** A light pool: the manifest is there, the round dump is not — the books stage owes us events. */
function isLightPool(poolDir: string, mode: string): boolean {
  return poolDumpPath(poolDir, mode) === null && readManifest(poolDir, mode) !== null;
}
