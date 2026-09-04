import { NativeSimulationRunner, requireE8Binary } from '@energy8platform/platform-core/simulation';
import type { MathConfig, ResolvedMode } from '../mathConfig';

export interface RunSimOptions {
  /** Write the full per-round JSONL dump here (`.gz` compresses as it writes). */
  dump?: string;
  /** Write the light `round,payoutCents` CSV here — no JSON serialized at all. */
  dumpCsv?: string;
  /** Limit `dump` to the round indices listed in this file. */
  onlyRounds?: string;
  /**
   * Master seed override. The heavy pass runs with the seed the light pass
   * actually used, which is often one the engine invented (the config need not
   * pin `sim.seed`) — without it the second run would draw different rounds.
   */
  seed?: string;
}

/**
 * Run one mode through the e8 SpinML engine (`e8 simulate` — same flag
 * dialect and dump format the Go binary used to speak). With `dump`, the
 * binary also writes per-round JSONL to that path.
 *
 * The Lua/Go runtime was removed — legacy Lua games stay on the last
 * stake-math-tools 0.8.x that shipped it.
 */
export async function runSim(cfg: MathConfig, m: ResolvedMode, opts: RunSimOptions = {}) {
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
    seed: opts.seed ?? m.sim.seed,
    params: m.sim.params as Record<string, unknown> | undefined,
    dump: opts.dump,
    dumpCsv: opts.dumpCsv,
    onlyRounds: opts.onlyRounds,
  }).run();
}
