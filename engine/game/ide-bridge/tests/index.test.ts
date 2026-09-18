import { Context } from 'cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { createDiagnostics } from '@energy8engine/diagnostics';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import * as ideBridge from '../src/index';
import { attachDiagnosticsForwarding } from '../src/index';

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
        clientInject: [],
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

  it('the stage the composition binds is read once, before this module binds anything', async () => {
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

    // Past the tick on which this module's own `inject(['mechanics'])`
    // first fires (cordis runs it asynchronously) — it must not re-read
    // the stages off a registry this module has already bound on.
    await new Promise((resolve) => setTimeout(resolve, 0));

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

/**
 * `attachDiagnosticsForwarding` is the plan's own interface (task-5-brief):
 * subscribes a socket to a `DiagnosticsService` and forwards the list as one
 * `game-diagnostics` frame — as soon as there is an open socket to say it
 * on, and again on every change. Tested standalone, against a plain fake
 * socket and a real `createDiagnostics()` service — not through `apply()` —
 * because it is named and exported precisely so it can be.
 *
 * The "as soon as there is an open socket" half was missing, and it was the
 * whole of the recorded defect: everything `createGame` collects is already
 * in the log before this function runs, so a game that failed AT BOOT had no
 * later change to forward and said nothing at all to the editor — measured
 * live, the game showing its reason and the panel saying "no game connected
 * yet". The same line fixes the mirror case: a game whose failure has been
 * FIXED states an empty list, which is what replaces the stale frame
 * `rpc.ts` retains and deliberately never clears.
 *
 * Local `fakeSocket`/`d` helpers, deliberately not the file's own
 * module-level `fakeSocket()` above: that one fakes the RECEIVING half
 * (`addEventListener`/`emit`) `apply()`'s inbound `snapshot` listener
 * needs; this one fakes the SENDING half this function needs, and the two
 * names would collide if both lived at module scope.
 */
describe('ide-bridge forwards the game diagnostics', () => {
  /**
   * A socket the test drives: `readyState` is writable, `open()` flips it
   * and fires the listener this function registers, every frame sent is
   * recorded, and `deliver()`/`deliverRaw()` fire whatever `message`
   * listener this function registers — the inbound half added alongside
   * `open`, so a test can hand this socket a frame the way a real one
   * hands `attachDiagnosticsForwarding` bytes off the wire. `openNow`
   * starts it already open, which is what a caller handing over a live
   * socket looks like.
   */
  function fakeSocket(readyState = 1) {
    const sent: string[] = [];
    // `WebSocketLike` has one listener signature for every event type (see
    // its own doc) — a `message` listener reads `event.data`, an `open`
    // listener reads nothing — so this matches that signature and hands the
    // open listener an event it does not look at.
    const openListeners: ((event: { data: string }) => void)[] = [];
    const messageListeners: ((event: { data: string }) => void)[] = [];
    const socket = {
      readyState,
      send: (frame: string) => {
        sent.push(frame);
      },
      sent,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'open') openListeners.push(listener);
        if (type === 'message') messageListeners.push(listener);
      },
      close() {},
      /** What a real socket does when it finishes connecting. */
      open() {
        socket.readyState = 1;
        for (const listener of openListeners) listener({ data: '' });
      },
      /** What a real socket does when a well-formed frame arrives FROM the host. */
      deliver(message: unknown) {
        const data = JSON.stringify(message);
        for (const listener of messageListeners) listener({ data });
      },
      /** Same, for bytes that are not even valid JSON. */
      deliverRaw(data: string) {
        for (const listener of messageListeners) listener({ data });
      },
    };
    return socket;
  }
  const d = (message: string) => ({ severity: 'error' as const, plugin: 'p', where: 'w', message });
  /** Every frame this socket has been sent, parsed. */
  const frames = (socket: { sent: string[] }) => socket.sent.map((raw) => JSON.parse(raw));
  const last = (socket: { sent: string[] }) => frames(socket).at(-1);

  it('states the list it is attaching to, before anything changes', () => {
    // The boot case, in one test: everything `createGame` collected is
    // already in the log when this function runs. Nothing changes
    // afterwards, and the editor must still be told.
    const socket = fakeSocket();
    const log = createDiagnostics();
    log.report(d('the composition failed at boot'));

    attachDiagnosticsForwarding(socket, log);

    expect(socket.sent).toHaveLength(1);
    expect(last(socket).type).toBe('game-diagnostics');
    expect(last(socket).diagnostics.map((x: { message: string }) => x.message)).toEqual([
      'the composition failed at boot',
    ]);
  });

  it('waits for the socket to open when it is still connecting, then states it', () => {
    // The ordinary browser case: `apply()` wires this up on a socket that
    // has not finished connecting, so the immediate attempt is a no-op and
    // `open` is what actually carries the boot list.
    const socket = fakeSocket(0); // CONNECTING
    const log = createDiagnostics();
    log.report(d('the composition failed at boot'));

    attachDiagnosticsForwarding(socket, log);
    expect(socket.sent, 'nothing can be said on a socket that is not open yet').toEqual([]);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    expect(last(socket).diagnostics.map((x: { message: string }) => x.message)).toEqual([
      'the composition failed at boot',
    ]);
  });

  it('a healthy game states an EMPTY list — the fact that replaces a stale one', () => {
    // The mirror of the boot case, and the reason an empty frame is not
    // "nothing to send": `rpc.ts` retains the last frame per source and
    // never clears it, so a game that has been fixed can only stop being
    // shown as broken by saying what is true now.
    const socket = fakeSocket(0);
    const log = createDiagnostics();

    attachDiagnosticsForwarding(socket, log);
    socket.open();

    expect(socket.sent).toHaveLength(1);
    expect(last(socket)).toMatchObject({ type: 'game-diagnostics', diagnostics: [], dropped: 0 });
  });

  it('says nothing more once disposed, even if the socket opens later', () => {
    const socket = fakeSocket(0);
    const log = createDiagnostics();
    const detach = attachDiagnosticsForwarding(socket, log);
    detach();
    socket.open();
    log.report(d('after teardown'));
    expect(socket.sent).toEqual([]);
  });

  it('sends what the service holds, as one game-diagnostics frame, when it changes', () => {
    const socket = fakeSocket();
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log); // the unit under test
    log.report(d('reels blew up'));
    // Two: the list as it stood when this attached (empty), and the list
    // after the report. The second is the one this test is about.
    expect(socket.sent).toHaveLength(2);
    expect(last(socket).type).toBe('game-diagnostics');
    expect(last(socket).diagnostics.map((x: { message: string }) => x.message)).toEqual([
      'reels blew up',
    ]);
  });

  it('sends nothing when the socket is not open, and does not throw', () => {
    const socket = fakeSocket(0); // CONNECTING, and never opened
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);
    expect(() => log.report(d('while closed'))).not.toThrow();
    expect(socket.sent).toEqual([]);
  });

  it('sends what the game PRODUCED, not what it was handed', () => {
    // `createGame` seeds the HOST's project diagnostics into the same
    // service so `boot` and the game's page can paint one list. The editor
    // already holds those, off the same `/api/composition` response, over
    // its own channel — forwarding them made the panel render one project
    // failure twice, the second copy labelled as the game's.
    const socket = fakeSocket();
    const log = createDiagnostics();
    log.seed(d('the host already told the editor this'));
    attachDiagnosticsForwarding(socket, log);
    log.report(d('reels blew up'));

    expect(last(socket).diagnostics.map((x: { message: string }) => x.message)).toEqual([
      'reels blew up',
    ]);
    // And the frame this attached with said the same — a seeded entry is
    // never sent, at any moment.
    expect(frames(socket)[0].diagnostics).toEqual([]);
  });

  it('still says how many were forgotten, counting both kinds', () => {
    // `dropped` is the whole list's, which can only OVERSTATE what this
    // frame is missing. That is the safe direction: a reader told too much
    // was forgotten loses a sentence; one told too little believes it has
    // everything.
    const socket = fakeSocket();
    const log = createDiagnostics({ limit: 1 });
    log.seed(d('seeded, will be forgotten'));
    attachDiagnosticsForwarding(socket, log);
    log.report(d('the only survivor'));

    expect(last(socket).dropped).toBe(1);
    expect(last(socket).diagnostics.map((x: { message: string }) => x.message)).toEqual([
      'the only survivor',
    ]);
  });

  it('a send that throws does not trigger another send', () => {
    // The recursion this must not have: forward -> throws -> reports the
    // failure -> the service notifies -> forward again. A dev-only bridge
    // that spins on a broken socket is worse than one that says nothing.
    const log = createDiagnostics();
    let calls = 0;
    const socket = {
      readyState: 1,
      sent: [] as string[],
      addEventListener() {},
      close() {},
      send() {
        calls += 1;
        throw new Error('socket died mid-send');
      },
    };
    attachDiagnosticsForwarding(socket, log);
    // The attach itself states the (empty) list and throws doing it. Zeroed
    // here so the count below is one report's worth and nothing else —
    // otherwise a recursion of exactly one extra call would hide inside the
    // initial frame's own count.
    calls = 0;
    log.report(d('first'));
    expect(calls).toBe(1);
  });

  /**
   * The receiving half — Task 6. `rpc.ts`'s `reportGameDiagnostics`
   * already sends this host's OWN `/api/spin` failures down this exact
   * socket, stamped `source: 'host'`, to every connected client: the host
   * keeps one socket set and draws no line between an editor tab and a
   * game's bridge (see `rpc.ts`'s own `clients` doc). Nothing on this side
   * ever read that frame, so a failure only the HOST had noticed reached
   * the editor but never the game it happened to — the gap these tests
   * close.
   */
  it('seeds a game-diagnostics frame the host sends down, and does not forward it back up', () => {
    // The loop this must not have: down (`seed`) -> up (`own()` via
    // `forward`, subscribed above) -> down again. `seed`ing still notifies
    // that same subscription — `add()` inside `createDiagnostics` does not
    // distinguish `report` from `seed` when it fires listeners — so the
    // loop is broken by WHAT gets sent staying empty (`own()` excludes a
    // seeded entry), not by the subscription never firing again.
    const socket = fakeSocket();
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);

    socket.deliver({
      type: 'game-diagnostics',
      source: 'host',
      dropped: 0,
      diagnostics: [d('spin failed')],
    });

    expect(log.own()).toEqual([]); // seeded, not reported
    expect(log.list().map((x) => x.message)).toEqual(['spin failed']);
    expect(frames(socket).filter((f) => f.diagnostics.length > 0)).toEqual([]);
  });

  it('a seeded diagnostic still shows on the game page', () => {
    // Not a property of `attachDiagnosticsForwarding` itself — `seed` and
    // `list` are `@energy8engine/diagnostics`'s own contract, already
    // covered in that package's tests. Restated here, the same way the
    // composition test at the bottom of this file restates a Task 2
    // property, so the reason the test above seeds rather than reports has
    // a home right next to where that choice is made: `list()` is what
    // `boot` and this game's own page paint, and it must carry a seeded
    // entry just as it carries a reported one — whoever first noticed it.
    const log = createDiagnostics();
    log.seed(d('spin failed'));
    expect(log.list()).toHaveLength(1);
  });

  it('still ignores frames it has no business with', () => {
    // The strict filter is what keeps the namespaces apart. Widening it by
    // one type — accepting `game-diagnostics` — must not widen it by two:
    // a `game-diagnostics` frame is this game's business ONLY when it is
    // stamped `source: 'host'`.
    const socket = fakeSocket();
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);

    // The original case: a project diagnostic, wrong type entirely.
    socket.deliver({ type: 'diagnostics', diagnostics: [d('a project problem')] });
    // The same wrong type, with a `source` field bolted on — proves the
    // type check itself is doing the rejecting here, not the source check
    // below catching it by coincidence.
    socket.deliver({
      type: 'diagnostics',
      diagnostics: [d('a project problem, source spoofed')],
      source: 'host',
    });
    // Right type, wrong source: `rpc.ts`'s relay forwards a CLIENT's own
    // frame to every OTHER client, so with two games open on one dev host,
    // this socket also receives ANOTHER game's frame, stamped
    // `source: 'game'`. Seeding that would mix one game's failures into an
    // unrelated game's list — worse than the gap this closes.
    socket.deliver({
      type: 'game-diagnostics',
      source: 'game',
      dropped: 0,
      diagnostics: [d('a DIFFERENT game said this')],
    });
    // Right type, no source at all: `GameDiagnosticsMessage.source`'s own
    // doc says an absent source reads as `'game'` — the meaning the field
    // had before there were two speakers — so it must be rejected the same
    // way an explicit `'game'` is.
    socket.deliver({ type: 'game-diagnostics', dropped: 0, diagnostics: [d('no source given')] });

    expect(log.list()).toEqual([]);
  });

  it('ignores a malformed frame delivered the same way, and does not throw', () => {
    // Same family `apply()`'s own snapshot listener already guards
    // against: `null`, an array, and a primitive all pass `JSON.parse` but
    // would throw on `.type` outside a catch; plain unparsable text throws
    // inside `JSON.parse` itself.
    const socket = fakeSocket();
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);

    expect(() => {
      for (const raw of ['not json', 'null', '42', '[]']) socket.deliverRaw(raw);
    }).not.toThrow();
    expect(log.list()).toEqual([]);
  });

  it('seeds nothing more once disposed, even if a frame arrives later', () => {
    const socket = fakeSocket();
    const log = createDiagnostics();
    const detach = attachDiagnosticsForwarding(socket, log);
    detach();

    socket.deliver({
      type: 'game-diagnostics',
      source: 'host',
      dropped: 0,
      diagnostics: [d('too late')],
    });

    expect(log.list()).toEqual([]);
  });

  it('a game with no bridge row costs the game nothing', () => {
    // Nothing to assert on the bridge itself — this is the composition test
    // in task 2 restated here so the property has a home in this file too.
    const log = createDiagnostics();
    expect(() => log.report(d('no bridge present'))).not.toThrow();
    expect(log.list()).toHaveLength(1);
  });

  /**
   * "A screen is a plugin", Task 4: the preview wall (a later task in that
   * same slice) runs several games against one host at once, and until
   * this, every one of them sent the SAME unlabelled `game-diagnostics`
   * frame — nothing on the wire said WHICH game a whole-list frame was
   * the whole list OF. Reproduced against the host directly first (see
   * task-4-report.md): two games reporting left only the second's message
   * in what a later client was told, because the host's own retention has
   * no key finer than the fixed source string `'game'`. Fixing THAT
   * retention is a later task's job; this bridge's own half is narrower —
   * stamp the identity it was configured with (`IdeBridgeConfig.game`, see
   * its own doc for where a caller gets one) onto every frame it sends,
   * and touch nothing else. In particular: the inbound filter right above
   * this block (`source === 'host'` only, `seed` not `report`) is a
   * property of an earlier slice with its own tests already guarding it,
   * and adding a field here must not be the thing that quietly widens it.
   */
  describe('ide-bridge forwards the game diagnostics — which game it is', () => {
    it('the bridge stamps its game onto every frame it sends', () => {
      const log = createDiagnostics();
      const socket = fakeSocket();
      attachDiagnosticsForwarding(socket, log, { game: 'tile-3' });
      log.report(d('something'));
      expect(JSON.parse(socket.sent[0]).game).toBe('tile-3');
    });

    it('a game with no identity configured still sends, and says nothing false', () => {
      // A single-game setup existed before this field and must keep
      // working; absent is a legal value meaning "the only game", not a
      // broken frame.
      const log = createDiagnostics();
      const socket = fakeSocket();
      attachDiagnosticsForwarding(socket, log);
      log.report(d('something'));
      expect(JSON.parse(socket.sent[0]).game).toBeUndefined();
    });

    it('still seeds a host frame, which carries no game of its own', () => {
      // Restates the earlier slice's own test above by name: `source ===
      // 'host'` only, `seed` not `report`. Adding a field must not widen
      // that filter.
      const log = createDiagnostics();
      const socket = fakeSocket();
      attachDiagnosticsForwarding(socket, log);
      socket.deliver({
        type: 'game-diagnostics',
        source: 'host',
        dropped: 0,
        diagnostics: [d('spin failed')],
      });
      expect(log.own()).toEqual([]);
      expect(log.list().map((x) => x.message)).toEqual(['spin failed']);
    });

    it('still ignores another game’s frame, identity or no identity', () => {
      const log = createDiagnostics();
      const socket = fakeSocket();
      attachDiagnosticsForwarding(socket, log, { game: 'tile-1' });
      socket.deliver({
        type: 'game-diagnostics',
        source: 'game',
        game: 'tile-2',
        dropped: 0,
        diagnostics: [d('not mine')],
      });
      expect(log.list()).toEqual([]);
    });
  });

  /**
   * The four tests above hand `attachDiagnosticsForwarding` an
   * already-built identity — none of them go through `apply()`, so the
   * resolution order `IdeBridgeConfig.game`'s own doc promises
   * (`config.game ?? ?game= off this page's own address`) had no test at
   * either layer: not the ternary in `apply()` itself, and not — unlike
   * `bridgeUrl`'s sibling fallback, which roughly twenty e2e specs
   * exercise for real through `first-slot`'s `main.ts` calling
   * `ideBridge.apply(game.ctx, {})` with no `bridgeUrl` — anywhere one
   * layer up either, since nothing in this tree opens a game at a `?game=`
   * URL yet. This is the one piece of genuinely new logic in the whole
   * diff with no backstop, and it is exactly the wire a preview wall
   * depends on, so it gets its own two tests rather than staying an
   * inspection-only claim in a doc comment.
   *
   * `vi.stubGlobal`/`vi.unstubAllGlobals` needs no jsdom — `location` does
   * not exist in this suite's plain node environment, so stubbing it is
   * adding a global for the duration of one test, not overriding a real
   * one. Scoped to this describe's own `afterEach` so no other test in this
   * file — in particular "does not open a socket when no bridgeUrl is
   * given and no browser location exists", which depends on `location`
   * staying absent — ever sees it.
   */
  describe('ide-bridge forwards the game diagnostics — apply() resolves the identity', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("an explicit config.game wins over a ?game= in the page's own address", async () => {
      ctx = new Context();
      await ctx.plugin(diagnosticsRuntime);
      const { bind, forStage, bindings } = fakeMechanics();
      ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
      vi.stubGlobal('location', { search: '?game=from-url' });
      const socket = fakeSocket();

      ideBridge.apply(ctx, {
        stage: 'base_game',
        mechanic: 'classic',
        bridgeUrl: 'ws://x/ide',
        game: 'from-config',
        socketFactory: () => socket as never,
      });

      expect(last(socket).game).toBe('from-config');
    });

    it("with no config.game, the page's own ?game= in the address is used", async () => {
      ctx = new Context();
      await ctx.plugin(diagnosticsRuntime);
      const { bind, forStage, bindings } = fakeMechanics();
      ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
      vi.stubGlobal('location', { search: '?game=from-url' });
      const socket = fakeSocket();

      ideBridge.apply(ctx, {
        stage: 'base_game',
        mechanic: 'classic',
        bridgeUrl: 'ws://x/ide',
        socketFactory: () => socket as never,
      });

      expect(last(socket).game).toBe('from-url');
    });
  });
});

/**
 * A `game-composition` frame is the host saying "these GAME rows changed,
 * and here is whether that needs a reload". With `reload: false` the game
 * re-applies each changed row in place through `gameRows` (the service
 * `createGame` provides; faked here); with `reload: true` it does nothing,
 * because the IDE is about to reload the iframe and any in-place work
 * would be thrown away with it. An id with no fiber answers `'unknown'`
 * and stays silent (spec §4) — that is `gameRows`'s call, not this one's.
 */
describe('ide-bridge — re-applying game rows from a game-composition frame', () => {
  function gameRow(id: string, config: Record<string, unknown>) {
    return {
      id,
      name: `@e/${id}`,
      config,
      from: 'patch' as const,
      runtimeUrl: null,
      schema: null,
      hot: true,
    };
  }

  function bridged() {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const update = vi.fn(async () => 'updated' as const);
    ctx.provide('gameRows' as never, { update } as never);
    const socket = fakeSocket();
    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    return { socket, update };
  }

  it('re-applies each changed row, in the order the frame lists them, with that row’s config from the frame', () => {
    const { socket, update } = bridged();

    socket.emit({
      type: 'game-composition',
      reload: false,
      changed: ['reels1', 'mechanics1'],
      rows: [
        gameRow('mechanics1', { stages: { base_game: 'cascade' } }),
        gameRow('reels1', { config: { grid: { cols: 4, rows: 3 } } }),
        gameRow('renderer1', { width: 1280 }),
      ],
    });

    expect(update.mock.calls).toEqual([
      ['reels1', { config: { grid: { cols: 4, rows: 3 } } }],
      ['mechanics1', { stages: { base_game: 'cascade' } }],
    ]);
  });

  it('does nothing on reload: true — the IDE is reloading the iframe', () => {
    const { socket, update } = bridged();

    socket.emit({
      type: 'game-composition',
      reload: true,
      changed: ['renderer1'],
      rows: [gameRow('renderer1', { width: 1280 })],
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('skips a changed id the frame carries no row for, and still re-applies the rest', () => {
    const { socket, update } = bridged();

    socket.emit({
      type: 'game-composition',
      reload: false,
      changed: ['ghost1', 'reels1'],
      rows: [gameRow('reels1', { config: {} })],
    });

    expect(update.mock.calls).toEqual([['reels1', { config: {} }]]);
  });

  it('a game with no gameRows service (an older runtime) ignores the frame without throwing', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeSocket();
    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });

    expect(() =>
      socket.emit({
        type: 'game-composition',
        reload: false,
        changed: ['reels1'],
        rows: [gameRow('reels1', { config: {} })],
      }),
    ).not.toThrow();
  });

  it('binds on the registry that is there NOW — a hot mechanics1 re-apply replaces it under this module', async () => {
    ctx = new Context();
    const stale = fakeMechanics();
    stale.bind('base_game', 'classic');
    const offStale = ctx.provide('mechanics' as never, stale as never);
    const socket = fakeSocket();
    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    stale.bind.mockClear();

    // What `gameRows.update('mechanics1', …)` does to the context: the old
    // provide is disposed, a new registry object is provided.
    await offStale();
    const fresh = fakeMechanics();
    fresh.bind('base_game', 'classic');
    ctx.provide('mechanics' as never, fresh as never);

    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { mechanic: 'cascade' } }]),
    );

    expect(fresh.bind).toHaveBeenCalledWith('base_game', 'cascade');
    expect(stale.bind).not.toHaveBeenCalled();
  });
});

/**
 * The override this module holds — the last (stage, mechanic) it applied
 * from its row or a snapshot — must outlive the registry it was applied
 * to. A hot `mechanics1` re-apply (`gameRows.update`) restarts that row's
 * fiber: the old registry, with this module's bind on it, is disposed, and
 * a fresh one is provided with only the composition's own `stages`. Nothing
 * re-broadcasts a snapshot on a game-row PUT, so without a replay the
 * override silently reverted until the next unrelated composition change.
 *
 * Real cordis here, not `ctx.provide` by hand: what is under test is that a
 * sibling `ctx.inject(['mechanics'])` on the same ctx re-fires when the
 * providing fiber restarts (measured on rc.8 — the provide's disposer and
 * the ACTIVE transition both notify), and that a row which registers into
 * the registry from its OWN `inject` (the way `reelstep1` does) has done so
 * before this module's replay lands, because it injected first.
 */
describe('ide-bridge — replaying its override when `mechanics` is re-provided', () => {
  /** A registry the shape of the real one for `bind`/`register`/`forStage`: a bind resolves only once the id is registered. */
  function registry(stages: Record<string, string>) {
    const bound = new Map(Object.entries(stages));
    const registered = new Set<string>();
    return {
      bind: vi.fn((stage: string, id: string) => {
        bound.set(stage, id);
      }),
      register: (id: string) => {
        registered.add(id);
      },
      forStage: (stage: string) => {
        const id = bound.get(stage);
        return id !== undefined && registered.has(id) ? { id } : null;
      },
      bindings: () => Object.fromEntries([...bound].map(([stage]) => [stage, {}])),
    };
  }
  type Registry = ReturnType<typeof registry>;

  /** A `mechanics1`-shaped row: provides a fresh registry per apply, exactly what a fiber restart does. */
  const mechanicsRow = {
    name: 'mechanics',
    apply(c: Context, config: { stages: Record<string, string> }) {
      c.provide('mechanics' as never, registry(config.stages) as never);
    },
  };
  /** A `reelstep1`-shaped row: registers its mechanic into WHATEVER registry is current, from its own `inject`. */
  const reelStepRow = {
    name: 'reelstep',
    apply(c: Context) {
      c.inject(['mechanics'], (ic) => {
        (ic.reflect.get('mechanics', false) as Registry).register('reel-step');
      });
    },
  };
  const current = () => ctx!.reflect.get('mechanics', false) as Registry;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function booted() {
    ctx = new Context();
    const fiber = ctx.plugin(mechanicsRow, { stages: { base_game: 'classic' } });
    await fiber.await();
    ctx.plugin(reelStepRow);
    await tick();
    const socket = fakeSocket();
    const reported: { message: string }[] = [];
    ideBridge.apply(ctx, {
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
      onDiagnostic: (d) => reported.push(d),
    });
    await tick();
    return { fiber, socket, reported };
  }

  it('re-binds the last snapshot binding onto the registry a hot mechanics1 re-apply provides', async () => {
    const { fiber, socket } = await booted();
    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { mechanic: 'reel-step' } }]),
    );
    expect(current().forStage('base_game')).toEqual({ id: 'reel-step' });
    const stale = current();

    // What `gameRows.update('mechanics1', …)` does: the row's own fiber restarts with the new config.
    fiber.update({ stages: { base_game: 'cascade' } });
    await fiber.await();
    await tick();

    expect(current()).not.toBe(stale);
    expect(current().forStage('base_game')).toEqual({ id: 'reel-step' });
  });

  it('re-binds the row’s own boot-time binding too, and finds the id reelstep1 re-registered first', async () => {
    ctx = new Context();
    const fiber = ctx.plugin(mechanicsRow, { stages: { base_game: 'classic' } });
    await fiber.await();
    ctx.plugin(reelStepRow);
    await tick();
    const reported: { message: string }[] = [];
    ideBridge.apply(ctx, {
      mechanic: 'reel-step',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
      onDiagnostic: (d) => reported.push(d),
    });
    await tick();
    expect(reported).toEqual([]);

    fiber.update({ stages: { base_game: 'cascade' } });
    await fiber.await();
    await tick();

    // Bound, AND resolved — `reelstep1`'s inject ran before this module's replay, so `forStage` sees a registered id and no "no mechanic with that id" diagnostic is raised.
    expect(current().forStage('base_game')).toEqual({ id: 'reel-step' });
    expect(reported).toEqual([]);
  });

  it('reads the composition’s stages from the NEW registry — a hot stages change is not the old warning', async () => {
    const { fiber, socket, reported } = await booted();

    fiber.update({ stages: { free_spins: 'classic' } });
    await fiber.await();
    await tick();
    socket.emit(
      snapshotMessage([
        {
          name: '@energy8engine/ide-bridge',
          config: { stage: 'free_spins', mechanic: 'reel-step' },
        },
      ]),
    );

    expect(current().forStage('free_spins')).toEqual({ id: 'reel-step' });
    expect(reported).toEqual([]);
  });

  it('replays nothing when it never applied a binding', async () => {
    const { fiber } = await booted();

    fiber.update({ stages: { base_game: 'cascade' } });
    await fiber.await();
    await tick();

    expect(current().bind).not.toHaveBeenCalled();
    expect(current().forStage('base_game')).toBeNull(); // `cascade` was never registered here — nothing else bound it either
  });
});

/**
 * `scenes`/`scene-select`/`scene-preview` are the host telling this one
 * running game about the IDE's Scenes screen — the document set
 * (`ScenesMessage`), which node is selected (`SceneSelectMessage`), and
 * which scene to show right now (`POST /api/scenes/preview`, relayed as
 * `ScenePreviewMessage`). All three are handed to `ctx.scenes`
 * (`replace`/`highlight`/`show`), read leniently: a game with no `scenes`
 * row (an older runtime, or one that never composed it) ignores the frame
 * instead of throwing.
 */
describe('ide-bridge — scenes frames from the host', () => {
  function bridged(scenes?: {
    replace?: ReturnType<typeof vi.fn>;
    show?: ReturnType<typeof vi.fn>;
    highlight?: ReturnType<typeof vi.fn>;
  }) {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    if (scenes) ctx.provide('scenes' as never, scenes as never);
    const socket = fakeSocket();
    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    return socket;
  }

  it('a `scenes` frame replaces the documents; `scene-select` highlights; `scene-preview` shows', async () => {
    const scenes = { replace: vi.fn(), show: vi.fn(async () => {}), highlight: vi.fn() };
    const socket = bridged(scenes);

    socket.emit({ type: 'scenes', scenes: [{ id: 'a', nodes: [] }], diagnostics: [] });
    expect(scenes.replace).toHaveBeenCalledWith([{ id: 'a', nodes: [] }]);

    socket.emit({ type: 'scene-select', scene: 'a', node: 'n' });
    expect(scenes.highlight).toHaveBeenCalledWith({ scene: 'a', node: 'n' });

    socket.emit({ type: 'scene-select', scene: 'a', node: null });
    expect(scenes.highlight).toHaveBeenCalledWith(null);

    socket.emit({ type: 'scene-preview', scene: 'a' });
    await Promise.resolve(); // `show`'s own promise is not awaited by this module — let it settle

    expect(scenes.show).toHaveBeenCalledWith('a');
  });

  it('without scenes composed, scenes/scene-select/scene-preview frames are ignored', () => {
    const socket = bridged();

    expect(() =>
      socket.emit({ type: 'scenes', scenes: [{ id: 'a', nodes: [] }], diagnostics: [] }),
    ).not.toThrow();
    expect(() =>
      socket.emit({ type: 'scene-select', scene: 'a', node: null }),
    ).not.toThrow();
    expect(() => socket.emit({ type: 'scene-preview', scene: 'free_spins' })).not.toThrow();
  });
});

/**
 * `game-transitions` is this module's own report back to the host: the
 * running game's `transitions` registry, as ids, so the IDE's Scenes screen
 * can offer a scene's `transition` as a pick rather than a free string (see
 * `protocol.ts`'s `GameTransitionsMessage`). Mirrors
 * `attachDiagnosticsForwarding`'s own "state it as soon as there is an open
 * socket to say it on, and again on every change" shape, read leniently the
 * same way `mechanics` is: a game with no `transitions` registry sends
 * nothing, never throws.
 */
describe('ide-bridge — forwards game-transitions', () => {
  /** Sending-only fake: `open()` flips `readyState` and fires the `open` listener; every frame sent is recorded. */
  function fakeOpenableSocket() {
    const sent: string[] = [];
    const openListeners: ((event: { data: string }) => void)[] = [];
    const socket = {
      readyState: 0, // CONNECTING
      send(frame: string) {
        sent.push(frame);
      },
      sent,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'open') openListeners.push(listener);
      },
      close() {},
      open() {
        socket.readyState = 1;
        for (const listener of openListeners) listener({ data: '' });
      },
    };
    return socket;
  }
  const transitionFrames = (socket: { sent: string[] }) =>
    socket.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === 'game-transitions');

  it('sends game-transitions on open, and again when the registry changes', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const listeners = new Set<() => void>();
    const ids = ['cut', 'fade'];
    ctx.provide(
      'transitions' as never,
      {
        ids: () => [...ids],
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      } as never,
    );
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    expect(socket.sent, 'nothing can be said on a socket that is not open yet').toEqual([]);

    socket.open();
    expect(transitionFrames(socket)).toEqual([{ type: 'game-transitions', ids: ['cut', 'fade'] }]);

    ids.push('wipe');
    listeners.forEach((fn) => fn());
    expect(transitionFrames(socket).at(-1)).toEqual({
      type: 'game-transitions',
      ids: ['cut', 'fade', 'wipe'],
    });
  });

  it('sends nothing when there is no transitions registry, and does not throw', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    expect(() =>
      ideBridge.apply(ctx!, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never }),
    ).not.toThrow();
    expect(() => socket.open()).not.toThrow();
    expect(transitionFrames(socket)).toEqual([]);
  });
});

/**
 * `node-types` is the mirror of `game-transitions`, for the running game's
 * node-type registry: its ids and each type's own props schema, so the
 * IDE's Scenes screen can render a node's fields and offer its type as a
 * pick (`protocol.ts`'s `NodeTypesMessage`). Same shape as
 * `attachDiagnosticsForwarding`/the transitions block: state it as soon as
 * there is an open socket and a registry to read, again on every
 * `nodeTypes.subscribe` notification, and again once `nodeTypes` is
 * provided at all — a composition with no `scenes` row sends nothing,
 * never throws.
 */
describe('ide-bridge — forwards node-types', () => {
  /** Same shape as `forwards game-transitions`' own `fakeOpenableSocket`. */
  function fakeOpenableSocket() {
    const sent: string[] = [];
    const openListeners: ((event: { data: string }) => void)[] = [];
    const socket = {
      readyState: 0, // CONNECTING
      send(frame: string) {
        sent.push(frame);
      },
      sent,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'open') openListeners.push(listener);
      },
      close() {},
      open() {
        socket.readyState = 1;
        for (const listener of openListeners) listener({ data: '' });
      },
    };
    return socket;
  }
  const nodeTypeFrames = (socket: { sent: string[] }) =>
    socket.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === 'node-types');

  it('sends node-types on open, and again when the registry changes', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const listeners = new Set<() => void>();
    let types: { type: string; schema: unknown }[] = [{ type: 'container', schema: { a: 1 } }];
    ctx.provide(
      'nodeTypes' as never,
      {
        list: () => [...types],
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      } as never,
    );
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    expect(socket.sent, 'nothing can be said on a socket that is not open yet').toEqual([]);

    socket.open();
    expect(nodeTypeFrames(socket)).toEqual([
      { type: 'node-types', types: [{ type: 'container', schema: { a: 1 } }] },
    ]);

    types = [...types, { type: 'image', schema: { src: 'string' } }];
    listeners.forEach((fn) => fn());
    expect(nodeTypeFrames(socket).at(-1)).toEqual({
      type: 'node-types',
      types: [
        { type: 'container', schema: { a: 1 } },
        { type: 'image', schema: { src: 'string' } },
      ],
    });
  });

  it('starts forwarding once nodeTypes is provided, even after apply already ran', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    expect(nodeTypeFrames(socket)).toEqual([]);

    const listeners = new Set<() => void>();
    let types = [{ type: 'container', schema: {} }];
    ctx.provide(
      'nodeTypes' as never,
      {
        list: () => [...types],
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      } as never,
    );
    // cordis runs a sibling `ctx.inject(['nodeTypes'])` asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(nodeTypeFrames(socket)).toEqual([
      { type: 'node-types', types: [{ type: 'container', schema: {} }] },
    ]);

    types = [...types, { type: 'image', schema: {} }];
    listeners.forEach((fn) => fn());
    expect(nodeTypeFrames(socket)).toHaveLength(2);
  });

  it('sends nothing when there is no nodeTypes registry, and does not throw', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    expect(() =>
      ideBridge.apply(ctx!, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never }),
    ).not.toThrow();
    expect(() => socket.open()).not.toThrow();
    expect(nodeTypeFrames(socket)).toEqual([]);
  });
});

/**
 * The flow editor's own frames: `flow` in (the host telling this game which
 * document to run), `flow-kinds` out (the mirror of `node-types`, for the
 * `flowNodes` registry `@energy8engine/flow`'s `flow1` row provides), and
 * `flow-trace` out (batched, unlike every other forward in this file — see
 * `forwardRegistry`'s own doc for why it is not built on that helper).
 */
describe('ide-bridge — flow frames from the host', () => {
  /** `onTrace` is a stub, not under test here — every `FlowService` fake needs one for `apply`'s own flow-trace subscription (see the `forwards flow-trace` describe block below for that half). */
  function fakeFlow(overrides: { replace?: ReturnType<typeof vi.fn>; stop?: ReturnType<typeof vi.fn> } = {}) {
    return { onTrace: () => () => {}, ...overrides };
  }

  function bridged(flow?: { replace?: ReturnType<typeof vi.fn>; stop?: ReturnType<typeof vi.fn> }) {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    if (flow) ctx.provide('flow' as never, fakeFlow(flow) as never);
    const socket = fakeSocket();
    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    return socket;
  }

  it('a `flow` frame with an object doc replaces it', () => {
    const flow = { replace: vi.fn(), stop: vi.fn() };
    const socket = bridged(flow);

    socket.emit({ type: 'flow', doc: { version: 1, nodes: [], edges: [] }, diagnostics: [] });

    expect(flow.replace).toHaveBeenCalledWith({ version: 1, nodes: [], edges: [] });
    expect(flow.stop).not.toHaveBeenCalled();
  });

  it('a `flow` frame with a null doc stops the run instead of replacing', () => {
    const flow = { replace: vi.fn(), stop: vi.fn() };
    const socket = bridged(flow);

    socket.emit({ type: 'flow', doc: null, diagnostics: [] });

    expect(flow.stop).toHaveBeenCalled();
    expect(flow.replace).not.toHaveBeenCalled();
  });

  it('without flow composed, a flow frame is ignored', () => {
    const socket = bridged();

    expect(() =>
      socket.emit({ type: 'flow', doc: { version: 1, nodes: [], edges: [] }, diagnostics: [] }),
    ).not.toThrow();
    expect(() => socket.emit({ type: 'flow', doc: null, diagnostics: [] })).not.toThrow();
  });
});

/**
 * `flow-kinds` is the mirror of `node-types`, for the running game's flow
 * node-kind registry: each kind's id, its output ports, whether it's a
 * trigger, and its props schema, so the flow editor can render a node's
 * fields and offer its kind as a pick (`protocol.ts`'s `FlowKindsMessage`).
 * Same shape as `node-types`/`game-transitions` — see `forwardRegistry`'s
 * own doc — read leniently: a composition with no `flow` row sends nothing
 * here, never throws.
 */
describe('ide-bridge — forwards flow-kinds', () => {
  /** Same shape as `forwards game-transitions`' own `fakeOpenableSocket`. */
  function fakeOpenableSocket() {
    const sent: string[] = [];
    const openListeners: ((event: { data: string }) => void)[] = [];
    const socket = {
      readyState: 0, // CONNECTING
      send(frame: string) {
        sent.push(frame);
      },
      sent,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'open') openListeners.push(listener);
      },
      close() {},
      open() {
        socket.readyState = 1;
        for (const listener of openListeners) listener({ data: '' });
      },
    };
    return socket;
  }
  const flowKindFrames = (socket: { sent: string[] }) =>
    socket.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === 'flow-kinds');

  it('sends flow-kinds on open, and again when the registry changes', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const listeners = new Set<() => void>();
    let kinds: { kind: string; outs: string[]; trigger?: boolean; schema: unknown }[] = [
      { kind: 'boot', outs: ['next'], trigger: true, schema: { a: 1 } },
    ];
    ctx.provide(
      'flowNodes' as never,
      {
        list: () => [...kinds],
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      } as never,
    );
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    expect(socket.sent, 'nothing can be said on a socket that is not open yet').toEqual([]);

    socket.open();
    expect(flowKindFrames(socket)).toEqual([
      { type: 'flow-kinds', kinds: [{ kind: 'boot', outs: ['next'], trigger: true, schema: { a: 1 } }] },
    ]);

    kinds = [...kinds, { kind: 'on', outs: ['next'], trigger: true, schema: {} }];
    listeners.forEach((fn) => fn());
    expect(flowKindFrames(socket).at(-1)).toEqual({
      type: 'flow-kinds',
      kinds: [
        { kind: 'boot', outs: ['next'], trigger: true, schema: { a: 1 } },
        { kind: 'on', outs: ['next'], trigger: true, schema: {} },
      ],
    });
  });

  it('a kind with no `trigger` field forwards `trigger: false`, not undefined', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    ctx.provide(
      'flowNodes' as never,
      {
        list: () => [{ kind: 'set', outs: ['next'], schema: {} }],
        subscribe: () => () => {},
      } as never,
    );
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();

    expect(flowKindFrames(socket)).toEqual([
      { type: 'flow-kinds', kinds: [{ kind: 'set', outs: ['next'], trigger: false, schema: {} }] },
    ]);
  });

  it('sends nothing when there is no flowNodes registry, and does not throw', () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    expect(() =>
      ideBridge.apply(ctx!, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never }),
    ).not.toThrow();
    expect(() => socket.open()).not.toThrow();
    expect(flowKindFrames(socket)).toEqual([]);
  });
});

/**
 * `flow-trace` forwards the running interpreter's node-by-node trace
 * (`FlowService.onTrace`), batched per animation frame rather than sent one
 * frame per entry — the interpreter can produce several trace entries in
 * one tick (a trigger firing straight into a `merge`, say), and a reader
 * wants "what happened just now", not a socket write per node. `node`
 * environment has no `requestAnimationFrame`, so this module's own
 * fallback (`setTimeout(fn, 0)`) is what these tests actually exercise —
 * see `forwardRegistry`'s own doc, just above `apply`, for why this block
 * is not built on that helper.
 */
describe('ide-bridge — forwards flow-trace (batched)', () => {
  /** Same shape as `forwards game-transitions`' own `fakeOpenableSocket`. */
  function fakeOpenableSocket() {
    const sent: string[] = [];
    const openListeners: ((event: { data: string }) => void)[] = [];
    const socket = {
      readyState: 0, // CONNECTING
      send(frame: string) {
        sent.push(frame);
      },
      sent,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'open') openListeners.push(listener);
      },
      close() {},
      open() {
        socket.readyState = 1;
        for (const listener of openListeners) listener({ data: '' });
      },
    };
    return socket;
  }
  const traceFrames = (socket: { sent: string[] }) =>
    socket.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === 'flow-trace');
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function fakeTraceFlow() {
    const listeners = new Set<(e: unknown) => void>();
    return {
      onTrace: (fn: (e: unknown) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      fire(e: unknown) {
        listeners.forEach((fn) => fn(e));
      },
    };
  }

  it('two entries fired in one tick land in a single flow-trace frame', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeTraceFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();

    const e1 = { run: 1, node: 'a', out: null, at: 1 };
    const e2 = { run: 1, node: 'a', out: 'next', at: 2 };
    flow.fire(e1);
    flow.fire(e2);

    expect(traceFrames(socket), 'not flushed yet — batched to the next tick').toEqual([]);
    await nextTick();
    expect(traceFrames(socket)).toEqual([{ type: 'flow-trace', entries: [e1, e2] }]);
  });

  it('drops entries flushed while the socket is closed, and does not resend them later', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeTraceFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket(); // never opened

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    flow.fire({ run: 1, node: 'a', out: null, at: 1 });
    await nextTick();

    expect(traceFrames(socket)).toEqual([]);
    socket.open();
    await nextTick();
    expect(traceFrames(socket), 'the dropped entry is gone, not replayed on open').toEqual([]);
  });

  it('re-arms the subscription once flow is (re-)provided, even after apply already ran', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();

    const flow = fakeTraceFlow();
    ctx.provide('flow' as never, flow as never);
    // cordis runs a sibling `ctx.inject(['flow'])` asynchronously.
    await nextTick();

    flow.fire({ run: 1, node: 'a', out: null, at: 1 });
    await nextTick();
    expect(traceFrames(socket)).toEqual([
      { type: 'flow-trace', entries: [{ run: 1, node: 'a', out: null, at: 1 }] },
    ]);
  });

  it('sends nothing when there is no flow service, and does not throw', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    expect(() =>
      ideBridge.apply(ctx!, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never }),
    ).not.toThrow();
    expect(() => socket.open()).not.toThrow();
    await nextTick();
    expect(traceFrames(socket)).toEqual([]);
  });
});
