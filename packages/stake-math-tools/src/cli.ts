import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMathConfig } from './pipeline/config';
import { resolveModes } from './mathConfig';
import { runSim } from './pipeline/sim';
import { curateModes } from './pipeline/curate';
import { runBooksStage } from './pipeline/books';
import { poolDumpPath } from './pipeline/dump-io';
import { hashSpin } from './pipeline/manifest';
import type { MathConfig, ResolvedMode } from './mathConfig';
import {
  finalizeLightPool, finalizePool, normalizeDumpPath, poolCompressionDisabled, poolZstdRequested,
} from './pipeline/pool';
import { formatGoReport, formatCurateReport } from './pipeline/report';

export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (!['sim', 'pool', 'curate', 'books', 'all'].includes(cmd)) {
    throw new Error(
      `usage: e8-math <sim|pool|curate|books|all> --config ./math.config.ts ` +
        `[--mode BASE] [--jobs N] [--full] [--keep-dump]`,
    );
  }
  const cfg = await loadMathConfig(flags.config ?? './math.config.ts');
  let modes = resolveModes(cfg);
  if (flags.mode) modes = modes.filter((m) => m.mode === flags.mode);
  // --iterations N: override every selected mode's sim size (smoke runs).
  if (flags.iterations && Number.isFinite(flags.iterations)) {
    modes = modes.map((m) => ({ ...m, sim: { ...m.sim, iterations: flags.iterations! } }));
  }

  // Pool = raw per-round dump (input to curate). Out = curated Stake artifacts.
  const poolDir = resolve(process.cwd(), 'stake-math-pool');
  const outDir = resolve(process.cwd(), flags.out ?? 'stake-math');

  if (cmd === 'sim') {
    for (const m of modes) console.log(formatGoReport(m.mode, await runSim(cfg, m)));
    return;
  }

  if (cmd === 'pool') {
    mkdirSync(poolDir, { recursive: true });
    for (const m of modes) await poolMode(cfg, m, poolDir, fullPool(flags));
    return;
  }

  if (cmd === 'curate') {
    mkdirSync(outDir, { recursive: true });
    await curateAll(modes, poolDir, outDir, flags.jobs);
    return;
  }

  if (cmd === 'books') {
    mkdirSync(outDir, { recursive: true });
    for (const m of modes) await booksMode(cfg, m, poolDir, outDir, flags.keepDump);
    console.log(`\nDone. Stake artifacts in ${outDir}`);
    return;
  }

  // 'all' — pool → curate → books, end to end.
  //
  // The simulation stages stay sequential: the engine's own workers already
  // saturate the CPU, so running modes side by side there buys nothing
  // (measured ~1.0×). curate is Node-side and single-threaded per mode, so that
  // is where `--jobs` pays off.
  const full = fullPool(flags);
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const m of modes) await poolMode(cfg, m, poolDir, full);
  await curateAll(modes, poolDir, outDir, flags.jobs);
  if (!full) {
    for (const m of modes) await booksMode(cfg, m, poolDir, outDir, flags.keepDump);
  }
  console.log(`\nDone. Stake artifacts in ${outDir}`);
}

/**
 * Pool one mode.
 *
 * Default is the LIGHT pass: the engine writes `round,payoutCents` and nothing
 * else, which is all curate needs to choose rows. The rounds that survive are
 * serialized later by the `books` stage — on a real game that is ~5% of them,
 * against 100% here before.
 *
 * `--full` (or POOL_ZSTD_LEVEL, which only means anything for a full dump) asks
 * for the one-pass pool instead: every round serialized up front. Slower and
 * far bigger, but self-contained — `curate` alone then produces publishable
 * books, and old pools keep working.
 */
async function poolMode(
  cfg: MathConfig, m: ResolvedMode, poolDir: string, full: boolean,
): Promise<void> {
  if (full) {
    const dump = resolve(poolDir, poolDumpName(m.mode));
    console.log(formatGoReport(m.mode, await runSim(cfg, m, { dump })));
    const fin = await finalizePool(m, { poolDir, dumpPath: normalizeDumpPath(dump, m.mode) });
    if (!fin.compressed && !poolCompressionDisabled()) {
      process.stderr.write(`  [${m.mode}] pool kept raw (zstd absent)\n`);
    }
    console.log(
      `  → ${poolDir}/${fin.books}${rawNote(fin.compressed)} + ` +
        `lookUpTable_${m.mode}_0.csv (${fin.rows} rows)`,
    );
    return;
  }

  const csvPath = resolve(poolDir, `pool_${m.mode}.csv`);
  const out = await runSim(cfg, m, { dumpCsv: csvPath });
  console.log(formatGoReport(m.mode, out));
  if (!out.masterSeed) {
    throw new Error(
      `[${m.mode}] the engine reported no master seed, so the books stage could not replay ` +
        `these rounds. Update the e8 binary, or use --full for a one-pass pool.`,
    );
  }
  const fin = await finalizeLightPool(m, {
    poolDir, csvPath, masterSeed: out.masterSeed, spinHash: hashSpin(cfg.luaScript),
  });
  console.log(
    `  → ${poolDir}/pool_${m.mode}.csv + lookUpTable_${m.mode}_0.csv (${fin.rows} rows)`,
  );
}

/** Curate every mode. Events are left to the `books` stage unless the pool carries a full dump. */
async function curateAll(
  modes: readonly ResolvedMode[], poolDir: string, outDir: string, jobs?: number,
): Promise<void> {
  const skipEvents = modes.some((m) => poolDumpPath(poolDir, m.mode) === null);
  const curated = await curateModes(modes, { poolDir, outDir, jobs, skipEvents });
  for (const c of curated) console.log(formatCurateReport(c.mode, c.result));
}

/** Heavy pass + book assembly for one mode. */
async function booksMode(
  cfg: MathConfig, m: ResolvedMode, poolDir: string, outDir: string, keepDump?: boolean,
): Promise<void> {
  const res = await runBooksStage(cfg, m, { poolDir, outDir, keepDump });
  console.log(
    `  [${m.mode}] books: ${res.rows} row(s) from ${res.rounds} serialized round(s), ` +
      `largest events ${res.maxEventsBytes} B (book ${res.maxEventsBytesBookId})` +
      (res.booksOverEventsLimit > 0
        ? ` — ${res.booksOverEventsLimit} over Stake's limit!`
        : ''),
  );
}

/**
 * The dump file we ask the engine to write for one mode.
 *
 * `.gz` by default: `e8 simulate -dump …/books_<MODE>.jsonl.gz` compresses as it
 * writes, so the raw pool (tens of GB on a real game) never exists on disk and
 * no separate compression pass runs. Setting POOL_ZSTD_LEVEL asks for the legacy
 * path instead — raw dump, then zstd at that level (`0` = keep it raw).
 */
function poolDumpName(mode: string): string {
  return `books_${mode}.jsonl${poolZstdRequested() ? '' : '.gz'}`;
}

/** Why the pool's books ended up uncompressed, for the console line. */
function rawNote(compressed: boolean): string {
  if (compressed) return '';
  return poolCompressionDisabled() ? ' (raw — POOL_ZSTD_LEVEL=0)' : ' (raw — zstd absent)';
}

export interface CliFlags {
  config?: string;
  mode?: string;
  out?: string;
  iterations?: number;
  /** Modes curated concurrently. Unset = 1 (sequential, the safe default for memory). */
  jobs?: number;
  /** Serialize every round up front (the one-pass pool) instead of the two-pass build. */
  full?: boolean;
  /** Keep the heavy pass's filtered dump in the pool instead of deleting it. */
  keepDump?: boolean;
}

/** A full one-pass pool is asked for explicitly, or implied by POOL_ZSTD_LEVEL
 *  (which archives a dump — meaningless when no dump is written). */
function fullPool(flags: CliFlags): boolean {
  return flags.full === true || poolZstdRequested();
}

export function parseFlags(argv: string[]): CliFlags {
  const out: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--iterations') out.iterations = parseInt(argv[++i], 10);
    else if (argv[i] === '--jobs') out.jobs = parseInt(argv[++i], 10);
    else if (argv[i] === '--full') out.full = true;
    else if (argv[i] === '--keep-dump') out.keepDump = true;
  }
  return out;
}
