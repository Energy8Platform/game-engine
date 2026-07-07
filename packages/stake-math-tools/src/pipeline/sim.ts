import { NativeSimulationRunner, requireE8Binary } from '@energy8platform/platform-core/simulation';
import type { MathConfig, ResolvedMode } from '../mathConfig';

/**
 * Run one mode through the e8 SpinML engine (`e8 simulate` — same flag
 * dialect and dump format the Go binary used to speak). With `dump`, the
 * binary also writes per-round JSONL to that path.
 *
 * The Lua/Go runtime was removed — legacy Lua games stay on the last
 * stake-math-tools 0.8.x that shipped it.
 */
export async function runSim(cfg: MathConfig, m: ResolvedMode, opts: { dump?: string } = {}) {
  if (cfg.runtime === 'lua') {
    throw new Error(
      "math.config runtime 'lua' is no longer supported — the math runtime is SpinML " +
        "(runtime: 'spin', script.spin). Migrate the game or pin stake-math-tools <= 0.8.x.",
    );
  }
  return new NativeSimulationRunner({
    binaryPath: requireE8Binary(),
    argsPrefix: ['simulate'],
    script: cfg.luaScript,
    scriptExt: 'spin',
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
