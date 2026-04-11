#!/usr/bin/env npx tsx
import { SimulationRunner, formatSimulationResult } from '../src/lua/SimulationRunner';
import { resolve } from 'path';

// ─── Argument Parsing ───────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const configPath = resolve(process.cwd(), args.config ?? './dev.config.ts');
  const iterations = parseInt(args.iterations ?? '1000000', 10);
  const bet = parseFloat(args.bet ?? '1');
  const seed = args.seed ? parseInt(args.seed, 10) : undefined;
  const action = args.action ?? 'spin';
  const params = args.params ? JSON.parse(args.params) : undefined;

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
  console.log(`Starting simulation for ${gameId} (${iterations.toLocaleString()} iterations, action: ${action})...`);

  const runner = new SimulationRunner({
    script: config.luaScript,
    gameDefinition: config.gameDefinition,
    iterations,
    bet,
    seed,
    action,
    params,
    onProgress: (completed, total) => {
      const pct = Math.round((completed / total) * 100);
      console.log(`Progress: ${completed.toLocaleString()}/${total.toLocaleString()} (${pct}%)`);
    },
  });

  const result = runner.run();
  console.log(formatSimulationResult(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
