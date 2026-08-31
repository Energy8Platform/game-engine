import { describe, expect, it } from 'vitest';
import { createGame } from '../src/index';

const CLASSIC = { id: 'classic', expects: { fields: { grid: 'grid' } }, plan: () => [] } as const;
const CASCADE = { id: 'cascade', expects: { fields: { cascade_history: 'list' } }, plan: () => [] } as const;

describe('the mechanic registry', () => {
  it('finds the mechanic bound to a stage', async () => {
    const game = await createGame({});
    game.ctx.mechanics.register(CLASSIC);
    game.ctx.mechanics.bind('base_game', 'classic');
    expect(game.ctx.mechanics.forStage('base_game')?.id).toBe('classic');
    await game.stop();
  });

  it('returns null for a stage nothing is bound to, rather than guessing', async () => {
    const game = await createGame({});
    game.ctx.mechanics.register(CLASSIC);
    expect(game.ctx.mechanics.forStage('free_spins')).toBeNull();
    await game.stop();
  });

  it('reports binding a stage to a mechanic nobody registered', async () => {
    const game = await createGame({});
    game.ctx.mechanics.bind('base_game', 'nope');
    expect(game.diagnostics.some((d) => d.message.includes('nope'))).toBe(true);
    await game.stop();
  });

  it('lets a later bind replace an earlier one for the same stage', async () => {
    const game = await createGame({});
    game.ctx.mechanics.register(CLASSIC);
    game.ctx.mechanics.register(CASCADE);
    game.ctx.mechanics.bind('base_game', 'classic');
    game.ctx.mechanics.bind('base_game', 'cascade');
    expect(game.ctx.mechanics.forStage('base_game')?.id).toBe('cascade');
    await game.stop();
  });

  it('unregisters cleanly — a disposed registration is gone', async () => {
    const game = await createGame({});
    const dispose = game.ctx.mechanics.register(CLASSIC);
    game.ctx.mechanics.bind('base_game', 'classic');
    dispose();
    expect(game.ctx.mechanics.forStage('base_game')).toBeNull();
    await game.stop();
  });

  it('reports a mechanic whose requirements the stage data does not meet', async () => {
    const game = await createGame({});
    game.ctx.mechanics.register(CASCADE);
    game.ctx.mechanics.bind('base_game', 'cascade');
    const problems = game.ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('cascade_history');
    await game.stop();
  });
});
