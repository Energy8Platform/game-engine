import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as mechanicsPlugin from '../src/plugins/mechanics';
import * as mechanicsRow from '../src/runtime';

/**
 * The registry itself, exercised directly rather than through
 * `createGame`. It stopped being `createGame`'s to own when the project
 * took over the composition: the registry is what the `mechanics1` ROW
 * provides (`../src/runtime`), and testing it through a game that has to
 * fetch a composition first would only add a fake host in front of the
 * thing under test.
 */
async function registry(): Promise<{ ctx: Context; diagnostics: Diagnostic[] }> {
  const ctx = new Context();
  const diagnostics: Diagnostic[] = [];
  await ctx.plugin(mechanicsPlugin, { diagnostics });
  return { ctx, diagnostics };
}

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
    const { ctx } = await registry();
    ctx.mechanics.register(CLASSIC);
    ctx.mechanics.bind('base_game', 'classic');
    expect(ctx.mechanics.forStage('base_game')?.id).toBe('classic');
    await ctx.fiber.dispose();
  });

  it('returns null for a stage nothing is bound to, rather than guessing', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register(CLASSIC);
    expect(ctx.mechanics.forStage('free_spins')).toBeNull();
    await ctx.fiber.dispose();
  });

  it('reports binding a stage to a mechanic nobody registered', async () => {
    const { ctx, diagnostics } = await registry();
    ctx.mechanics.bind('base_game', 'nope');
    expect(diagnostics.some((d) => d.message.includes('nope'))).toBe(true);
    await ctx.fiber.dispose();
  });

  it('lets a later bind replace an earlier one for the same stage', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register(CLASSIC);
    ctx.mechanics.register(CASCADE);
    ctx.mechanics.bind('base_game', 'classic');
    ctx.mechanics.bind('base_game', 'cascade');
    expect(ctx.mechanics.forStage('base_game')?.id).toBe('cascade');
    await ctx.fiber.dispose();
  });

  it('unregisters cleanly — a disposed registration is gone', async () => {
    const { ctx } = await registry();
    const dispose = ctx.mechanics.register(CLASSIC);
    ctx.mechanics.bind('base_game', 'classic');
    dispose();
    expect(ctx.mechanics.forStage('base_game')).toBeNull();
    await ctx.fiber.dispose();
  });

  it('reports a mechanic whose requirements the stage data does not meet', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register(CASCADE);
    ctx.mechanics.bind('base_game', 'cascade');
    const problems = ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('cascade_history');
    await ctx.fiber.dispose();
  });

  it('a stale disposer from a replaced registration does not evict the replacement', async () => {
    const { ctx } = await registry();
    // Two registrations under the SAME id — the second replaces the first
    // in the map, but both disposers close over that same id.
    const FIRST = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const SECOND = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const disposeFirst = ctx.mechanics.register(FIRST);
    const disposeSecond = ctx.mechanics.register(SECOND);

    // disposeFirst is stale: its registration was already replaced. Calling
    // it must not remove the live replacement that disposeSecond owns.
    disposeFirst();
    ctx.mechanics.bind('base_game', 'classic');
    expect(ctx.mechanics.forStage('base_game')).toBe(SECOND);

    // The real owner still works.
    disposeSecond();
    expect(ctx.mechanics.forStage('base_game')).toBeNull();
    await ctx.fiber.dispose();
  });

  it('checking a stage nothing is bound to reports a diagnostic instead of a silent pass', async () => {
    const { ctx } = await registry();
    const problems = ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems.length).toBeGreaterThan(0);
    await ctx.fiber.dispose();
  });
});

describe('the mechanics1 row', () => {
  it('registers both shipped mechanics and binds the stages its config names', async () => {
    const ctx = new Context();
    await ctx.plugin(mechanicsRow, { stages: { base_game: 'classic', free_spins: 'cascade' } });

    expect(ctx.mechanics.forStage('base_game')?.id).toBe('classic');
    expect(ctx.mechanics.forStage('free_spins')?.id).toBe('cascade');

    await ctx.fiber.dispose();
  });

  it('throws when its config binds a stage to a mechanic nobody ships — the loader turns that into a diagnostic naming the row', async () => {
    const ctx = new Context();

    await expect(ctx.plugin(mechanicsRow, { stages: { base_game: 'no-such-mechanic' } })).rejects.toThrow(
      /no-such-mechanic/,
    );

    await ctx.fiber.dispose();
  });
});
