/**
 * The runtime half's own concern: a `BoardStepRegistry` that a plugin can
 * reach and `executePlan` actually consults — through the ORDINARY
 * composition path, with no caller passing anything.
 *
 * This is here because the registry shipped wired to nothing. `executePlan`
 * grew an optional third parameter, `createBoardStepRegistry` was exported,
 * and no row composed one — so a plugin that registered a handler was never
 * consulted, and the only symptom was a per-step diagnostic at spin time.
 * Every test below fails if this row goes back to providing `execute`
 * alone.
 */
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import * as spinLog from '@energy8engine/spin-log/runtime';
import type { BoardApi } from '../src/index';
import * as runtime from '../src/runtime';

/** A board with exactly one of the six kinds — enough to tell "the board won" from "the registry won". */
function fakeBoard() {
  const calls: string[] = [];
  return {
    calls,
    async spinTo() {
      calls.push('spinTo');
    },
  };
}

describe('play-loop runtime half', () => {
  it('provides a step registry a plugin can register into', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    expect(ctx.steps).toBeDefined();
    expect(typeof ctx.steps.register).toBe('function');
    expect(ctx.steps.kinds()).toEqual([]);

    await ctx.fiber.dispose();
  });

  it('consults it without the caller passing one — the ordinary path', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const run = vi.fn(async () => {});
    ctx.steps.register({ kind: 'reelStep', run });

    // Note the two arguments: exactly the call every consumer already
    // made before a registry existed at all.
    const diagnostics = await ctx.play.execute(
      [{ kind: 'reelStep', shifts: [1, 0] }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(diagnostics).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);

    await ctx.fiber.dispose();
  });

  it('is the same registry `ctx.play.steps` names', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    // Two doors, one room. A plugin injecting `steps` and a caller reading
    // it off the play service must not end up registering into different
    // registries — that failure would look exactly like the one this whole
    // row exists to end.
    //
    // Both asserted present FIRST, on purpose: `toBe` alone passes
    // vacuously while neither exists, which is exactly the state this row
    // was in before this change (measured — it was the one test of the six
    // that stayed green against the unfixed row).
    expect(ctx.steps).toBeDefined();
    expect(ctx.play.steps).toBeDefined();
    expect(ctx.play.steps).toBe(ctx.steps);

    await ctx.fiber.dispose();
  });

  it('a registry the caller passes explicitly still wins over the composed one', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const composed = vi.fn(async () => {});
    ctx.steps.register({ kind: 'reelStep', run: composed });

    const explicit = vi.fn(async () => {});
    const other = { ...ctx.steps };
    const registry = {
      ...other,
      get: (kind: string) => (kind === 'reelStep' ? { kind, run: explicit } : undefined),
    };

    const diagnostics = await ctx.play.execute(
      [{ kind: 'reelStep' }],
      fakeBoard() as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toEqual([]);
    expect(explicit).toHaveBeenCalledTimes(1);
    expect(composed).not.toHaveBeenCalled();

    await ctx.fiber.dispose();
  });

  it('a built-in kind still goes to the board, not the composed registry', async () => {
    // The precedence rule `executePlan` already holds, re-checked through
    // the composed path: registering `spinTo` here must not let a plugin
    // silently replace the board's own for every game that loads it.
    const ctx = new Context();
    await ctx.plugin(runtime);

    const hijack = vi.fn(async () => {});
    ctx.steps.register({ kind: 'spinTo', run: hijack });

    const board = fakeBoard();
    const diagnostics = await ctx.play.execute(
      [{ kind: 'spinTo', board: [[1]] }],
      board as unknown as BoardApi,
    );

    expect(diagnostics).toEqual([]);
    expect(board.calls).toEqual(['spinTo']);
    expect(hijack).not.toHaveBeenCalled();

    await ctx.fiber.dispose();
  });

  it('an unregistered kind is still a diagnostic naming what IS known', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    ctx.steps.register({ kind: 'reelStep', run: async () => {} });

    const [problem] = await ctx.play.execute(
      [{ kind: 'reelStap' }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(problem.message).toContain('reelStap');
    // The composed registry's own kinds, not only the built-in six — the
    // typo's nearest neighbour is the one a person needs named.
    expect(problem.message).toContain('reelStep');

    await ctx.fiber.dispose();
  });
});

/**
 * The other half of this row: writing a spin down.
 *
 * `record` is the caller's only door to the composition's `spin-log`, and
 * it exists so no caller has to know whether there IS one. The three tests
 * below are the three states a composition can be in — log present, log
 * absent, log misbehaving — and a spin must survive all three.
 *
 * Why `record` and not `execute`: a re-presentation is not a spin.
 * `first-slot`'s `__e8.present` replays one captured result under whichever
 * mechanic is bound, running a whole plan through the board each time; if
 * executing a plan wrote to the log, those replays would read back as spins
 * that never happened. The log is "what happened" — so it is written where a
 * spin happens, not where a plan is drawn.
 */
describe('play-loop runtime half: recording a spin', () => {
  it('writes to the spin-log the composition brought', async () => {
    const ctx = new Context();
    await ctx.plugin(spinLog);
    await ctx.plugin(runtime);

    ctx.play.record({
      request: { bet: 1 },
      result: { win: 5 },
      plan: [{ kind: 'spinTo', board: [[1]] }],
    });

    expect(ctx.spinLog.entries()).toHaveLength(1);
    expect(ctx.spinLog.entries()[0]).toMatchObject({ request: { bet: 1 }, result: { win: 5 } });

    await ctx.fiber.dispose();
  });

  it("finds a log composed AFTER it — row order is not this row's to assume", async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    await ctx.plugin(spinLog);

    ctx.play.record({ request: {}, result: { win: 0 }, plan: [] });

    expect(ctx.spinLog.entries()).toHaveLength(1);

    await ctx.fiber.dispose();
  });

  it('does nothing, quietly, when no spin-log row is composed', async () => {
    // The log is optional. A game that keeps no record is not a broken
    // game, so this must not throw and must not complain.
    const ctx = new Context();
    await ctx.plugin(runtime);

    expect(() => ctx.play.record({ request: {}, result: {}, plan: [] })).not.toThrow();

    await ctx.fiber.dispose();
  });

  it('a log that throws does not take the spin down with it', async () => {
    // `@energy8engine/spin-log`'s own `append` never throws, but `spinLog`
    // is a service name anything may provide — and a spin failing because
    // WRITING IT DOWN failed is the one outcome this whole path must not
    // have.
    const ctx = new Context();
    await ctx.plugin(runtime);
    ctx.provide('spinLog', {
      append() {
        throw new Error('disk on fire');
      },
      entries: () => [],
    });

    expect(() => ctx.play.record({ request: {}, result: {}, plan: [] })).not.toThrow();

    await ctx.fiber.dispose();
  });
});
