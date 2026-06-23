import { loadMathConfig } from './pipeline/config';
import { resolveModes } from './mathConfig';

export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (!['sim', 'pool', 'curate', 'all'].includes(cmd)) {
    throw new Error(`usage: e8-math <sim|pool|curate|all> --config ./math.config.ts [--mode BASE]`);
  }
  const cfg = await loadMathConfig(flags.config ?? './math.config.ts');
  let modes = resolveModes(cfg);
  if (flags.mode) modes = modes.filter((m) => m.mode === flags.mode);
  // sim/pool/curate/all dispatch wired in Tasks 3-4
  console.log(`e8-math ${cmd}: ${modes.length} mode(s)`);
}

export function parseFlags(argv: string[]): { config?: string; mode?: string; out?: string } {
  const out: { config?: string; mode?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}
