import { NativeSimulationRunner, requireNativeBinary } from '@energy8platform/platform-core/simulation';
import type { MathConfig, ResolvedMode } from '../mathConfig';

/** Run one mode go-native. With `dump`, the binary also writes per-round JSONL to that path. */
export async function runSim(cfg: MathConfig, m: ResolvedMode, opts: { dump?: string } = {}) {
  const binaryPath = requireNativeBinary();
  return new NativeSimulationRunner({
    binaryPath,
    script: cfg.luaScript,
    gameDefinition: cfg.model.gameDefinition as any,
    iterations: m.sim.iterations,
    bet: m.sim.bet,
    action: m.action,
    rng: m.sim.rng,
    seed: m.sim.seed,
    params: m.sim.params as Record<string, unknown> | undefined,
    dump: opts.dump,
  }).run();
}
