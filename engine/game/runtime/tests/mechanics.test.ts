import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { SchemaGap, SpinSchema } from '@energy8engine/contracts';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { parseSpinSchema } from '@energy8engine/spin-parser';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
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
    // Two registrations under the SAME id, one after the other's was
    // disposed — the ordinary plugin lifecycle (a row leaves, another
    // takes the id), and the only way one registration REPLACES another
    // now that a live collision is refused instead. Both disposers close
    // over that same id.
    const FIRST = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const SECOND = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const disposeFirst = ctx.mechanics.register(FIRST);
    disposeFirst();
    const disposeSecond = ctx.mechanics.register(SECOND);

    // disposeFirst is stale: its registration is already gone. Calling it
    // again must not remove the live replacement disposeSecond owns.
    disposeFirst();
    ctx.mechanics.bind('base_game', 'classic');
    expect(ctx.mechanics.forStage('base_game')).toBe(SECOND);

    // The real owner still works.
    disposeSecond();
    expect(ctx.mechanics.forStage('base_game')).toBeNull();
    await ctx.fiber.dispose();
  });

  /**
   * Two plugins claiming one mechanic id.
   *
   * `register` was `mechanics.set(id, mechanic)` — last writer wins, no
   * complaint — so any plugin could shadow the built-in `classic` or
   * `cascade` simply by using its id, and the game would present with
   * something other than what the composition read like. Note the
   * asymmetry that made this worth finding: the step registry took real
   * care to stop a plugin shadowing a built-in STEP, while the mechanic
   * id next to it could be taken in silence.
   *
   * Same rule as `BoardStepRegistry.register` and the same reasons (see
   * its doc): the incumbent keeps the id, the newcomer is refused, and it
   * is reported.
   */
  it('two mechanics claiming one id: the first keeps it, the second is refused', async () => {
    const { ctx } = await registry();
    const FIRST = { id: 'classic', requires: { fields: {} }, present: () => [] };
    const SECOND = { id: 'classic', requires: { fields: {} }, present: () => [] };
    ctx.mechanics.register(FIRST);
    ctx.mechanics.register(SECOND);

    ctx.mechanics.bind('base_game', 'classic');
    expect(ctx.mechanics.forStage('base_game')).toBe(FIRST);
    await ctx.fiber.dispose();
  });

  it('...and says so, naming the id and both claimants', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register({ id: 'classic', requires: { fields: {} }, present: () => [] });
    ctx.mechanics.register({ id: 'classic', requires: { fields: {} }, present: () => [] });

    const [d] = ctx.mechanics.collisions();
    expect(d.severity).toBe('error');
    expect(d.message).toContain('classic');
    expect(d.message).toContain('already registered');
    expect(d.message).toContain('ignored');
    await ctx.fiber.dispose();
  });

  it('the refused registration disposes to nothing — it must not unregister the winner', async () => {
    const { ctx } = await registry();
    const WINNER = { id: 'classic', requires: { fields: {} }, present: () => [] };
    ctx.mechanics.register(WINNER);
    const disposeLoser = ctx.mechanics.register({
      id: 'classic',
      requires: { fields: {} },
      present: () => [],
    });

    disposeLoser();
    ctx.mechanics.bind('base_game', 'classic');
    expect(ctx.mechanics.forStage('base_game')).toBe(WINNER);
    await ctx.fiber.dispose();
  });

  it('an id re-registered AFTER the first was disposed is not a collision', async () => {
    const { ctx } = await registry();
    const dispose = ctx.mechanics.register(CLASSIC);
    dispose();
    ctx.mechanics.register({ id: 'classic', requires: { fields: {} }, present: () => [] });
    expect(ctx.mechanics.collisions()).toEqual([]);
    await ctx.fiber.dispose();
  });

  // Round 1 review, Task 4: `register` used to write to the registry
  // (`mechanics.add`) and only THEN open `ctx.effect` to tie the write to
  // this service's own scope. `ctx.effect` checks the scope is alive
  // BEFORE it runs anything (cordis's `Fiber.effect` calls `assertActive`
  // first) — so a `register` call reaching this service after its OWNING
  // scope is already gone still performed the write, and only THEN threw
  // on `ctx.effect`. Nothing was left holding a disposer for that entry:
  // it is not what `check`/`present` would ever see (nothing was bound to
  // it), but it silently occupies the id forever, because `mechanics`
  // (first-wins) now believes something already claims it.
  //
  // `service` is captured before disposal — the scenario is an external
  // caller that kept a `ctx.mechanics` reference past the plugin's own
  // teardown, not a call made through `ctx` itself (which cordis would
  // refuse for an unrelated reason before ever reaching `register`).
  it('a scope disposed before register() runs refuses atomically — nothing survives the throw', async () => {
    const { ctx } = await registry();
    const service = ctx.mechanics;
    await ctx.fiber.dispose();

    // The write must not happen at all — same promise `ctx.effect` makes
    // for any other resource this service manages.
    expect(() => service.register(CLASSIC)).toThrow();

    // If CLASSIC's entry had survived that throw (the bug), THIS second
    // call would find "classic" already occupied and take the COLLISION
    // branch — which never opens `ctx.effect` at all — so it would return
    // quietly instead of throwing, and `collisions()` would gain an entry
    // nothing here ever legitimately claimed.
    expect(() =>
      service.register({ id: 'classic', requires: { fields: {} }, present: () => [] }),
    ).toThrow();
    expect(service.collisions()).toEqual([]);
  });

  it('checking a stage nothing is bound to reports a diagnostic instead of a silent pass', async () => {
    const { ctx } = await registry();
    const problems = ctx.mechanics.check('base_game', { grid: [[1]] });
    expect(problems.length).toBeGreaterThan(0);
    await ctx.fiber.dispose();
  });
});

/**
 * `present` — check-then-present as ONE call the engine owns.
 *
 * `mechanic.present(data)` was the last third-party call in the system
 * outside "failures are data": its only call site was a game's own page,
 * unguarded, so a plugin mechanic whose `present` threw produced a JS
 * exception instead of a `Diagnostic`. `requires` cannot close that —
 * it says a field is a list, never what the list contains, and never
 * anything at all about the code that reads it.
 *
 * The sequence is guaranteed rather than conventional: every game that
 * presented a stage had to remember to `check` first, and the order was a
 * habit each page re-invented.
 */
describe('mechanics.present', () => {
  const GOOD = {
    id: 'good',
    requires: { fields: { grid: 'grid' } },
    // An invented kind, not a built-in one: nothing here runs the plan,
    // and naming a real kind would only suggest this test cares which.
    present: () => [{ kind: 'marker' }],
  } as const;

  it('checks first, then presents, and returns the plan', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register(GOOD);
    ctx.mechanics.bind('base_game', 'good');

    const { plan, diagnostics } = ctx.mechanics.present('base_game', { grid: [[1]] });
    expect(diagnostics).toEqual([]);
    expect(plan).toEqual([{ kind: 'marker' }]);
    await ctx.fiber.dispose();
  });

  it('data the mechanic cannot read is reported and NOTHING is presented', async () => {
    const { ctx } = await registry();
    let presented = false;
    ctx.mechanics.register({
      id: 'good',
      requires: { fields: { grid: 'grid' } },
      present: () => {
        presented = true;
        return [];
      },
    });
    ctx.mechanics.bind('base_game', 'good');

    const { plan, diagnostics } = ctx.mechanics.present('base_game', { grid: 'not a grid' });
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(plan).toEqual([]);
    // The whole point of owning the sequence: `present` was never reached.
    expect(presented).toBe(false);
    await ctx.fiber.dispose();
  });

  it('a mechanic whose present() throws becomes a diagnostic, not an exception', async () => {
    const { ctx } = await registry();
    ctx.mechanics.register({
      id: 'boom',
      requires: { fields: {} },
      present: () => {
        throw new Error('present blew up');
      },
    });
    ctx.mechanics.bind('base_game', 'boom');

    const { plan, diagnostics } = ctx.mechanics.present('base_game', {});
    expect(plan).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('present blew up');
    expect(diagnostics[0].plugin).toBe('boom');
    await ctx.fiber.dispose();
  });

  it('a mechanic whose present() returns something that is not a plan is a diagnostic', async () => {
    // `executePlan` reads `plan.length` before anything else, so a
    // non-array reaches it as a TypeError (or, for a plain object, as a
    // plan that silently runs no steps at all).
    const { ctx } = await registry();
    ctx.mechanics.register({
      id: 'wrong',
      requires: { fields: {} },
      present: () => undefined as never,
    });
    ctx.mechanics.bind('base_game', 'wrong');

    const { plan, diagnostics } = ctx.mechanics.present('base_game', {});
    expect(plan).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('did not return a plan');
    await ctx.fiber.dispose();
  });

  it('a stage nothing is bound to reports that, and presents nothing', async () => {
    const { ctx } = await registry();
    const { plan, diagnostics } = ctx.mechanics.present('base_game', {});
    expect(plan).toEqual([]);
    expect(diagnostics.some((d) => d.message.includes('nothing is bound'))).toBe(true);
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
  function schemaWithStages(stages: SpinSchema['stages'], gaps: SchemaGap[] = []): SpinSchema {
    return {
      gameId: 'demo',
      betLevels: [1],
      maxWin: 100,
      vars: {},
      stages,
      records: {},
      actions: [],
      gaps,
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
    const diagnostics = checkAgainstSchema(SCHEMA_CASCADE_IS_FLOAT, { base_game: cascadeMechanic });
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.message).toContain('cascade_history');
    expect(d.message).toContain('list');
    expect(d.message).toContain('float');
  });

  it('a stage the schema does not declare is a diagnostic naming the stages it does', () => {
    const diagnostics = checkAgainstSchema(SCHEMA, { free_spins: classicMechanic });
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.message).toContain('free_spins');
    expect(d.message).toContain('base_game');
  });

  it('no schema means no check, and no complaint', () => {
    // A project whose .spin could not be parsed already has ITS diagnostic;
    // inventing a second one here would report the same problem twice.
    expect(checkAgainstSchema(null, { base_game: cascadeMechanic })).toEqual([]);
  });

  // The three tests below close gaps the review found by mutation: each
  // documented rule in `matchesFieldKind` (mechanics.ts) that no test
  // actually held. Every one is written so it fails if the rule its name
  // states is removed — confirmed by deliberately removing each rule and
  // watching exactly this test (and no other) fail, then restoring it.

  it('a flat (single-level) list does not satisfy a "grid" requirement — grid needs two levels of nesting', () => {
    const SCHEMA_FLAT_GRID = schemaWithStages({
      base_game: {
        // One level of nesting only — `[int]`, not `[[int]]`.
        grid: { kind: 'list', of: { kind: 'int' } },
        cascade_history: { kind: 'list', of: { kind: 'record', name: 'CascadeStep' } },
      },
    });
    const diagnostics = checkAgainstSchema(SCHEMA_FLAT_GRID, { base_game: cascadeMechanic });
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.message).toContain('grid');
    expect(d.message).toContain('base_game');
  });

  it('a grid whose leaf is not numeric does not satisfy "grid" — mirrors isGrid\'s numeric-leaf rule', () => {
    const SCHEMA_STRING_GRID = schemaWithStages({
      base_game: {
        // Correctly nested two levels deep, but the leaf is `str`, not
        // `int`/`float` — `isGrid` (the post-spin, value-level check in
        // contracts/mechanic.ts) would reject this at runtime; the
        // pre-flight check must reject it too, or a schema like this
        // passes here and then permanently fails on the first real spin.
        grid: { kind: 'list', of: { kind: 'list', of: { kind: 'str' } } },
        cascade_history: { kind: 'list', of: { kind: 'record', name: 'CascadeStep' } },
      },
    });
    const diagnostics = checkAgainstSchema(SCHEMA_STRING_GRID, { base_game: cascadeMechanic });
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.message).toContain('grid');
    expect(d.message).toContain('base_game');
  });

  it('an optional-wrapped field still satisfies its requirement — presence, not optionality, is what matters', () => {
    // `classic` needs `base_win` to be a `number`. A math author writing
    // `base_win: float?` in .spin has not thereby made the field
    // unusable to `classic` — a `FieldKind` requirement has no way to
    // demand or reject optionality in the first place (see
    // `unwrapOptional`'s doc comment). Silence here is the assertion:
    // if `matchesFieldKind` stopped unwrapping `optional` and matched the
    // raw wrapper type instead, this would report a false mismatch.
    const SCHEMA_OPTIONAL_BASE_WIN = schemaWithStages({
      base_game: {
        grid: GRID_TYPE,
        base_win: { kind: 'optional', of: { kind: 'float' } },
        lines: { kind: 'list', of: { kind: 'record', name: 'LineWin' } },
      },
    });
    expect(checkAgainstSchema(SCHEMA_OPTIONAL_BASE_WIN, { base_game: classicMechanic })).toEqual(
      [],
    );
  });

  /**
   * The half-read schema. `checkAgainstSchema` used to treat "the parser
   * dropped this field" and "the math never declared it" as the same
   * fact, so a missing brace anywhere near a required field stopped the
   * game with a sentence that was FALSE. The schema now carries its own
   * partiality (`gaps`), and every test below holds one edge of what that
   * buys — including the edges it must NOT buy.
   */
  describe('a schema that was only half read', () => {
    const SCHEMA_LINES_UNREAD = schemaWithStages(
      {
        base_game: {
          grid: GRID_TYPE,
          base_win: { kind: 'float' },
          // `lines` absent — but absent because the reading lost it, which
          // is what the gap below says.
        },
      },
      [{ in: 'stages', name: 'base_game', field: 'lines' }],
    );

    it('says nothing about a field the schema records as unread', () => {
      expect(checkAgainstSchema(SCHEMA_LINES_UNREAD, { base_game: classicMechanic })).toEqual([]);
    });

    it('still reports the same absence when nothing says the field was unread', () => {
      // The control. Identical schema, empty `gaps` — a math file that
      // genuinely does not declare `lines`.
      const SCHEMA_LINES_MISSING = schemaWithStages({
        base_game: { grid: GRID_TYPE, base_win: { kind: 'float' } },
      });
      const diagnostics = checkAgainstSchema(SCHEMA_LINES_MISSING, {
        base_game: classicMechanic,
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('lines');
      expect(diagnostics[0].severity).toBe('error');
    });

    it('is silenced only for the field the gap names, not for its neighbours', () => {
      // `base_win` is missing too, and nothing says it was unread — the
      // gap covering `lines` must not cover it. This is the exact failure
      // of the cheap fix that was prototyped and rejected: downgrading
      // every finding whenever any parser warning exists also downgrades
      // a real, unrelated error.
      const SCHEMA_TWO_ABSENCES = schemaWithStages({ base_game: { grid: GRID_TYPE } }, [
        { in: 'stages', name: 'base_game', field: 'lines' },
      ]);
      const diagnostics = checkAgainstSchema(SCHEMA_TWO_ABSENCES, { base_game: classicMechanic });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('base_win');
    });

    it('is silenced only for the stage the gap names, not for another stage', () => {
      const SCHEMA_OTHER_STAGE_UNREAD = schemaWithStages(
        { base_game: { grid: GRID_TYPE, base_win: { kind: 'float' } } },
        [{ in: 'stages', name: 'free_spins', field: 'lines' }],
      );
      const diagnostics = checkAgainstSchema(SCHEMA_OTHER_STAGE_UNREAD, {
        base_game: classicMechanic,
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('lines');
    });

    it('a records gap covers nothing on the stages side', () => {
      // The two maps are separate vocabularies. A record read in part says
      // nothing about whether a STAGE declares a field.
      const SCHEMA_RECORD_GAP = schemaWithStages(
        { base_game: { grid: GRID_TYPE, base_win: { kind: 'float' } } },
        [{ in: 'records', name: 'LineWin', field: null }],
      );
      expect(checkAgainstSchema(SCHEMA_RECORD_GAP, { base_game: classicMechanic })).toHaveLength(1);
    });

    it('an unnamed stage gap covers a stage the schema does not declare at all', () => {
      // `name: null` is the widest claim there is: this reading could not
      // say which stages the file has. Complaining that `free_spins` is
      // not declared would be a guess.
      const SCHEMA_NO_STAGES = schemaWithStages({}, [{ in: 'stages', name: null, field: null }]);
      expect(checkAgainstSchema(SCHEMA_NO_STAGES, { free_spins: classicMechanic })).toEqual([]);
    });

    it('still reports an undeclared stage when nothing says the stage list is in doubt', () => {
      // The control for the one above.
      const diagnostics = checkAgainstSchema(SCHEMA, { free_spins: classicMechanic });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('free_spins');
    });

    it('a WRONG KIND is still an error, gap or no gap — a dropped field never becomes a mistyped one', () => {
      // The asymmetry that keeps this check worth having. The parser drops
      // a field it cannot read; it never rewrites one into another type.
      // So a mismatch is always about a field the reading DID read, and a
      // gap naming that very field must not silence it.
      const SCHEMA_MISTYPED_AND_UNREAD = schemaWithStages(
        {
          base_game: {
            grid: GRID_TYPE,
            base_win: { kind: 'float' },
            lines: { kind: 'float' },
          },
        },
        [{ in: 'stages', name: 'base_game', field: 'lines' }],
      );
      const diagnostics = checkAgainstSchema(SCHEMA_MISTYPED_AND_UNREAD, {
        base_game: classicMechanic,
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('lines');
      expect(diagnostics[0].message).toContain('float');
    });
  });

  /**
   * The exact reproduction, end to end through the real parser and the
   * real `classic` bundle: `first-slot`'s own `game/script.spin` with
   * `lines: [LineWin]` cut to `lines:` — one keystroke's worth of damage,
   * mid-edit, on a file whose math is fine.
   *
   * Two fixtures side by side would have proved nothing here: the point
   * is that the schema handed to this function is one a real parser
   * produced from a real file, gaps and all.
   */
  describe("first-slot's own .spin, half read", () => {
    const SOURCE = readFileSync(
      join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game', 'script.spin'),
      'utf8',
    );

    it('says nothing about `lines` when the parser could not read the line declaring it', () => {
      const broken = SOURCE.replace('lines: [LineWin]', 'lines:');
      expect(broken, 'the fixture must actually have been edited').not.toBe(SOURCE);
      const { schema, diagnostics } = parseSpinSchema(broken);
      // The parser did report it — this is not silence about the loss.
      expect(diagnostics.some((d) => d.message.includes('lines'))).toBe(true);
      expect(checkAgainstSchema(schema, { base_game: classicMechanic })).toEqual([]);
    });

    it('is silent on the intact file too, so the test above is not measuring nothing', () => {
      const { schema, diagnostics } = parseSpinSchema(SOURCE);
      expect(diagnostics).toEqual([]);
      expect(checkAgainstSchema(schema, { base_game: classicMechanic })).toEqual([]);
    });

    it('is silent under the FLAT dialect too, where a dropped duplicate is the whole loss', () => {
      // The majority case — five of the eight real `.spin` files in this
      // repo use `data = <Record>` — and the one the first pass missed.
      // The record IS the stage's shape there, so a `records` gap that
      // never reached the stages side left this function saying the math
      // does not declare `base_win`/`lines` about a file whose dropped
      // duplicate declares both. Measured: two `error` diagnostics and the
      // failure screen.
      const flat = `
record LineWin { line: int  win: float }
record D { grid: [[int]] }
record D { grid: [[int]]  base_win: float  lines: [LineWin] }
game "flat" { bet_levels = [1.0]  max_win = 10.0  data = D }
action spin { stage = base_game  cost = 1.0 }
`;
      const { schema, diagnostics } = parseSpinSchema(flat);
      expect(diagnostics.some((d) => d.message.includes('duplicate record "D"'))).toBe(true);
      expect(schema!.stages.base_game.lines).toBeUndefined();
      expect(checkAgainstSchema(schema, { base_game: classicMechanic })).toEqual([]);
    });

    it('… and the same file with no duplicate still reports the genuine absence', () => {
      // The control. One declaration, nothing dropped, `base_win`/`lines`
      // really are not there.
      const flat = `
record D { grid: [[int]] }
game "flat" { bet_levels = [1.0]  max_win = 10.0  data = D }
action spin { stage = base_game  cost = 1.0 }
`;
      const { schema, diagnostics } = parseSpinSchema(flat);
      expect(diagnostics).toEqual([]);
      expect(schema!.gaps).toEqual([]);
      const found = checkAgainstSchema(schema, { base_game: classicMechanic });
      expect(found).toHaveLength(2);
      expect(found.every((d) => d.severity === 'error')).toBe(true);
    });

    it('still reports the absence when the field is DELETED rather than left unreadable', () => {
      // The control that separates "unread" from "not declared" against
      // the same real file: remove the declaration outright and the
      // pre-flight speaks up exactly as it always did.
      const without = SOURCE.replace('    lines: [LineWin]\n', '');
      expect(without, 'the fixture must actually have been edited').not.toBe(SOURCE);
      const { schema, diagnostics } = parseSpinSchema(without);
      expect(diagnostics).toEqual([]);
      expect(schema!.gaps).toEqual([]);
      const found = checkAgainstSchema(schema, { base_game: classicMechanic });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('lines');
      expect(found[0].severity).toBe('error');
    });
  });
});

/**
 * `check`/`present` reporting to the shared diagnostics service.
 *
 * Unlike `collisions()`/`checkAgainstSchema` above — read directly by
 * `createGame` at compose time, and covered by task 2's fill of the
 * service from what it collected — `check`/`present` run POST-composition,
 * per spin, and `createGame` never calls either. Nothing else in this
 * composition is positioned to write them: this registry IS the cordis
 * plugin that owns the call (see `MechanicsService.present`'s own doc,
 * "why the engine owns this call"), so it writes here rather than leaving
 * every page to notice and wire it — see task-2-3-report.md.
 *
 * `check` writes its OWN diagnostics whenever it runs, called directly or
 * through `present`. `present` writes only the diagnostics that are its
 * OWN (a mechanic that threw, or returned something that is not a plan) —
 * never re-writing what `check` already reported in the shared
 * check-then-present sequence. That split is what the "appears once" tests
 * below actually pin.
 */
describe('mechanics: reporting to the diagnostics service', () => {
  async function registryWithDiagnostics(): Promise<{ ctx: Context }> {
    const ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(mechanicsPlugin);
    return { ctx };
  }

  it('check(): a diagnostic that is both returned and recorded appears once', async () => {
    const { ctx } = await registryWithDiagnostics();

    const problems = ctx.mechanics.check('base_game', { grid: [[1]] });

    expect(problems.length).toBeGreaterThan(0);
    expect(ctx.diagnostics.list()).toHaveLength(problems.length);
    expect(ctx.diagnostics.list().map((d) => d.message)).toEqual(problems.map((d) => d.message));

    await ctx.fiber.dispose();
  });

  it('present(): a check failure reaches the service once, not twice', async () => {
    // `present` returns EXACTLY what `check` returned in this branch —
    // the scenario that would double-count if both `check` and `present`
    // wrote independently rather than `present` deferring to `check`'s own
    // write.
    const { ctx } = await registryWithDiagnostics();

    const { diagnostics } = ctx.mechanics.present('base_game', {});

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(ctx.diagnostics.list()).toHaveLength(diagnostics.length);

    await ctx.fiber.dispose();
  });

  it("present(): its OWN failure (present() throws) reaches the service once", async () => {
    const { ctx } = await registryWithDiagnostics();
    ctx.mechanics.register({
      id: 'boom',
      requires: { fields: {} },
      present: () => {
        throw new Error('present blew up');
      },
    });
    ctx.mechanics.bind('base_game', 'boom');

    const { diagnostics } = ctx.mechanics.present('base_game', {});

    expect(diagnostics).toHaveLength(1);
    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics.list()[0].message).toBe(diagnostics[0].message);

    await ctx.fiber.dispose();
  });

  it('present(): its OWN failure (not a plan) reaches the service once', async () => {
    const { ctx } = await registryWithDiagnostics();
    ctx.mechanics.register({
      id: 'wrong',
      requires: { fields: {} },
      present: () => undefined as never,
    });
    ctx.mechanics.bind('base_game', 'wrong');

    const { diagnostics } = ctx.mechanics.present('base_game', {});

    expect(diagnostics).toHaveLength(1);
    expect(ctx.diagnostics.list()).toHaveLength(1);

    await ctx.fiber.dispose();
  });

  it('a clean present() reports nothing', async () => {
    const { ctx } = await registryWithDiagnostics();
    ctx.mechanics.register({
      id: 'good',
      requires: { fields: { grid: 'grid' } },
      present: () => [{ kind: 'marker' } as never],
    });
    ctx.mechanics.bind('base_game', 'good');

    const { diagnostics } = ctx.mechanics.present('base_game', { grid: [[1]] });

    expect(diagnostics).toEqual([]);
    expect(ctx.diagnostics.list()).toEqual([]);

    await ctx.fiber.dispose();
  });

  it('does nothing, quietly, when no diagnostics row is composed', async () => {
    // The row is optional. `check`/`present` must still return what they
    // always did — they just have nowhere in common to also land it.
    const { ctx } = await registry();

    expect(() => ctx.mechanics.check('base_game', {})).not.toThrow();
    const problems = ctx.mechanics.check('base_game', {});
    expect(problems.length).toBeGreaterThan(0);

    await ctx.fiber.dispose();
  });
});
