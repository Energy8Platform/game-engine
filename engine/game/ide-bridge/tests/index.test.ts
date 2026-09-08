import { Context } from 'cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import * as ideBridge from '../src/index';

/**
 * `ide-bridge` runs in two different places under the SAME `apply()`:
 *
 *  - Host-side, via `ctx.loader` (an entry in a project's e8.yml, read the
 *    same way `e8-example-probe` is) — there only to expose its `Config`
 *    schema so the composition screen can render a row for it. The
 *    ide-host's own `ctx` never composes `mechanics`, so this half must be
 *    an honest no-op: it must not throw, and it must not try to reach a
 *    network.
 *  - Browser-side, composed directly into a running game's `ctx` (the one
 *    `createGame` builds, which DOES have `ctx.mechanics`) — there to bind
 *    the configured mechanic at boot, then keep listening on the SAME
 *    `/ide` websocket protocol `engine/ide/client/src/plugins/connection.ts`
 *    speaks for live updates, so a knob turned in the IDE's composition
 *    screen reaches the running game without any reload.
 *
 * Called as a plain function, `ideBridge.apply(ctx, config)` — not through
 * `ctx.plugin(ideBridge, config)` — for the same reason `dev-game.ts` calls
 * `session.apply(ctx, config)` directly: it sidesteps a cordis typing
 * constraint (`ctx.plugin()`'s config type is inferred from the exported
 * `Config` schema's own call signature, not from `apply`'s declared
 * parameter type, since a schemastery `Schema` instance is itself callable
 * — see `src/index.ts`'s module doc). `Config` here deliberately only
 * describes `stage` and `mechanic` (what a human edits from the composition screen);
 * `bridgeUrl`/`socketFactory` are wiring, not settings, and a plain
 * function call keeps them out of that inference path entirely. `ctx.loader`
 * itself (the real host-side caller) invokes `apply` reflectively at
 * runtime and was never subject to this either way.
 *
 * Every test below fakes `ctx.mechanics` and `socketFactory` directly —
 * mirroring `connection.ts`'s own `socketFactory` test seam — rather than
 * standing up a real websocket or a real mechanics registry, so these stay
 * fast, deterministic unit tests of ide-bridge's OWN logic.
 */

/**
 * A stateful fake of the one slice of `MechanicsService` this module reads
 * (`bind`/`forStage`) — not just a `vi.fn()` recording calls. The dedupe
 * fix (Task 6) compares an incoming id against `forStage(STAGE)?.id`, so a
 * fake that doesn't actually update what `forStage` returns when `bind` is
 * called would make every dedupe-related assertion below vacuous — it has
 * to behave like the real registry for `mechanics.bind(...)` calls made
 * DIRECTLY (bypassing `ideBridge.apply`'s own `bind` wrapper, the way
 * `main.ts`'s local `<select>` handler does) to mean anything.
 */
function fakeMechanics() {
  const bound = new Map<string, string>();
  const bind = vi.fn((stage: string, mechanicId: string) => {
    bound.set(stage, mechanicId);
  });
  const forStage = vi.fn((stage: string) => {
    const id = bound.get(stage);
    return id === undefined ? null : { id };
  });
  // Every stage bound to a registered mechanic — the real registry's
  // `bindings()`. `ide-bridge` reads it once, at apply time, as the only
  // list of stage names available on the browser side, so a fake without
  // it would make every stage-resolution assertion below vacuous.
  const bindings = vi.fn(() => Object.fromEntries([...bound].map(([stage]) => [stage, {}])));
  return { bind, forStage, bindings };
}

interface FakeSocket {
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(message: ServerMessage): void;
}

function fakeSocket(): FakeSocket {
  const listeners: ((event: { data: string }) => void)[] = [];
  return {
    addEventListener: vi.fn((type: string, listener: (event: { data: string }) => void) => {
      if (type === 'message') listeners.push(listener);
    }),
    close: vi.fn(),
    emit(message: ServerMessage) {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    },
  };
}

function snapshotMessage(rows: { name: string; config: unknown }[]): ServerMessage {
  return {
    type: 'snapshot',
    snapshot: {
      rows: rows.map((row, i) => ({
        id: `x:${i}`,
        name: row.name,
        disabled: false,
        state: 2,
        config: row.config,
        schema: null,
        hot: true,
        clientUrl: null,
      })),
      diagnostics: [],
    },
  };
}

let ctx: Context | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
});

describe('ide-bridge — host-side registration (no ctx.mechanics)', () => {
  it('applies without throwing and never opens a socket', () => {
    ctx = new Context();
    const factory = vi.fn();
    expect(() =>
      ideBridge.apply(ctx!, { stage: 'base_game', mechanic: 'classic', socketFactory: factory }),
    ).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('ide-bridge — composed into a running game (ctx.mechanics present)', () => {
  it('binds the configured mechanic at boot, synchronously', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).toHaveBeenCalledWith('base_game', 'cascade');
  });

  it('does not open a socket when no bridgeUrl is given and no browser location exists', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const factory = vi.fn();

    ideBridge.apply(ctx, { stage: 'base_game', mechanic: 'classic', socketFactory: factory });

    // Boot-time bind still happens — only the live-update wiring is skipped.
    expect(bind).toHaveBeenCalledWith('base_game', 'classic');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rebinds live when a snapshot names this row with a new value', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'cascade' } },
      ]),
    );

    expect(bind).toHaveBeenCalledTimes(2);
    expect(bind).toHaveBeenNthCalledWith(1, 'base_game', 'classic');
    expect(bind).toHaveBeenNthCalledWith(2, 'base_game', 'cascade');
  });

  it('ignores a snapshot with no row for this package name', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([
        { name: 'some-other-plugin', config: { stage: 'base_game', mechanic: 'cascade' } },
      ]),
    );

    expect(bind).toHaveBeenCalledTimes(1); // boot only
  });

  it('does not rebind when the incoming value equals the one already bound', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'classic' } },
      ]),
    );
    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'classic' } },
      ]),
    );

    expect(bind).toHaveBeenCalledTimes(1); // boot only — both pushes repeat the already-bound value
  });

  it('does not drop a broadcast that repeats a value this module itself last wrote, when a direct bind changed ground truth in between', () => {
    // Reproduces the two-channel sequence from the task brief: a local
    // `<select>` handler (`main.ts`) binds `STAGE` DIRECTLY through
    // `ctx.mechanics.bind(...)`, bypassing this module's own `bind`
    // wrapper entirely — so a `lastBound`-style cache that only tracks
    // "what did *I* last write" goes stale the instant that happens.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });
    expect(forStage('base_game')).toEqual({ id: 'classic' }); // boot-time bind landed

    // The local <select> bypass: changes ground truth without ide-bridge
    // ever hearing about it.
    bind('base_game', 'cascade');
    expect(forStage('base_game')).toEqual({ id: 'cascade' });

    // The IDE broadcasts a snapshot repeating 'classic' — the exact value
    // this module itself wrote at boot. A `lastBound`-based dedupe would
    // see this as a no-op repeat and skip it, leaving the game on
    // 'cascade' while the IDE believes it set 'classic'. The fix compares
    // against ground truth instead, so this must still apply.
    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'classic' } },
      ]),
    );

    expect(forStage('base_game')).toEqual({ id: 'classic' });
    // boot ('classic') + direct bypass ('cascade') + this broadcast ('classic')
    expect(bind).toHaveBeenCalledTimes(3);
    expect(bind).toHaveBeenNthCalledWith(3, 'base_game', 'classic');
  });

  it('ignores malformed or unrelated frames without throwing', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    const listener = socket.addEventListener.mock.calls[0][1] as (event: { data: string }) => void;
    expect(() => listener({ data: 'not json' })).not.toThrow();
    expect(() => listener({ data: 'null' })).not.toThrow();
    expect(() => listener({ data: '[]' })).not.toThrow();
    expect(() =>
      listener({ data: JSON.stringify({ type: 'diagnostics', diagnostics: [] }) }),
    ).not.toThrow();
    expect(() =>
      listener({
        data: JSON.stringify(snapshotMessage([{ name: '@energy8engine/ide-bridge', config: {} }])),
      }),
    ).not.toThrow();

    expect(bind).toHaveBeenCalledTimes(1); // boot only — nothing above named a valid new value
  });

  it('closes the socket on dispose', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    await ctx.fiber.dispose();
    ctx = undefined;
    expect(socket.close).toHaveBeenCalled();
  });
});

/**
 * Which mechanics exist is a RUNTIME fact — what a project's composition
 * registered — not a compile-time one. `Config.mechanic` used to be
 * `Schema.union(['classic', 'cascade'])`, a closed enum of the two the
 * ENGINE ships, so a project's own third mechanic was unnameable from the
 * IDE: setting it failed cordis config validation and the row never came
 * up at all. And because this module rebinds on every snapshot, a project
 * whose patch bound that third mechanic got the enum's stale default
 * pushed over it a second after boot, silently.
 */
describe('ide-bridge — naming a mechanic the engine has never heard of', () => {
  it('accepts any mechanic id, not just the two the engine ships', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);

    // The schema is what the IDE validates a row's config against — the
    // failure this replaces was a ValidationError out of cordis, before
    // `apply` ever ran.
    expect(() => ideBridge.Config({ stage: 'base_game', mechanic: 'reel-step' })).not.toThrow();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'reel-step',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).toHaveBeenCalledWith('base_game', 'reel-step');
  });

  it('says so when the id it was told to bind is not registered', () => {
    ctx = new Context();
    // A registry that accepts the bind and still resolves to nothing — the
    // real one does exactly this for an id nobody registered.
    const bind = vi.fn();
    const forStage = vi.fn(() => null);
    // `base_game` is a stage this composition binds, so the only thing left
    // for `ide-bridge` to have an opinion about is the MECHANIC.
    const bindings = vi.fn(() => ({ base_game: {} }));
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string }[] = [];

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'no-such-mechanic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
      onDiagnostic: (d) => reported.push(d),
    });

    expect(bind).toHaveBeenCalledWith('base_game', 'no-such-mechanic');
    expect(reported).toHaveLength(1);
    expect(reported[0].message).toContain('no-such-mechanic');
  });

  it('a row that names no mechanic leaves the composition’s own binding alone', () => {
    // The stale-default clobber. `e8.patch.yml` binds the stage; this row
    // exists so a human CAN override that from the IDE — not so that a
    // value nobody wrote overrides it a second after boot.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'reel-step'); // what the composition already bound
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).not.toHaveBeenCalled();
    expect(forStage('base_game')).toEqual({ id: 'reel-step' });
  });

  it('and neither does a snapshot whose row names none', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'reel-step');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(snapshotMessage([{ name: '@energy8engine/ide-bridge', config: {} }]));
    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: '' } },
      ]),
    );

    expect(bind).not.toHaveBeenCalled();
    expect(forStage('base_game')).toEqual({ id: 'reel-step' });
  });

  it('says it once, not once per snapshot', () => {
    // `rpc.ts` broadcasts on ANY composition change, and an unregistered id
    // can never satisfy the dedupe above (`forStage` keeps answering null),
    // so every broadcast re-attempts the bind. Measured in a real browser:
    // one edit produced four identical lines in the game's log. The BIND
    // stays unconditional — see its comment — but saying the same sentence
    // again adds nothing.
    ctx = new Context();
    const bind = vi.fn();
    const forStage = vi.fn(() => null);
    // `base_game` is a stage this composition binds, so the only thing left
    // for `ide-bridge` to have an opinion about is the MECHANIC.
    const bindings = vi.fn(() => ({ base_game: {} }));
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string }[] = [];
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'no-such-mechanic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
      onDiagnostic: (d) => reported.push(d),
    });
    socket.emit(
      snapshotMessage([
        {
          name: '@energy8engine/ide-bridge',
          config: { stage: 'base_game', mechanic: 'no-such-mechanic' },
        },
      ]),
    );
    socket.emit(
      snapshotMessage([
        {
          name: '@energy8engine/ide-bridge',
          config: { stage: 'base_game', mechanic: 'no-such-mechanic' },
        },
      ]),
    );

    expect(reported).toHaveLength(1);

    // A DIFFERENT bad id is different news, and still gets said.
    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'also-bad' } },
      ]),
    );
    expect(reported).toHaveLength(2);
    expect(reported[1].message).toContain('also-bad');
  });

  it('a human turning the knob still wins, third mechanic or not', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'reel-step');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'base_game', mechanic: 'cascade' } },
      ]),
    );

    expect(bind).toHaveBeenCalledWith('base_game', 'cascade');
    expect(forStage('base_game')).toEqual({ id: 'cascade' });
  });
});
/**
 * Which STAGE the IDE rebinds.
 *
 * This module used to hold `const STAGE = 'base_game'` — the name of the
 * one stage the example game has, compiled into a package that has no
 * business knowing it. The IDE could therefore rebind exactly one stage of
 * one game, and a project whose math declares `free_spins` had no way to
 * say so. Which stages a game has is a runtime fact (the math declares
 * them), so the field is a free string for the same reason the mechanic is.
 */
describe('ide-bridge — naming a stage the module was never told about', () => {
  it('binds whatever stage the row names, not a stage baked into this file', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    // A composition that binds two stages — so nothing here can be
    // mistaken for the sole-stage fallback below.
    bind('base_game', 'classic');
    bind('free_spins', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);

    ideBridge.apply(ctx, {
      stage: 'free_spins',
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).toHaveBeenCalledWith('free_spins', 'cascade');
    expect(forStage('free_spins')).toEqual({ id: 'cascade' });
    // And it left the other one alone.
    expect(forStage('base_game')).toEqual({ id: 'classic' });
  });

  it('rebinds that same stage live, from a snapshot', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'classic');
    bind('free_spins', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([
        {
          name: '@energy8engine/ide-bridge',
          config: { stage: 'free_spins', mechanic: 'cascade' },
        },
      ]),
    );

    expect(forStage('free_spins')).toEqual({ id: 'cascade' });
    expect(forStage('base_game')).toEqual({ id: 'classic' });
  });

  it('falls back to the one stage the composition binds when the row names none', () => {
    // The ordinary case, and why the stage field is optional: a game with
    // one stage needs no answer to "which one", and demanding it would
    // make the common path a two-field form for no information.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('only_stage', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);

    ideBridge.apply(ctx, {
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).toHaveBeenCalledWith('only_stage', 'cascade');
  });

  it('says so, and binds nothing, when there is no stage to fall back on', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'classic');
    bind('free_spins', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string; severity: string }[] = [];

    ideBridge.apply(ctx, {
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
      onDiagnostic: (d) => reported.push(d),
    });

    expect(bind).not.toHaveBeenCalled();
    expect(reported).toHaveLength(1);
    expect(reported[0].severity).toBe('error');
    expect(reported[0].message).toContain('base_game');
    expect(reported[0].message).toContain('free_spins');
  });

  it('warns about a stage nothing else in the composition binds — the typo that would otherwise be silent', () => {
    // The bind still happens: a game may legitimately have a stage its
    // patch leaves unbound, and this module cannot see the math's own list
    // (only what the composition bound). But a mistyped stage name looks
    // exactly like this, and without the warning the human turns the knob
    // and nothing happens at all.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string; severity: string }[] = [];
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'bass_game',
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
      onDiagnostic: (d) => reported.push(d),
    });

    expect(bind).toHaveBeenCalledWith('bass_game', 'cascade');
    expect(reported).toHaveLength(1);
    expect(reported[0].severity).toBe('warning');
    expect(reported[0].message).toContain('bass_game');
    expect(reported[0].message).toContain('base_game');

    // Said once, not once per broadcast — `rpc.ts` broadcasts on ANY
    // composition change, the same rule the unregistered-mechanic
    // complaint already lives under.
    socket.emit(
      snapshotMessage([
        { name: '@energy8engine/ide-bridge', config: { stage: 'bass_game', mechanic: 'classic' } },
      ]),
    );
    expect(reported.filter((d) => d.severity === 'warning')).toHaveLength(1);
  });

  it('says so when a row still sets the field that no longer exists', () => {
    // Measured before the complaint existed: schemastery passes an unknown
    // key through untouched, `mechanic` reads as absent, and `applyRow`
    // returns — byte-for-byte what the legitimate "names no mechanic,
    // leave the binding alone" case does. A person whose row stopped
    // working had nothing at all to look at.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'reel-step');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string; severity: string }[] = [];
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
      onDiagnostic: (d) => reported.push(d),
      // Spread rather than written inline, and deliberately: `base_game`
      // is not a field of `IdeBridgeConfig` any more, which is the whole
      // point. Casting the WHOLE object to silence that would also erase
      // `onDiagnostic`'s parameter type, so the extra key alone is the
      // untyped part — exactly as a hand-edited `e8.yml` delivers it.
      ...({ base_game: 'classic' } as Record<string, unknown>),
    });

    // Still binds nothing — no alias, deliberately.
    expect(bind).not.toHaveBeenCalled();
    expect(forStage('base_game')).toEqual({ id: 'reel-step' });
    expect(reported).toHaveLength(1);
    expect(reported[0].severity).toBe('error');
    expect(reported[0].message).toContain('base_game');
    expect(reported[0].message).toContain('doing nothing');

    // Said once, not once per broadcast.
    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'classic' } }]),
    );
    expect(reported).toHaveLength(1);
  });

  it('and a snapshot carrying it gets the same complaint, not silence', () => {
    // The IDE's own form cannot produce this key; a hand-edited `e8.yml`
    // broadcast over `/ide` can, so the snapshot path carries it through
    // to the same check.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('base_game', 'reel-step');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string }[] = [];
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
      onDiagnostic: (d) => reported.push(d),
    });
    expect(reported).toEqual([]);

    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'cascade' } }]),
    );

    expect(reported).toHaveLength(1);
    expect(reported[0].message).toContain('base_game');
    expect(bind).not.toHaveBeenCalled();
  });

  it('the stage the composition binds is read once, before this module binds anything', () => {
    // Otherwise the fallback would depend on what the human had already
    // typed: binding a second stage from the IDE would make
    // `bindings()` report two, and a later row naming no stage would stop
    // resolving. Read at boot, it stays a fact about the project.
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    bind('only_stage', 'classic');
    bind.mockClear();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      stage: 'a_second_stage',
      mechanic: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    // Now the row stops naming a stage. The fallback must still be
    // `only_stage`, not "ambiguous, there are two". A mechanic that is not
    // what `only_stage` already holds, so the dedupe cannot swallow the
    // call this is measuring.
    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { mechanic: 'reel-step' } }]),
    );

    expect(bind).toHaveBeenLastCalledWith('only_stage', 'reel-step');
  });
});

/**
 * `report`'s diagnostics, reaching the composition's shared `diagnostics`
 * service — this module's own doc already says why nothing else could:
 * "composed by the game's own page, not by the loader, so a throw would be
 * collected by nobody... Failures are data; this is the channel." Since
 * `apply(ctx, config)` is handed the SAME `ctx` a `diagnostics1` row may
 * have composed into (`first-slot`'s `main.ts` calls `ideBridge.apply(
 * game.ctx, ...)`), this module is positioned to write there directly,
 * same as `onDiagnostic` — a second, independent destination, not a
 * replacement for it. See task-2-3-report.md.
 */
describe('ide-bridge — reporting to the diagnostics service', () => {
  it('a diagnostic reported through onDiagnostic also reaches the service, once', async () => {
    ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    const bind = vi.fn();
    const forStage = vi.fn(() => null);
    const bindings = vi.fn(() => ({ base_game: {} }));
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string }[] = [];

    ideBridge.apply(ctx, {
      stage: 'base_game',
      mechanic: 'no-such-mechanic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
      onDiagnostic: (d) => reported.push(d),
    });

    // Both channels hear it — that is two DESTINATIONS, not the service
    // being written twice.
    expect(reported).toHaveLength(1);
    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics.list()[0].message).toBe(reported[0].message);
  });

  it('does nothing, quietly, when no diagnostics row is composed', async () => {
    // The row is optional. `onDiagnostic` must still fire exactly as before.
    ctx = new Context();
    const bind = vi.fn();
    const forStage = vi.fn(() => null);
    const bindings = vi.fn(() => ({ base_game: {} }));
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const reported: { message: string }[] = [];

    expect(() =>
      ideBridge.apply(ctx!, {
        stage: 'base_game',
        mechanic: 'no-such-mechanic',
        bridgeUrl: 'ws://x/ide',
        socketFactory: () => fakeSocket() as never,
        onDiagnostic: (d) => reported.push(d),
      }),
    ).not.toThrow();

    expect(reported).toHaveLength(1);
  });
});
