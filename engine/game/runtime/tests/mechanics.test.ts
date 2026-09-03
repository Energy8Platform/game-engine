import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { SpinSchema } from '@energy8engine/contracts';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { checkAgainstSchema } from '../src/plugins/mechanics';
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
async function registry(): Promise<{ ctx: Context }> {
  const ctx = new Context();
  // No config argument: this plugin has none (see its `apply`).
  await ctx.plugin(mechanicsPlugin);
  return { ctx };
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

  it('binding to a mechanic nobody has registered YET is not a failure — it resolves when one does', async () => {
    // Registration order across a composition is not knowable from
    // inside `bind`. A third-party row that registers its mechanic from
    // a `ctx.inject(['mechanics'], …)` callback lands after the row that
    // binds the stage to it, and this must be the normal case, not an
    // error.
    const { ctx } = await registry();
    const ACME = { id: 'acme', requires: { fields: {} }, present: () => [] };

    ctx.mechanics.bind('base_game', 'acme');
    expect(ctx.mechanics.forStage('base_game')).toBeNull();

    ctx.mechanics.register(ACME);
    expect(ctx.mechanics.forStage('base_game')).toBe(ACME);

    await ctx.fiber.dispose();
  });

  it('reports a binding whose mechanic never registered — at check time, where it is a fact', async () => {
    const { ctx } = await registry();
    ctx.mechanics.bind('base_game', 'nope');

    const problems = ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe('error');
    expect(problems[0].message).toContain('nope');

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

  it('binds a stage to a mechanic another row registers — in either order, without failing', async () => {
    // The scenario the whole per-stage registry exists for, and the one
    // this row used to report as broken while it worked: a mechanic this
    // package does not ship, bound by a patch, registered by somebody
    // else's row through `ctx.inject`.
    const ACME = { id: 'acme', requires: { fields: {} }, present: () => [] };
    const thirdPartyRow = {
      name: 'acme-mechanic',
      apply(ctx: Context) {
        ctx.inject(['mechanics'], (scope) => {
          scope.mechanics.register(ACME);
        });
      },
    };

    for (const order of ['row-first', 'mechanics-first'] as const) {
      const ctx = new Context();

      if (order === 'row-first') await ctx.plugin(thirdPartyRow);
      await ctx.plugin(mechanicsRow, { stages: { base_game: 'acme' } });
      if (order === 'mechanics-first') await ctx.plugin(thirdPartyRow);

      expect(ctx.mechanics.forStage('base_game')?.id).toBe('acme');
      // And the stage's data checks against the third-party mechanic's
      // own requirements, i.e. it is genuinely the bound one.
      expect(ctx.mechanics.check('base_game', {})).toEqual([]);

      await ctx.fiber.dispose();
    }
  });
});

/**
 * `checkAgainstSchema` — the pre-flight §7.1 promises: a mechanic's
 * `requires` checked against the MATH'S DECLARED SCHEMA, before the first
 * spin, not just against the data of one that already happened
 * (`checkShape`, above, stays exactly that — a post-spin sample check).
 *
 * The real `cascade`/`classic` mechanic bundles are used here, not local
 * stand-ins — the promise this exists to keep is specifically about
 * `cascade`'s real `cascade_history` requirement, and a fixture with a
 * different field name would prove nothing about it.
 */
describe('checkAgainstSchema', () => {
  function schemaWithStages(stages: SpinSchema['stages']): SpinSchema {
    return {
      gameId: 'demo',
      betLevels: [1],
      maxWin: 100,
      vars: {},
      stages,
      records: {},
      actions: [],
    };
  }

  const GRID_TYPE = {
    kind: 'list',
    of: { kind: 'list', of: { kind: 'int' } },
  } as const;

  const SCHEMA_WITHOUT_CASCADE = schemaWithStages({
    base_game: { grid: GRID_TYPE },
  });

  const SCHEMA_WITH_CASCADE = schemaWithStages({
    base_game: {
      grid: GRID_TYPE,
      cascade_history: { kind: 'list', of: { kind: 'record', name: 'CascadeStep' } },
    },
  });

  const SCHEMA_CASCADE_IS_FLOAT = schemaWithStages({
    base_game: {
      grid: GRID_TYPE,
      cascade_history: { kind: 'float' },
    },
  });

  // Only `base_game` declared — used to prove a stage a binding names but
  // the schema does not is caught, and the message names what IS there.
  const SCHEMA = SCHEMA_WITH_CASCADE;

  it('a mechanic whose required field is absent from the stage schema is a diagnostic at bind time', () => {
    const diagnostics = checkAgainstSchema(SCHEMA_WITHOUT_CASCADE, { base_game: cascadeMechanic });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('cascade');
    expect(diagnostics[0].message).toContain('cascade_history');
    expect(diagnostics[0].message).toContain('base_game');
  });

  it('a mechanic whose fields are all present is silent', () => {
    expect(checkAgainstSchema(SCHEMA_WITH_CASCADE, { base_game: cascadeMechanic })).toEqual([]);
  });

  it('a field present but of the wrong kind is named, with both kinds', () => {
    // `cascade_history: float` where a list was required.
    const [d] = checkAgainstSchema(SCHEMA_CASCADE_IS_FLOAT, { base_game: cascadeMechanic });
    expect(d.message).toContain('cascade_history');
    expect(d.message).toContain('list');
    expect(d.message).toContain('float');
  });

  it('a stage the schema does not declare is a diagnostic naming the stages it does', () => {
    const [d] = checkAgainstSchema(SCHEMA, { free_spins: classicMechanic });
    expect(d.message).toContain('free_spins');
    expect(d.message).toContain('base_game');
  });

  it('no schema means no check, and no complaint', () => {
    // A project whose .spin could not be parsed already has ITS diagnostic;
    // inventing a second one here would report the same problem twice.
    expect(checkAgainstSchema(null, { base_game: cascadeMechanic })).toEqual([]);
  });
});
