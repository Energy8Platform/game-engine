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
      logger: () => {}, // suppress Lua logs during simulation
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

        // Execute the starting action
        const result = engine.execute({
          action: startAction,
          bet,
          params,
        });

        const baseWin = result.totalWin;
        roundWin += baseWin;

        // If a bonus session was created, play through it
        if (result.session && !result.session.completed) {
          bonusTriggered++;

          // Find the bonus action from nextActions (different from startAction)
          const bonusAction = result.nextActions.find(a => a !== startAction)
            ?? result.nextActions[0];

          // Play bonus spins until session completes
          let bonusSessionWin = 0;
          let safetyLimit = 10_000;
          let lastResult = result;

          while (lastResult.session && !lastResult.session.completed && safetyLimit-- > 0) {
            lastResult = engine.execute({
              action: bonusAction,
              bet,
            });
            bonusSessionWin += lastResult.totalWin;
            bonusSpinsPlayed++;
          }

          bonusWin += bonusSessionWin;
          roundWin += bonusSessionWin;
        }

        baseGameWin += baseWin;
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
    };
  }

  /** Calculate the real cost of one spin (accounting for buy bonus / ante bet) */
  private calculateSpinCost(
    action: string,
    bet: number,
    gameDefinition: GameDefinition,
    params?: Record<string, unknown>,
  ): number {
    // Check if this is a buy bonus action
    const actionDef = gameDefinition.actions[action];
    if (actionDef?.buy_bonus_mode && gameDefinition.buy_bonus) {
      const mode = gameDefinition.buy_bonus.modes[actionDef.buy_bonus_mode];
      if (mode) {
        return bet * mode.cost_multiplier;
      }
    }

    // Check ante bet
    if (params?.ante_bet && gameDefinition.ante_bet) {
      return bet * gameDefinition.ante_bet.cost_multiplier;
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
