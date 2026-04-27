import { LuaEngine } from './LuaEngine';
import type { SimulationConfig, SimulationResult, GameDefinition } from './types';

/**
 * Runs N iterations of a Lua game script and collects RTP statistics.
 * Supports regular spins, buy bonus, and ante bet simulation.
 *
 * @example
 * ```ts
 * const runner = new SimulationRunner({
 *   script: luaSource,
 *   gameDefinition,
 *   iterations: 1_000_000,
 *   bet: 1.0,
 *   seed: 42,
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 * });
 *
 * const result = runner.run();
 * console.log(`RTP: ${result.totalRtp.toFixed(2)}%`);
 * ```
 */
export class SimulationRunner {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  run(): SimulationResult {
    const {
      script,
      gameDefinition,
      iterations,
      bet,
      seed,
      action: startAction = 'spin',
      params,
      progressInterval = 100_000,
      onProgress,
    } = this.config;

    const engine = new LuaEngine({
      script,
      gameDefinition,
      seed,
      logger: () => {},
      simulationMode: true,
    });

    const spinCost = this.calculateSpinCost(startAction, bet, gameDefinition, params);

    let totalWagered = 0;
    let totalWon = 0;
    let baseGameWin = 0;
    let bonusWin = 0;
    let hits = 0;
    let maxWinMultiplier = 0;
    let maxWinHits = 0;
    let bonusTriggered = 0;
    let bonusSpinsPlayed = 0;

    const startTime = Date.now();

    try {
      for (let i = 0; i < iterations; i++) {
        totalWagered += spinCost;
        let roundWin = 0;
        let roundBonusWin = 0;

        // Execute the starting action
        let result = engine.execute({
          action: startAction,
          bet,
          params,
        });

        const baseWin = result.totalWin;

        // If a session was created, play through it using nextActions from the engine
        if (result.session && !result.session.completed) {
          bonusTriggered++;

          let safetyLimit = 10_000;
          while (result.session && !result.session.completed && safetyLimit-- > 0) {
            const nextAction = result.nextActions[0];
            result = engine.execute({ action: nextAction, bet });
            bonusSpinsPlayed++;
          }

          // Session completion returns cumulative totalWin (includes trigger spin).
          // Use it as the full round win — don't add baseWin separately.
          roundWin = result.totalWin;
          roundBonusWin = roundWin - baseWin;
        } else {
          // No session — just base game win
          roundWin = baseWin;
        }

        baseGameWin += baseWin;
        bonusWin += roundBonusWin;
        totalWon += roundWin;

        if (roundWin > 0) hits++;

        const roundMultiplier = roundWin / bet;
        if (roundMultiplier > maxWinMultiplier) {
          maxWinMultiplier = roundMultiplier;
        }

        if (result.variables?.max_win_reached === 1) {
          maxWinHits++;
        }

        // Progress reporting
        if (onProgress && (i + 1) % progressInterval === 0) {
          onProgress(i + 1, iterations);
        }
      }
    } finally {
      engine.destroy();
    }

    const durationMs = Date.now() - startTime;

    return {
      gameId: gameDefinition.id,
      action: startAction,
      iterations,
      durationMs,
      totalRtp: totalWagered > 0 ? (totalWon / totalWagered) * 100 : 0,
      baseGameRtp: totalWagered > 0 ? (baseGameWin / totalWagered) * 100 : 0,
      bonusRtp: totalWagered > 0 ? (bonusWin / totalWagered) * 100 : 0,
      hitFrequency: iterations > 0 ? (hits / iterations) * 100 : 0,
      maxWin: Math.round(maxWinMultiplier * 100) / 100,
      maxWinHits,
      bonusTriggered,
      bonusSpinsPlayed,
      _raw: { totalWagered, totalWon, baseGameWin, bonusWin, hits },
    };
  }

  /**
   * Calculate the real cost of one spin — mirrors v5
   * ActionDefinition.DebitAmount: bet × (cost_multiplier || 1) when
   * debit==='bet', otherwise 0. Returns `bet` as a fallback for unknown
   * actions so RTP math still progresses (we count those as wagered).
   */
  private calculateSpinCost(
    action: string,
    bet: number,
    gameDefinition: GameDefinition,
    _params?: Record<string, unknown>,
  ): number {
    const actionDef = gameDefinition.actions[action];
    if (!actionDef) return bet;
    if (actionDef.debit !== 'bet') return 0;
    const mult = actionDef.cost_multiplier;
    if (typeof mult === 'number' && mult > 0 && mult !== 1) {
      return bet * mult;
    }
    return bet;
  }
}

/** Format a SimulationResult for console output */
export function formatSimulationResult(result: SimulationResult): string {
  const lines: string[] = [
    '',
    '--- Simulation Results ---',
    `Game: ${result.gameId}`,
    `Action: ${result.action}`,
    `Iterations: ${result.iterations.toLocaleString()}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    `Total RTP: ${result.totalRtp.toFixed(2)}%`,
    `Base Game RTP: ${result.baseGameRtp.toFixed(2)}%`,
    `Bonus RTP: ${result.bonusRtp.toFixed(2)}%`,
    `Hit Frequency: ${result.hitFrequency.toFixed(2)}%`,
    `Max Win: ${result.maxWin.toFixed(2)}x`,
    `Max Win Hits: ${result.maxWinHits} (rounds capped by max_win)`,
  ];

  if (result.bonusTriggered > 0) {
    const frequency = Math.round(result.iterations / result.bonusTriggered);
    lines.push(`Bonus Triggered: ${result.bonusTriggered.toLocaleString()} (1 in ${frequency} spins)`);
    lines.push(`Bonus Spins Played: ${result.bonusSpinsPlayed.toLocaleString()}`);
  }

  return lines.join('\n');
}
