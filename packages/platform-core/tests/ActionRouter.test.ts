import { describe, it, expect } from 'vitest';
import { ActionRouter, evaluateCondition } from '../src/lua/ActionRouter';
import type { GameDefinition } from '../src/lua/types';

const GAME_DEF: GameDefinition = {
  id: 'test',
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
};

describe('evaluateCondition', () => {
  it('should handle "always"', () => {
    expect(evaluateCondition('always', {})).toBe(true);
  });

  it('should evaluate > comparison', () => {
    expect(evaluateCondition('x > 0', { x: 5 })).toBe(true);
    expect(evaluateCondition('x > 0', { x: 0 })).toBe(false);
    expect(evaluateCondition('x > 0', {})).toBe(false); // missing var = 0
  });

  it('should evaluate >= comparison', () => {
    expect(evaluateCondition('x >= 5', { x: 5 })).toBe(true);
    expect(evaluateCondition('x >= 5', { x: 4 })).toBe(false);
  });

  it('should evaluate == comparison', () => {
    expect(evaluateCondition('round_complete == 1', { round_complete: 1 })).toBe(true);
    expect(evaluateCondition('round_complete == 1', { round_complete: 0 })).toBe(false);
  });

  it('should evaluate != comparison', () => {
    expect(evaluateCondition('x != 0', { x: 1 })).toBe(true);
    expect(evaluateCondition('x != 0', { x: 0 })).toBe(false);
  });

  it('should evaluate < and <= comparisons', () => {
    expect(evaluateCondition('x < 10', { x: 5 })).toBe(true);
    expect(evaluateCondition('x <= 10', { x: 10 })).toBe(true);
    expect(evaluateCondition('x <= 10', { x: 11 })).toBe(false);
  });

  it('should handle && (AND)', () => {
    expect(evaluateCondition('x > 0 && y > 0', { x: 1, y: 1 })).toBe(true);
    expect(evaluateCondition('x > 0 && y > 0', { x: 1, y: 0 })).toBe(false);
  });

  it('should handle || (OR)', () => {
    expect(evaluateCondition('x > 0 || y > 0', { x: 0, y: 1 })).toBe(true);
    expect(evaluateCondition('x > 0 || y > 0', { x: 0, y: 0 })).toBe(false);
  });

  it('should throw on unparseable condition', () => {
    expect(() => evaluateCondition('invalid', {})).toThrow('Cannot parse condition');
  });
});

describe('ActionRouter', () => {
  it('should resolve a known action', () => {
    const router = new ActionRouter(GAME_DEF);
    const action = router.resolveAction('spin', false);
    expect(action.stage).toBe('base_game');
    expect(action.debit).toBe('bet');
  });

  it('should throw on unknown action', () => {
    const router = new ActionRouter(GAME_DEF);
    expect(() => router.resolveAction('unknown', false)).toThrow('Unknown action');
  });

  it('should throw when requires_session but no session', () => {
    const router = new ActionRouter(GAME_DEF);
    expect(() => router.resolveAction('free_spin', false)).toThrow('requires an active session');
  });

  it('should allow requires_session action when session exists', () => {
    const router = new ActionRouter(GAME_DEF);
    const action = router.resolveAction('free_spin', true);
    expect(action.stage).toBe('free_spins');
  });

  it('should match first true transition', () => {
    const router = new ActionRouter(GAME_DEF);
    const action = router.resolveAction('spin', false);

    // With free_spins_awarded > 0 — should match first rule
    const match1 = router.evaluateTransitions(action, { free_spins_awarded: 5 });
    expect(match1.nextActions).toEqual(['free_spin']);
    expect(match1.rule.creates_session).toBe(true);

    // Without — should fall through to "always"
    const match2 = router.evaluateTransitions(action, {});
    expect(match2.nextActions).toEqual(['spin']);
  });
});
