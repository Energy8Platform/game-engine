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
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import type { BoardApi } from '../src/index';
import * as runtime from '../src/runtime';

/** A board with exactly one of the four kinds — enough to tell "the board won" from "the registry won". */
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
    // was in before this change (measured — it was the one test in this
    // file that stayed green against the unfixed row).
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
    // The composed registry's own kinds, not only the built-in four — the
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

/**
 * A THIRD door this row's `execute` opens, alongside `steps` and `record`:
 * `ctx.play.execute` is `executePlan`'s only production caller (see
 * `../src/index.ts`'s own module doc on `executePlan`'s return), so it is
 * the one place that both knows a plan just ran and can reach the
 * composition's shared diagnostics service — see task-2-3-report.md for why
 * that puts the write here rather than in `executePlan` itself (which
 * returns to a caller and stays cordis-free) or in whichever page happens
 * to call `ctx.play.execute`.
 */
describe('play-loop runtime half: reporting to the diagnostics service', () => {
  it('a diagnostic that is both returned and recorded appears once', async () => {
    // The failure mode this rule exists to prevent: two writers for one
    // event. `execute`'s return value is untouched by this — the same
    // array a caller has always gotten back — so a caller that ALSO logs
    // `diagnostics` locally (first-slot's page does) is a second READER of
    // this array, not a second WRITER of the service.
    const ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(runtime);

    const diagnostics = await ctx.play.execute(
      [{ kind: 'nope' }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(diagnostics).toHaveLength(1);
    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics.list()[0].message).toBe(diagnostics[0].message);

    await ctx.fiber.dispose();
  });

  it('a clean plan reports nothing', async () => {
    const ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(runtime);

    const diagnostics = await ctx.play.execute(
      [{ kind: 'spinTo', board: [[1]] }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(diagnostics).toEqual([]);
    expect(ctx.diagnostics.list()).toEqual([]);

    await ctx.fiber.dispose();
  });

  /**
   * The measured case, in one test. `executePlan` reads
   * `registry.collisions()` on EVERY call — deliberately, since a collision
   * is a fact about the composition rather than about this plan — so ten
   * clean spins against a colliding registry handed the service ten
   * identical entries and one distinct message. At the bound the list would
   * have been nothing but that message, every real failure evicted, and
   * every spin would have forwarded the whole growing list to the IDE.
   *
   * `execute`'s RETURN is deliberately unchanged: a collision is still
   * reported to its caller on every call, because a caller asking "did this
   * plan play cleanly" has to be told the registry is ambiguous. The
   * collapse belongs in the list, which has no time axis and so cannot mean
   * anything by a second identical row.
   */
  it('one composition fact, ten spins, one entry', async () => {
    const ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(runtime);

    const handler = { kind: 'reelStep', async run() {} };
    ctx.steps.register(handler);
    ctx.steps.register({ ...handler }); // a second plugin claiming the same kind

    for (let i = 0; i < 10; i += 1) {
      const returned = await ctx.play.execute(
        [{ kind: 'spinTo', board: [[1]] }],
        fakeBoard() as unknown as BoardApi,
      );
      // Returned every time — see this test's own doc.
      expect(returned, `spin ${i} must still be told the registry is ambiguous`).toHaveLength(1);
    }

    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics.list()[0].message).toContain('claim');

    await ctx.fiber.dispose();
  });

  it('does nothing, quietly, when no diagnostics row is composed', async () => {
    // The row is optional, like spin-log. A plan with a real problem must
    // still be playable and still return what went wrong — it just has
    // nowhere in common to also land.
    const ctx = new Context();
    await ctx.plugin(runtime);

    const diagnostics = await ctx.play.execute(
      [{ kind: 'nope' }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(diagnostics).toHaveLength(1);

    await ctx.fiber.dispose();
  });
});

/**
 * Slice 25 — tempo. Two things the row gains: `execute` carries `StepOpts`
 * through to the board, and `skip()` collapses whatever is presenting right
 * now — the board's own `skip` (the legacy `ReelSystem.skip()`, one level
 * down) plus every registered handler's optional one.
 *
 * The `ui.skip` subscription rides `ctx.inject(['events'])`: a skip has to
 * land DURING a run, which a flow `on` node cannot do (`busy: ignore`), so
 * the row subscribes to the flow bus itself. `inject` and not a read at
 * apply time, for two reasons each with a test below — `playloop1` composes
 * BEFORE `flow1` in `e8-base` (nothing to read yet), and `flow` is
 * `hot: true` (a re-applied flow row hands out a NEW bus, and a
 * subscription captured once would go on holding the dead one).
 */
/** A stand-in for `@energy8engine/flow`'s `createEvents()` — the same two methods. */
function fakeBus() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    service: {
      emit: (name: string, payload?: unknown) => {
        for (const fn of [...(listeners.get(name) ?? [])]) fn(payload);
      },
      on: (name: string, fn: (payload: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        listeners.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
    },
    emit(name: string) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(undefined);
    },
  };
}

/** A row that provides a bus the way `flow1` does, so it can be disposed again. */
const busPlugin = (bus: ReturnType<typeof fakeBus>) => ({
  name: 'fake-flow',
  apply(ctx: Context) {
    ctx.provide('events', bus.service);
  },
});

/** Runs one plan so the row has a board to aim `skip()` at; returns that board's spy. */
async function armedBoard(ctx: Context) {
  const boardSkip = vi.fn();
  await ctx.play.execute([{ kind: 'spinTo', board: [[1]] }], {
    spinTo: async () => {},
    skip: boardSkip,
  } as unknown as BoardApi);
  return boardSkip;
}

describe('play-loop runtime half: turbo and skip', () => {
  it('execute forwards StepOpts to the board', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const spinTo = vi.fn(async () => {});
    await ctx.play.execute(
      [{ kind: 'spinTo', board: [[1]] }],
      { spinTo } as unknown as BoardApi,
      undefined,
      {
        turbo: true,
      },
    );

    expect(spinTo).toHaveBeenCalledWith({ kind: 'spinTo', board: [[1]] }, { turbo: true });

    await ctx.fiber.dispose();
  });

  it('skip() reaches the last board and every registered handler', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const boardSkip = vi.fn();
    const handlerSkip = vi.fn();
    ctx.steps.register({ kind: 'reelStep', run: async () => {}, skip: handlerSkip });
    // A handler with no `skip` at all must not break the fan-out.
    ctx.steps.register({ kind: 'quiet', run: async () => {} });

    await ctx.play.execute([{ kind: 'spinTo', board: [[1]] }], {
      spinTo: async () => {},
      skip: boardSkip,
    } as unknown as BoardApi);
    ctx.play.skip();

    expect(boardSkip).toHaveBeenCalledTimes(1);
    expect(handlerSkip).toHaveBeenCalledTimes(1);

    await ctx.fiber.dispose();
  });

  it('skip() before anything has run, and a board that refuses to be hurried, are both quiet', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    expect(() => ctx.play.skip()).not.toThrow();

    const handlerSkip = vi.fn();
    ctx.steps.register({ kind: 'reelStep', run: async () => {}, skip: handlerSkip });
    await ctx.play.execute([{ kind: 'spinTo', board: [[1]] }], {
      spinTo: async () => {},
      skip: () => {
        throw new Error('nope');
      },
    } as unknown as BoardApi);

    expect(() => ctx.play.skip()).not.toThrow();
    // the throwing board did not cost the handlers their skip
    expect(handlerSkip).toHaveBeenCalledTimes(1);

    await ctx.fiber.dispose();
  });

  it('a `ui.skip` on the flow bus skips — bus composed before this row', async () => {
    const ctx = new Context();
    const bus = fakeBus();
    ctx.provide('events', bus.service);
    await ctx.plugin(runtime);

    const boardSkip = await armedBoard(ctx);
    bus.emit('ui.skip');

    expect(boardSkip).toHaveBeenCalledTimes(1);

    await ctx.fiber.dispose();
  });

  it('…and when the bus lands AFTER this row — the e8-base order — inject arms it then', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const bus = fakeBus();
    ctx.provide('events', bus.service);
    // `inject` fires on a later tick (measured), which the `execute` below
    // gives it; the assertion is that it fires at all, unprompted.
    const boardSkip = await armedBoard(ctx);
    bus.emit('ui.skip');

    expect(boardSkip).toHaveBeenCalledTimes(1);

    await ctx.fiber.dispose();
  });

  /**
   * `flow` is `hot: true`: an edited flow row is disposed and re-applied,
   * un-providing its bus and providing a fresh one. A subscription captured
   * once — the shape this started as — would still be holding the dead bus,
   * and `ui.skip` would silently stop working for the rest of the page's
   * life, with nothing on screen to say why.
   */
  it('re-arms when the flow row is re-applied with a new bus, and lets the old one go', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const first = fakeBus();
    const firstRow = await ctx.plugin(busPlugin(first));
    const boardSkip = await armedBoard(ctx);
    first.emit('ui.skip');
    expect(boardSkip).toHaveBeenCalledTimes(1);

    await firstRow.dispose();
    const second = fakeBus();
    await ctx.plugin(busPlugin(second));
    await new Promise((r) => setTimeout(r, 0));

    second.emit('ui.skip');
    expect(boardSkip).toHaveBeenCalledTimes(2);
    // the old bus was let go on the way out — a stale emit reaches nothing
    first.emit('ui.skip');
    expect(boardSkip).toHaveBeenCalledTimes(2);

    await ctx.fiber.dispose();
  });

  it('no flow bus at all is not an error — the row still plays plans', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    const diagnostics = await ctx.play.execute(
      [{ kind: 'spinTo', board: [[1]] }],
      fakeBoard() as unknown as BoardApi,
    );

    expect(diagnostics).toEqual([]);

    await ctx.fiber.dispose();
  });
});
