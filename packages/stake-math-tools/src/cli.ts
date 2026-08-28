import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMathConfig } from './pipeline/config';
import { resolveModes } from './mathConfig';
import { runSim } from './pipeline/sim';
import { curateModes } from './pipeline/curate';
import { finalizePool, poolCompressionDisabled } from './pipeline/pool';
import { formatGoReport, formatCurateReport } from './pipeline/report';

export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (!['sim', 'pool', 'curate', 'all'].includes(cmd)) {
    throw new Error(
      `usage: e8-math <sim|pool|curate|all> --config ./math.config.ts [--mode BASE] [--jobs N]`,
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

  if (cmd === 'sim' || cmd === 'pool') {
    if (cmd === 'pool') mkdirSync(poolDir, { recursive: true });
    for (const m of modes) {
      const dump = cmd === 'pool' ? resolve(poolDir, `books_${m.mode}.jsonl`) : undefined;
      const out = await runSim(cfg, m, { dump });
      console.log(formatGoReport(m.mode, out));
      if (dump) {
        // Compress the raw dump → books_<MODE>.jsonl.zst (-19) + lookUpTable, so the pool
        // is a compact Stake-style library instead of an 80–90 GB raw .jsonl.
        const fin = await finalizePool(m, { poolDir, dumpPath: dump });
        const books = fin.compressed
          ? `books_${m.mode}.jsonl.zst`
          : `books_${m.mode}.jsonl${poolCompressionDisabled() ? ' (raw — POOL_ZSTD_LEVEL=0)' : ' (raw — zstd absent)'}`;
        console.log(`  → ${poolDir}/${books} + lookUpTable_${m.mode}_0.csv (${fin.rows} rows)`);
      }
    }
    return;
  }

  if (cmd === 'curate') {
    // Read the raw pool dump each mode left behind and curate it into outDir.
    // Modes are independent, so `--jobs N` curates N of them at once; reports
    // still print in config order.
    mkdirSync(outDir, { recursive: true });
    const curated = await curateModes(modes, { poolDir, outDir, jobs: flags.jobs });
    for (const c of curated) console.log(formatCurateReport(c.mode, c.result));
    console.log(`\nDone. Stake artifacts in ${outDir}`);
    return;
  }

  // 'all' — pool (native dump) → native report → curate → curate report.
  //
  // The pool stage stays sequential: the engine's own workers already saturate
  // the CPU, so running modes side by side there buys nothing (measured ~1.0×).
  // The curate stage is Node-side and single-threaded per mode, so that is where
  // `--jobs` pays off.
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const m of modes) {
    const dump = resolve(poolDir, `books_${m.mode}.jsonl`);
    const go = await runSim(cfg, m, { dump });
    console.log(formatGoReport(m.mode, go));
    // Compress + LUT the pool, then curate reads the LUT (no multi-GB decompress).
    const fin = await finalizePool(m, { poolDir, dumpPath: dump });
    if (!fin.compressed && !poolCompressionDisabled()) {
      process.stderr.write(`  [${m.mode}] pool kept raw (zstd absent)\n`);
    }
  }
  const curated = await curateModes(modes, { poolDir, outDir, jobs: flags.jobs });
  for (const c of curated) console.log(formatCurateReport(c.mode, c.result));
  console.log(`\nDone. Stake artifacts in ${outDir}`);
}

export interface CliFlags {
  config?: string;
  mode?: string;
  out?: string;
  iterations?: number;
  /** Modes curated concurrently. Unset = 1 (sequential, the safe default for memory). */
  jobs?: number;
}

export function parseFlags(argv: string[]): CliFlags {
  const out: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--iterations') out.iterations = parseInt(argv[++i], 10);
    else if (argv[i] === '--jobs') out.jobs = parseInt(argv[++i], 10);
  }
  return out;
}
