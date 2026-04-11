import { describe, it, expect } from 'vitest';
import { SimulationRunner, formatSimulationResult } from '../src/lua/SimulationRunner';
import type { GameDefinition } from '../src/lua/types';

const GAME_DEF: GameDefinition = {
  id: 'test-slot',
  type: 'SLOT',
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [
        {
          condition: 'free_spins_awarded > 0',
          creates_session: true,
          credit_override: 'defer',
          next_actions: ['free_spin'],
          session_config: { total_spins_var: 'free_spins_awarded' },
        },
        { condition: 'always', next_actions: ['spin'] },
      ],
    },
    free_spin: {
      stage: 'free_spins',
      debit: 'none',
      requires_session: true,
      transitions: [
        { condition: 'always', next_actions: ['free_spin'] },
      ],
    },
  },
  bet_levels: [1],
  max_win: { multiplier: 10000 },
};

// Simple slot: always wins 2x, never triggers free spins
const SIMPLE_SCRIPT = `
function execute(state)
    return {
        total_win = 2,
        matrix = {{1,2,3}},
    }
end
`;

// Slot with free spins: 10% chance to trigger 3 free spins
const FREE_SPINS_SCRIPT = `
function execute(state)
    if state.stage == "base_game" then
        local trigger = engine.random(1, 10) == 1
        if trigger then
            return {
                total_win = 0,
                variables = { free_spins_awarded = 3 },
                matrix = {{1,1,1}},
            }
        end
        return {
            total_win = 1,
            matrix = {{2,3,4}},
        }
    elseif state.stage == "free_spins" then
        return {
            total_win = 3,
            matrix = {{5,5,5}},
        }
    end
end
`;

describe('SimulationRunner', () => {
  it('should run a basic simulation and return correct structure', () => {
    const runner = new SimulationRunner({
      script: SIMPLE_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 100,
      bet: 1.0,
      seed: 42,
    });

    const result = runner.run();

    expect(result.gameId).toBe('test-slot');
    expect(result.action).toBe('spin');
    expect(result.iterations).toBe(100);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalRtp).toBe('number');
    expect(typeof result.baseGameRtp).toBe('number');
    expect(typeof result.bonusRtp).toBe('number');
    expect(typeof result.hitFrequency).toBe('number');
    expect(typeof result.maxWin).toBe('number');
    expect(typeof result.maxWinHits).toBe('number');
    expect(typeof result.bonusTriggered).toBe('number');
    expect(typeof result.bonusSpinsPlayed).toBe('number');
  });

  it('should calculate correct RTP for a fixed-win game', () => {
    const runner = new SimulationRunner({
      script: SIMPLE_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 1000,
      bet: 1.0,
      seed: 42,
    });

    const result = runner.run();

    // Script always returns total_win = 2 (2x bet multiplier)
    // So totalWon = 2 * 1000 = 2000, totalWagered = 1000
    // RTP = 200%
    expect(result.totalRtp).toBe(200);
    expect(result.hitFrequency).toBe(100);
    expect(result.maxWin).toBe(2);
    expect(result.bonusTriggered).toBe(0);
  });

  it('should handle free spins sessions', () => {
    const runner = new SimulationRunner({
      script: FREE_SPINS_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 1000,
      bet: 1.0,
      seed: 42,
    });

    const result = runner.run();

    // Some free spins should have triggered
    expect(result.bonusTriggered).toBeGreaterThan(0);
    expect(result.bonusSpinsPlayed).toBeGreaterThan(0);
    expect(result.bonusRtp).toBeGreaterThan(0);
    expect(result.baseGameRtp).toBeGreaterThan(0);
    // Total = base + bonus
    expect(result.totalRtp).toBeCloseTo(result.baseGameRtp + result.bonusRtp, 5);
  });

  it('should produce deterministic results with seed', () => {
    const config = {
      script: FREE_SPINS_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 500,
      bet: 1.0,
      seed: 99,
    };

    const result1 = new SimulationRunner(config).run();
    const result2 = new SimulationRunner(config).run();

    expect(result1.totalRtp).toBe(result2.totalRtp);
    expect(result1.bonusTriggered).toBe(result2.bonusTriggered);
    expect(result1.maxWin).toBe(result2.maxWin);
  });

  it('should call onProgress callback', () => {
    const progressCalls: number[] = [];

    const runner = new SimulationRunner({
      script: SIMPLE_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 300,
      bet: 1.0,
      seed: 42,
      progressInterval: 100,
      onProgress: (completed) => progressCalls.push(completed),
    });

    runner.run();

    expect(progressCalls).toEqual([100, 200, 300]);
  });

  it('should format result as readable text', () => {
    const runner = new SimulationRunner({
      script: FREE_SPINS_SCRIPT,
      gameDefinition: GAME_DEF,
      iterations: 500,
      bet: 1.0,
      seed: 42,
    });

    const result = runner.run();
    const text = formatSimulationResult(result);

    expect(text).toContain('Simulation Results');
    expect(text).toContain('test-slot');
    expect(text).toContain('Total RTP:');
    expect(text).toContain('Hit Frequency:');
    expect(text).toContain('Bonus Triggered:');
  });
});
