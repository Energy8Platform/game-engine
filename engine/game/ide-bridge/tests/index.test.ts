import { Context } from 'cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
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
 * describes `base_game` (what a human edits from the composition screen);
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
  return { bind, forStage };
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
      ideBridge.apply(ctx!, { base_game: 'classic', socketFactory: factory }),
    ).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('ide-bridge — composed into a running game (ctx.mechanics present)', () => {
  it('binds the configured mechanic at boot, synchronously', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);

    ideBridge.apply(ctx, {
      base_game: 'cascade',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => fakeSocket() as never,
    });

    expect(bind).toHaveBeenCalledWith('base_game', 'cascade');
  });

  it('does not open a socket when no bridgeUrl is given and no browser location exists', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const factory = vi.fn();

    ideBridge.apply(ctx, { base_game: 'classic', socketFactory: factory });

    // Boot-time bind still happens — only the live-update wiring is skipped.
    expect(bind).toHaveBeenCalledWith('base_game', 'classic');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rebinds live when a snapshot names this row with a new value', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'cascade' } }]),
    );

    expect(bind).toHaveBeenCalledTimes(2);
    expect(bind).toHaveBeenNthCalledWith(1, 'base_game', 'classic');
    expect(bind).toHaveBeenNthCalledWith(2, 'base_game', 'cascade');
  });

  it('ignores a snapshot with no row for this package name', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(snapshotMessage([{ name: 'some-other-plugin', config: { base_game: 'cascade' } }]));

    expect(bind).toHaveBeenCalledTimes(1); // boot only
  });

  it('does not rebind when the incoming value equals the one already bound', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'classic' } }]),
    );
    socket.emit(
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'classic' } }]),
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
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
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
      snapshotMessage([{ name: '@energy8engine/ide-bridge', config: { base_game: 'classic' } }]),
    );

    expect(forStage('base_game')).toEqual({ id: 'classic' });
    // boot ('classic') + direct bypass ('cascade') + this broadcast ('classic')
    expect(bind).toHaveBeenCalledTimes(3);
    expect(bind).toHaveBeenNthCalledWith(3, 'base_game', 'classic');
  });

  it('ignores malformed or unrelated frames without throwing', () => {
    ctx = new Context();
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
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
    const { bind, forStage } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage } as never);
    const socket = fakeSocket();

    ideBridge.apply(ctx, {
      base_game: 'classic',
      bridgeUrl: 'ws://x/ide',
      socketFactory: () => socket as never,
    });

    await ctx.fiber.dispose();
    ctx = undefined;
    expect(socket.close).toHaveBeenCalled();
  });
});
