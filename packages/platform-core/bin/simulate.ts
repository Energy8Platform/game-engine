#!/usr/bin/env npx tsx
import { SimulationRunner, formatSimulationResult } from '../src/lua/SimulationRunner';
import { ParallelSimulationRunner } from '../src/simulation/ParallelSimulationRunner';
import { NativeSimulationRunner, findNativeBinary, formatNativeResult } from '../src/simulation/NativeSimulationRunner';
import { cpus } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Argument Parsing ───────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Boolean flags (no value)
      if (key === 'native' || key === 'js') {
        args[key] = 'true';
      } else if (i + 1 < argv.length) {
        args[key] = argv[++i];
      }
    }
  }
  return args;
}

type Rng = 'provably-fair' | 'fast';

function parseRng(value: string | undefined): Rng | undefined {
  if (!value) return undefined;
  if (value === 'provably-fair' || value === 'fast') return value;
  console.error(`Invalid --rng value: "${value}". Expected "provably-fair" or "fast".`);
  process.exit(1);
}

/**
 * The native binary takes a hex string seed; the JS RNG (fengari) takes a
 * 32-bit integer. Accept the same `--seed` flag for both: pass plain decimal
 * integers to the JS path, otherwise warn that the JS path doesn't honor hex
 * seeds and fall back to a non-deterministic run.
 */
function parseJsSeed(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  console.warn(`--seed=${value} is a hex/string seed; only the native binary honors hex seeds. JS run will be non-deterministic.`);
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv);

  const configPath = resolve(process.cwd(), args.config ?? './dev.config.ts');
  const iterations = parseInt(args.iterations ?? '1000000', 10);
  const bet = parseFloat(args.bet ?? '1');
  const seed = args.seed; // hex string for native; the JS path also accepts numeric
  const action = args.action ?? 'spin';
  const params = args.params ? JSON.parse(args.params) : undefined;
  const workers = args.workers ? parseInt(args.workers, 10) : cpus().length;
  const useNative = args.native === 'true';
  const useJs = args.js === 'true';
  const rng = parseRng(args.rng);

  const replayServerSeed = args['replay-server-seed'];
  const replayClientSeed = args['replay-client-seed'];
  const replayNonceStart = args['replay-nonce-start'];
  const replayFieldCount = [replayServerSeed, replayClientSeed, replayNonceStart].filter(Boolean).length;
  if (replayFieldCount !== 0 && replayFieldCount !== 3) {
    console.error('Replay mode requires all three flags: --replay-server-seed, --replay-client-seed, --replay-nonce-start');
    process.exit(1);
  }
  const replay = replayFieldCount === 3
    ? {
        serverSeed: replayServerSeed!,
        clientSeed: replayClientSeed!,
        nonceStart: parseInt(replayNonceStart!, 10),
      }
    : undefined;
  if (replay && rng && rng !== 'provably-fair') {
    console.error('Replay mode requires --rng=provably-fair');
    process.exit(1);
  }

  // Load dev config
  let config: any;
  try {
    const mod = await import(configPath);
    config = mod.default ?? mod.config ?? mod;
  } catch (e: any) {
    console.error(`Failed to load config from ${configPath}:`);
    console.error(e.message);
    process.exit(1);
  }

  if (!config.luaScript) {
    console.error('Config must contain `luaScript` (Lua source code string).');
    console.error('Make sure your dev.config.ts exports luaScript and gameDefinition.');
    process.exit(1);
  }

  if (!config.gameDefinition) {
    console.error('Config must contain `gameDefinition` (GameDefinition object).');
    process.exit(1);
  }

  const gameId = config.gameDefinition.id ?? 'unknown';

  // ─── Native binary detection ────────────────────────────
  // Search in config dir first, then in the game-engine package root
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const binaryPath = args.binary ?? (useJs ? null : (findNativeBinary(dirname(configPath)) ?? findNativeBinary(engineRoot)));

  if (useNative && !binaryPath) {
    console.error('Native simulation binary not found.');
    console.error('Use --binary <path> or set SIMULATE_BINARY environment variable.');
    process.exit(1);
  }

  const onProgress = (completed: number, total: number) => {
    const pct = Math.round((completed / total) * 100);
    console.log(`Progress: ${completed.toLocaleString()}/${total.toLocaleString()} (${pct}%)`);
  };

  // ─── Native binary path ─────────────────────────────────
  if (binaryPath) {
    console.log(`Using native binary: ${binaryPath}`);
    console.log(`Starting simulation for ${gameId} (${iterations.toLocaleString()} iterations, action: ${action})...`);

    const runner = new NativeSimulationRunner({
      binaryPath,
      script: config.luaScript,
      gameDefinition: config.gameDefinition,
      iterations,
      bet,
      action,
      params,
      seed,
      rng,
      replay,
    });
    const result = await runner.run();
    console.log(formatNativeResult(result));
    return;
  }

  // ─── JS simulation path ─────────────────────────────────
  if (rng || replay) {
    console.warn('--rng / --replay flags are only honored by the native binary; ignored in JS mode.');
  }
  const jsSeed = parseJsSeed(seed);
  const useParallel = workers > 1;
  console.log(`Starting simulation for ${gameId} (${iterations.toLocaleString()} iterations, action: ${action}, workers: ${useParallel ? workers : 1})...`);

  let result;

  if (useParallel) {
    const runner = new ParallelSimulationRunner({
      script: config.luaScript,
      gameDefinition: config.gameDefinition,
      iterations,
      bet,
      seed: jsSeed,
      action,
      params,
      workerCount: workers,
      onProgress,
    });
    result = await runner.run();
  } else {
    const runner = new SimulationRunner({
      script: config.luaScript,
      gameDefinition: config.gameDefinition,
      iterations,
      bet,
      seed: jsSeed,
      action,
      params,
      onProgress,
    });
    result = runner.run();
  }

  console.log(formatSimulationResult(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
