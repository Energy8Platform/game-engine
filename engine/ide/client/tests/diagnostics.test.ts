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

describe('game diagnostics store', () => {
  it('holds what a game-diagnostics frame carried', async () => {
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [d('reels blew up')], dropped: 0 });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.diagnostics).not.toBeNull());
    expect(ctx.gameDiagnostics.diagnostics!.map((x) => x.message)).toEqual(['reels blew up']);
  });

  it('null until a frame arrives — absent is not the same as none', () => {
    expect(harness().gameDiagnostics.diagnostics).toBeNull();
  });

  it('a project diagnostics frame does not land here', async () => {
    const ctx = harness();
    deliver(ctx, { type: 'diagnostics', diagnostics: [d('bad row')] });
    expect(ctx.gameDiagnostics.diagnostics).toBeNull();
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
    await vi.waitFor(() => expect(ctx.gameDiagnostics.diagnostics).toHaveLength(2));
    // Game first, then host — `GAME_DIAGNOSTIC_SOURCES` order, matching
    // the order `rpc.ts` hands the retained frames to a newly connected client.
    expect(ctx.gameDiagnostics.diagnostics!.map((x) => x.message)).toEqual([
      'the game said this',
      'the host said this',
    ]);
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
    await vi.waitFor(() => expect(ctx.gameDiagnostics.diagnostics).toHaveLength(3));
    expect(ctx.gameDiagnostics.diagnostics!.map((x) => x.message)).toEqual([
      'game, first',
      'game, second',
      'host, only',
    ]);
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
    await vi.waitFor(() => expect(ctx.gameDiagnostics.diagnostics).toHaveLength(1));
    expect(ctx.gameDiagnostics.diagnostics![0].message).toBe('relabelled');
  });

  it("sums the sources' dropped counts, so the panel cannot understate what was forgotten", async () => {
    const ctx = harness();
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [], dropped: 7, source: 'game' });
    deliver(ctx, { type: 'game-diagnostics', diagnostics: [], dropped: 2, source: 'host' });
    await vi.waitFor(() => expect(ctx.gameDiagnostics.dropped).toBe(9));
  });
});
