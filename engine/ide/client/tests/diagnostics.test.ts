import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type ServerMessage } from '@energy8engine/contracts';
import { apply, type GameDiagnosticsService } from '../src/plugins/diagnostics';

/** These tests only care about `.message` — severity/plugin/where are fixed filler. */
function d(message: string): Diagnostic {
  return diagnostic('error', 'reels', 'runtime', message);
}

/** The slice of WebSocket this store needs, plus `receive()` to simulate a server push — same shape as connection.test.ts's own FakeSocket. */
class FakeSocket {
  private listeners: ((event: { data: string }) => void)[] = [];
  readyState = 1; // OPEN — these tests exercise the store, not connection semantics
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (type === 'message') this.listeners.push(listener);
  }
  send() {}
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners) listener({ data: JSON.stringify(message) });
  }
}

interface Harness {
  gameDiagnostics: GameDiagnosticsService;
  socket: FakeSocket;
}

/**
 * A hand-built `ctx`, not a full `createIdeClient()`: cordis's Fiber never
 * settles synchronously (confirmed empirically — true even for a plugin
 * whose `apply()` is entirely synchronous, like this one, since
 * `ctx.plugin()`'s scheduling defers regardless of what the plugin itself
 * does), and this file's own "null until a frame arrives" test below reads
 * the service straight off `harness()`'s return with no `await` anywhere —
 * matching `ide-bridge/tests/index.test.ts`'s own precedent of calling a
 * plugin's `apply(ctx, config)` directly against a plain `ctx`, bypassing
 * `ctx.plugin()` entirely, for the same reason. `apply()` only ever calls
 * `ctx.effect` and `ctx.provide`; faking those two runs the real plugin
 * code unchanged and lets `ctx.gameDiagnostics` exist the instant `apply()`
 * returns.
 */
function harness(): Harness {
  const socket = new FakeSocket();
  const result = { socket } as Harness;
  const fakeCtx = {
    effect: (execute: () => unknown) => execute(),
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
  } as unknown as Context;
  apply(fakeCtx, { url: 'ws://x/ide', socketFactory: () => socket });
  return result;
}

function deliver(ctx: Harness, message: ServerMessage) {
  ctx.socket.receive(message);
}

/** Every message of every group, flattened in group order — for tests that only care about total content, not the grouping itself (that is what the second describe block below is for). */
function allMessages(ctx: Harness): string[] {
  return (ctx.gameDiagnostics.groups ?? []).flatMap((g) => g.diagnostics.map((x) => x.message));
}

describe('game diagnostics store', () => {
  it('holds what a game-diagnostics frame carried', async () => {
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [d('reels blew up')], dropped: 0 });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).not.toBeNull());
    expect(allMessages(ctx)).toEqual(['reels blew up']);
  });

  it('null until a frame arrives — absent is not the same as none', () => {
    expect(harness().gameDiagnostics.groups).toBeNull();
  });

  it('a project diagnostics frame does not land here', async () => {
    const ctx = harness();
    deliver(ctx, { type: 'diagnostics', diagnostics: [d('bad row')] });
    expect(ctx.gameDiagnostics.groups).toBeNull();
  });

  it('notifies subscribers exactly once per frame', async () => {
    const ctx = harness();
    const seen = vi.fn();
    ctx.gameDiagnostics.subscribe(seen);
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [], dropped: 0 });
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  });
});

/**
 * Two speakers share this message type — a running game's `ide-bridge` and
 * the host itself (`dev-game`'s `/api/spin` route, which is in no browser
 * at all). Each sends its WHOLE list, which is what makes a frame
 * self-sufficient for a client that just connected; what it must not mean
 * is that one speaker's list replaces the other's.
 *
 * This store held a single `diagnostics` variable and replaced it on every
 * frame, so the host's frame — carrying only its own `/api/spin` failure —
 * erased everything the game had reported, terminally, since nothing makes
 * the game speak again afterwards.
 *
 * A HOST frame never carries a `game` of its own (see
 * `GameDiagnosticsMessage.game`'s own doc — always absent on a host frame),
 * so every test below lands both speakers in the SAME group, the one keyed
 * `undefined` — this describe block is entirely about `source`, a
 * different axis from `game` (see the module doc and the describe block
 * below this one), and neither of these tests names a game at all.
 */
describe('game diagnostics store, per source', () => {
  it('a host frame does not replace what the game reported', async () => {
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('the game said this')],
      dropped: 0,
      source: 'game',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('the host said this')],
      dropped: 0,
      source: 'host',
    });
    await vi.waitFor(() => expect(allMessages(ctx)).toHaveLength(2));
    // One group — neither speaker names a game, so both share the
    // `undefined` bucket. Game first, then host — `GAME_DIAGNOSTIC_SOURCES`
    // order, matching the order `rpc.ts` hands the retained frames to a
    // newly connected client.
    expect(ctx.gameDiagnostics.groups).toHaveLength(1);
    expect(ctx.gameDiagnostics.groups![0].game).toBeUndefined();
    expect(allMessages(ctx)).toEqual(['the game said this', 'the host said this']);
  });

  it('a second frame from one source replaces only that source', async () => {
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('game, first')],
      dropped: 0,
      source: 'game',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('host, only')],
      dropped: 0,
      source: 'host',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('game, first'), d('game, second')],
      dropped: 0,
      source: 'game',
    });
    await vi.waitFor(() => expect(allMessages(ctx)).toHaveLength(3));
    expect(ctx.gameDiagnostics.groups).toHaveLength(1);
    expect(allMessages(ctx)).toEqual(['game, first', 'game, second', 'host, only']);
  });

  it('a frame with no source reads as the game — the meaning it had before there were two', async () => {
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [d('unlabelled')], dropped: 0 });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('relabelled')],
      dropped: 0,
      source: 'game',
    });
    // Replaced, not accumulated: an unlabelled frame is not a third bucket.
    await vi.waitFor(() => expect(allMessages(ctx)).toHaveLength(1));
    expect(allMessages(ctx)).toEqual(['relabelled']);
  });

  it("sums the sources' dropped counts, so the panel cannot understate what was forgotten", async () => {
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [], dropped: 7, source: 'game' });
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [], dropped: 2, source: 'host' });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.dropped).toBe(9));
  });
});

/**
 * Task 5: `game` is a THIRD axis, one level finer than `source` and living
 * only inside it — not a peer of `source`, and not a replacement for it
 * (see the module doc, and `rpc.ts`'s own doc on `lastGameDiagnostics` for
 * the same rule stated on the host side). The preview wall (a later task)
 * opens several tiles against one host at once, each its own
 * `GameDiagnosticsMessage.game`, and this store used to have nowhere to
 * put more than one — `bySource` was keyed by `source` alone, so a second
 * game's frame landed in the SAME `'game'` slot the first one used and
 * silently replaced it, the identical defect `source` itself exists to
 * prevent, one level down.
 */
describe('game diagnostics store, per game', () => {
  it('groups by game, not into one flat list, once more than one game has spoken', async () => {
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('A said this')],
      dropped: 0,
      source: 'game',
      game: 'a',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('B said this')],
      dropped: 0,
      source: 'game',
      game: 'b',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(2));
    const byGame = Object.fromEntries(
      ctx.gameDiagnostics.groups!.map((g) => [g.game, g.diagnostics.map((x) => x.message)]),
    );
    expect(byGame).toEqual({ a: ['A said this'], b: ['B said this'] });
  });

  it("a named game's frame does not leak into another named game's group", async () => {
    // The narrower guard the test above cannot give by itself: this fails
    // just as loudly if both frames were accidentally merged into ONE
    // two-element group as it does if they were flattened entirely.
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('A said this')],
      dropped: 0,
      source: 'game',
      game: 'a',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('B said this')],
      dropped: 0,
      source: 'game',
      game: 'b',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(2));
    const groupA = ctx.gameDiagnostics.groups!.find((g) => g.game === 'a')!;
    const groupB = ctx.gameDiagnostics.groups!.find((g) => g.game === 'b')!;
    expect(groupA.diagnostics.map((x) => x.message)).toEqual(['A said this']);
    expect(groupB.diagnostics.map((x) => x.message)).toEqual(['B said this']);
  });

  it('a second frame from one game replaces only that game, leaving the other alone', async () => {
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('A, first')],
      dropped: 0,
      source: 'game',
      game: 'a',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('B, only')],
      dropped: 0,
      source: 'game',
      game: 'b',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('A, second')],
      dropped: 0,
      source: 'game',
      game: 'a',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(2));
    const groupA = ctx.gameDiagnostics.groups!.find((g) => g.game === 'a')!;
    const groupB = ctx.gameDiagnostics.groups!.find((g) => g.game === 'b')!;
    expect(groupA.diagnostics.map((x) => x.message)).toEqual(['A, second']);
    expect(groupB.diagnostics.map((x) => x.message)).toEqual(['B, only']);
  });

  it("a host frame joins the anonymous game's bucket, never a bucket of its own", async () => {
    // The host is not a game (see the module doc): it has no `game` of its
    // own to be keyed by, and must not be rendered as if it were a fourth,
    // host-shaped entry in `groups`.
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('spin failed')],
      dropped: 0,
      source: 'host',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(1));
    expect(ctx.gameDiagnostics.groups![0].game).toBeUndefined();
    expect(ctx.gameDiagnostics.groups![0].diagnostics.map((x) => x.message)).toEqual([
      'spin failed',
    ]);
  });

  it("a host frame's own `.game`, however it got one, is never trusted — the host still is not a game", async () => {
    // The wire never actually puts `.game` on a host frame (`rpc.ts` never
    // sets one), so this is defence against a frame that should not exist —
    // a future bug, or a hand-crafted one — rather than a shape a
    // conforming host ever sends. Worth holding anyway: trusting it would
    // let a rogue host frame masquerade as a named game's own report, one
    // layer under the exact rule `source` itself exists to keep.
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [d('spin failed')],
      dropped: 0,
      source: 'host',
      game: 'rogue',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(1));
    expect(ctx.gameDiagnostics.groups![0].game).toBeUndefined();
  });

  it('one game, unlabelled, is still the ordinary shape: a single group with no game id', async () => {
    // The common case — a project opened the ordinary way, with no wall in
    // play — must not grow ceremony just because the store can now hold
    // more than one.
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [d('it broke')], dropped: 0 });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.groups).toHaveLength(1));
    expect(ctx.gameDiagnostics.groups![0].game).toBeUndefined();
  });

  it('sums dropped across every game, not just one', async () => {
    const ctx = harness();
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 3,
      source: 'game',
      game: 'a',
    });
    deliver(ctx, {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 4,
      source: 'game',
      game: 'b',
    });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.dropped).toBe(7));
  });
});
