import { describe, expect, it } from 'vitest';
import { createGame } from '../src/index';

// `SpinMechanic` shape (`{ id, requires, present }`) from
// `@energy8engine/contracts` — the exact bundle `mechanic-classic` and
// `mechanic-cascade` already export as `mechanic`, so the registry accepts
// those exports directly, with no adapter.
const CLASSIC = {
  id: 'classic',
  requires: { fields: { grid: 'grid' } },
  present: () => [],
} as const;
const CASCADE = {
  id: 'cascade',
  requires: { fields: { cascade_history: 'list' } },
  present: () => [],
} as const;

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

  it('a stale disposer from a replaced registration does not evict the replacement', async () => {
    const game = await createGame({});
    // Two registrations under the SAME id — the second replaces the first
    // in the map, but both disposers close over that same id.
    const FIRST = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const SECOND = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const disposeFirst = game.ctx.mechanics.register(FIRST);
    const disposeSecond = game.ctx.mechanics.register(SECOND);

    // disposeFirst is stale: its registration was already replaced. Calling
    // it must not remove the live replacement that disposeSecond owns.
    disposeFirst();
    game.ctx.mechanics.bind('base_game', 'classic');
    expect(game.ctx.mechanics.forStage('base_game')).toBe(SECOND);

    // The real owner still works.
    disposeSecond();
    expect(game.ctx.mechanics.forStage('base_game')).toBeNull();
    await game.stop();
  });

  it('checking a stage nothing is bound to reports a diagnostic instead of a silent pass', async () => {
    const game = await createGame({});
    const problems = game.ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems.length).toBeGreaterThan(0);
    await game.stop();
  });
});
