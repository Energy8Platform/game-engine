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
  existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync,
  writeFileSync, unlinkSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { optimizeLookupTable } from '../optimize-lookup.js';
import { computeMetrics } from '../metrics.js';
import type { LookupRow, OptimizeParams, OptimizeResult } from '../types.js';
import type { ResolvedMode } from '../mathConfig';

export interface CurateOptions {
  /** Directory holding the raw `books_<MODE>.jsonl` pool dump. */
  poolDir: string;
  /** Directory the Stake artifacts (CSV / books.zst / index.json) are written to. */
  outDir: string;
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

/** Stream the raw pool dump (`books_<MODE>.jsonl`) into a 1-weight LUT. */
async function readPoolDump(path: string, capMaxWin: number): Promise<LookupRow[]> {
  const rows: LookupRow[] = [];
  let sim = 0;
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf-8' }) });
  for await (const line of rl) {
    const row = roundToRow(line, sim, capMaxWin);
    if (row) { rows.push(row); sim++; }
  }
  return rows;
}

/** Stream a pre-built pool lookUpTable (`sim,weight,payoutCents`) into LookupRows. Line-at-a-time
 *  so a multi-million-row CSV never lands in memory as one giant string. */
async function readPoolLut(path: string): Promise<LookupRow[]> {
  const rows: LookupRow[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf-8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const [sim, weight, payoutCents] = line.split(',').map(Number);
    rows.push({ sim, weight, payoutCents });
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
  if (existsSync(lutPath)) return readPoolLut(lutPath);
  const rawPath = join(poolDir, `books_${mode}.jsonl`);
  if (existsSync(rawPath)) return readPoolDump(rawPath, capMaxWin);
  throw new Error(
    `pool not found for ${mode}: expected lookUpTable_${mode}_0.csv or books_${mode}.jsonl in ${poolDir} — run \`e8-math pool\` (or \`all\`) first`,
  );
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

/** A line stream over the pool's per-round dump for one mode: prefers the raw `.jsonl`, else
 *  decompresses `.jsonl.zst` via `zstd -dc`. Returns null when neither exists. */
function poolDumpLineStream(poolDir: string, mode: string): ReturnType<typeof createInterface> | null {
  const rawPath = join(poolDir, `books_${mode}.jsonl`);
  if (existsSync(rawPath)) {
    return createInterface({ input: createReadStream(rawPath, { encoding: 'utf-8' }) });
  }
  const zstPath = join(poolDir, `books_${mode}.jsonl.zst`);
  if (existsSync(zstPath)) {
    const proc = spawn('zstd', ['-dc', '-q', zstPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    return createInterface({ input: proc.stdout! });
  }
  return null;
}

/**
 * Read the per-round EVENTS (the round's `spins[]` mapped to book events) for the selected pool
 * sims. One pass over the pool dump, picking only the wanted line indices (the canonical sim ids).
 * Returns sim → events. Empty map when no dump is available (books then carry no events — graceful).
 */
async function readEventsForSims(
  poolDir: string,
  mode: string,
  sims: Set<number>,
): Promise<Map<number, Record<string, unknown>[]>> {
  const out = new Map<number, Record<string, unknown>[]>();
  const rl = poolDumpLineStream(poolDir, mode);
  if (!rl) return out;
  let sim = 0;
  for await (const line of rl) {
    if (line.trim()) {
      if (sims.has(sim)) {
        try {
          const rec = JSON.parse(line) as { spins?: Record<string, unknown>[] };
          const spins = Array.isArray(rec.spins) ? rec.spins : [];
          out.set(sim, spins.map(spinToEvent));
        } catch { /* skip malformed line */ }
      }
      sim++;
    }
  }
  return out;
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

function writeLut(rows: LookupRow[], path: string): void {
  if (existsSync(path)) unlinkSync(path);
  const fd = openSync(path, 'w');
  for (const r of rows) writeSync(fd, `${r.sim},${r.weight},${r.payoutCents}\n`);
  closeSync(fd);
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
 * `zstd` may not be on PATH. On failure we keep the raw `.jsonl`, log a note, and do NOT fail.
 */
function writeEvents(
  rows: LookupRow[],
  eventsPerRow: Record<string, unknown>[][],
  outDir: string,
  mode: string,
  capCents: number,
): void {
  const rawPath = join(outDir, `books_${mode}.jsonl`);
  const zstPath = join(outDir, `books_${mode}.jsonl.zst`);
  if (existsSync(rawPath)) unlinkSync(rawPath);
  if (existsSync(zstPath)) unlinkSync(zstPath);

  const fd = openSync(rawPath, 'w');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const events = eventsPerRow[i] ?? [];
    // Canonical Stake book row: {id, payoutMultiplier (integer cents = CSV col3), events:[{type,spin}], criteria}.
    writeSync(fd, JSON.stringify({
      id: r.sim,
      payoutMultiplier: r.payoutCents,
      events,
      criteria: deriveCriteria(r.payoutCents, events, capCents),
    }));
    writeSync(fd, '\n');
  }
  closeSync(fd);

  try {
    // `--rm` removes the raw .jsonl on success; same call kitsune's native.ts uses.
    execFileSync('zstd', ['-9', '-T0', '-q', '-f', '--rm', rawPath, '-o', zstPath], { stdio: 'inherit' });
  } catch {
    process.stderr.write(
      `  [${mode}] zstd not found — wrote raw books_${mode}.jsonl; install zstd for the .zst\n`,
    );
  }
}

interface IndexMode { name: string; cost: number; events: string; weights: string }
interface IndexJson { modes: IndexMode[] }

/** Upsert this mode's entry into `<outDir>/index.json` (keep sibling modes). */
function upsertIndex(outDir: string, mode: string, cost: number): void {
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

  // Pull each selected round's events (trigger + all free spins) from the pool dump BEFORE
  // renumbering — the optimizer's rows still carry their original pool sim (the dump line index).
  const originalSims = result.rows.map((r) => r.sim);
  const eventsBySim = await readEventsForSims(opts.poolDir, mode.mode, new Set(originalSims));
  const eventsPerRow = originalSims.map((s) => eventsBySim.get(s) ?? []);

  // Renumber the curated rows with curate's OWN 0-based contiguous ids (matching the shipped
  // kitsune library: lookUpTable sim column and books `id` both run 0,1,2,…). The optimizer keeps
  // each surviving row's original pool sim, which is sparse after selection — Stake expects the
  // published set to be contiguous and the LUT sim ↔ book id to line up positionally.
  result.rows.forEach((r, i) => { r.sim = i; });

  writeLut(result.rows, join(opts.outDir, `lookUpTable_${mode.mode}_0.csv`));
  writeEvents(result.rows, eventsPerRow, opts.outDir, mode.mode, mode.curate.capMaxWin);
  upsertIndex(opts.outDir, mode.mode, mode.costMultiplier);

  return result;
}
