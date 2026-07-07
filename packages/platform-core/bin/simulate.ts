#!/usr/bin/env npx tsx
// e8-only dev CLI: one math runtime — the Rust e8 SpinML engine (see
// stake-math-tools for the full sim/pool/curate pipeline). This wrapper
// stays for quick one-off runs against a dev.config.ts.
import { NativeSimulationRunner, findE8Binary, formatNativeResult } from '../src/simulation/NativeSimulationRunner';
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
      if (i + 1 < argv.length) {
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

async function main() {
  const args = parseArgs(process.argv);

  const configPath = resolve(process.cwd(), args.config ?? './dev.config.ts');
  const iterations = parseInt(args.iterations ?? '1000000', 10);
  const bet = parseFloat(args.bet ?? '1');
  const seed = args.seed; // hex master seed
  const action = args.action ?? 'spin';
  const params = args.params ? JSON.parse(args.params) : undefined;
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

  const script = config.luaScript;
  if (!script) {
    console.error('Config must contain `luaScript` (the .spin math source, prelude included).');
    process.exit(1);
  }

  if (!config.gameDefinition) {
    console.error('Config must contain `gameDefinition` (GameDefinition object).');
    process.exit(1);
  }

  const gameId = config.gameDefinition.id ?? 'unknown';

  // ─── Binary detection (e8 SpinML engine) ────────────────
  // Search in config dir first, then in the platform-core package root.
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const binaryPath =
    args.binary ?? findE8Binary(dirname(configPath)) ?? findE8Binary(engineRoot);

  if (!binaryPath) {
    console.error('e8 engine binary not found.');
    console.error('Use --binary <path> or set E8_BINARY.');
    process.exit(1);
  }

  console.log(`Using native binary: ${binaryPath}`);
  console.log(`Starting simulation for ${gameId} (${iterations.toLocaleString()} iterations, action: ${action})...`);

  const runner = new NativeSimulationRunner({
    binaryPath,
    argsPrefix: ['simulate'],
    script,
    scriptExt: 'spin',
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
