import type { Context } from 'cordis';
import type { WebSocket } from 'ws';
import {
  GAME_DIAGNOSTIC_SOURCES,
  type ClientMessage,
  type Diagnostic,
  type GameDiagnosticsSource,
  type ServerMessage,
} from '@energy8engine/contracts';
import { createDiagnostics } from '@energy8engine/diagnostics';

declare module 'cordis' {
  interface Context {
    ideRpc: IdeRpcService;
  }
}

/**
 * The host's own way onto the SAME `game-diagnostics` wire a game's
 * `ide-bridge` uses (see the message handler below) — for the ONE producer
 * that is not a browser socket at all: `dev-game.ts`'s `/api/spin` route,
 * which runs in this HOST process and so has no socket of its own to relay
 * from. `dev-game` reads this leniently (`ctx.reflect.get('ideRpc', false)`,
 * same as `ide-bridge` reads `ctx.diagnostics`) — `rpc` and `dev-game` are
 * SIBLING plugin scopes under `e8 dev`'s shared root `ctx`, and `dev-game`'s
 * own standalone tests compose it with no `rpc` at all, so a static
 * `inject` would leave that fiber PENDING forever waiting for a service
 * nobody provides.
 */
export interface IdeRpcService {
  /**
   * Records what the HOST has just found wrong with the running game, and
   * sends this host's WHOLE list to every connected client. Unlike the
   * relay below, there is no "sender" socket to exclude — the host itself
   * is the origin, not a client passing something on.
   *
   * **Records, not just sends, and the difference is the whole point.**
   * This was `broadcastGameDiagnostics(diagnostics, dropped?)` — it shipped
   * the array it was handed with `dropped` defaulting to `0`, and the
   * client replaces a source's whole list on receipt. So two consecutive
   * `/api/spin` failures left only the second, under a panel asserting that
   * nothing had been forgotten. That is the one direction
   * `GameDiagnosticsMessage.dropped`'s own doc forbids: a reader told too
   * little believes it has everything. The mechanism built so a panel
   * cannot lie did not cover one of its two sources.
   *
   * So the host keeps a list of its own, with the same bound, the same
   * honest `dropped`, and the same "a byte-identical repeat is one entry"
   * rule the GAME's list uses — it is literally the same
   * `createDiagnostics()`, which is cordis-free precisely so a host-side
   * collector can use it (see that package's `runtime.ts` doc).
   */
  reportGameDiagnostics(diagnostics: Diagnostic[]): void;
}

export const name = 'ide-rpc';
export const inject = ['composition', 'server'];

export function apply(ctx: Context) {
  const clients = new Set<WebSocket>();

  /**
   * The last `game-diagnostics` frame this host has seen **from each
   * source** (see `GameDiagnosticsSource`) — so a client that connects (or
   * reconnects) AFTER the fact still learns about it, instead of seeing
   * nothing until the NEXT thing happens to report. `Snapshot` already
   * gets this treatment (recomputed fresh and sent to every new connection
   * below); this is `game-diagnostics`'s own missing half of the same
   * symmetry.
   *
   * Three decisions this makes on purpose, not by accident:
   *
   *  1. **One retained frame PER SOURCE — two of them, not one, and not
   *     one per socket.** It was one, and that was wrong: this host is
   *     itself a second speaker (`reportGameDiagnostics`, for
   *     `/api/spin`), and a host frame carrying only its own failure
   *     replaced everything the game had reported — for a reader that
   *     replaces on receipt, terminally, since nothing makes the game
   *     speak again afterwards. Keyed by source rather than by socket
   *     because in this dev model there is exactly one project being
   *     edited (`e8 dev` serves one), so more than one connected GAME
   *     socket overwhelmingly means more than one VIEW of the same game
   *     (the preview iframe alongside a directly opened tab), not two
   *     different games — the same assumption `ctx.composition.snapshot()`
   *     already makes for the ONE `Snapshot` every client shares. Those
   *     views share the `game` slot and the most recent wins. A key per
   *     socket would also grow without bound across page reloads, and
   *     would show one game's list N times.
   *  2. **The source is decided HERE, from where the frame entered** — a
   *     frame off an `/ide` socket is `game`, a frame this host originates
   *     is `host` — never read off the frame. See
   *     `GameDiagnosticsSource`'s own doc.
   *  3. **Never cleared when a source goes away.** A game going quiet
   *     because it crashed is exactly the case this exists for — the
   *     failure that caused the disconnect is the single most important
   *     thing for a client connecting afterwards to learn, and clearing it
   *     at the moment of disconnect would erase it at the worst possible
   *     time. Unchanged from when there was one retained frame, and it has
   *     to stay unchanged for both sources or the rule would depend on
   *     which speaker happened to fall silent. The cost is real and named,
   *     not ignored: a newly connected client can be handed a frame
   *     describing a game that is no longer running. Between "may describe
   *     a game that has since gone" and "silently drops a real failure
   *     because a socket dropped", this picks the first — the same lean §8
   *     and this whole slice already take everywhere else (a stale-but-
   *     true fact beats a silently withheld one). Bounded by decision 1:
   *     there are two slots, so this cannot accumulate.
   */
  const lastGameDiagnostics = new Map<
    GameDiagnosticsSource,
    { diagnostics: Diagnostic[]; dropped: number }
  >();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const broadcast = async () => {
    if (!clients.size) return;
    const snapshot = await ctx.composition.snapshot();
    for (const socket of clients) send(socket, { type: 'snapshot', snapshot });
  };

  /**
   * What the HOST itself has found wrong with the running game, kept whole
   * — see `IdeRpcService.reportGameDiagnostics`. The same service a game's
   * own `ctx.diagnostics` is, composed by nobody: it has no cordis
   * dependency for exactly this reason.
   */
  const hostDiagnostics = createDiagnostics();

  ctx.provide('ideRpc', {
    reportGameDiagnostics(diagnostics) {
      for (const d of diagnostics) hostDiagnostics.report(d);
      const frame = {
        diagnostics: [...hostDiagnostics.list()],
        dropped: hostDiagnostics.dropped(),
      };
      lastGameDiagnostics.set('host', frame);
      const message: ServerMessage = { type: 'game-diagnostics', ...frame, source: 'host' };
      for (const socket of clients) send(socket, message);
    },
  });

  ctx.server.ws('/ide', async (_req, accept) => {
    const socket = await accept();
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));

    socket.on('message', async (data) => {
      let message: ClientMessage;
      try {
        const parsed: unknown = JSON.parse(String(data));
        // Malformed frames are ignored, not just unparsable ones — `null`,
        // an array, or a primitive all pass JSON.parse but would throw on
        // `.type` below (outside this catch, since parsing itself
        // succeeded), turning one bad frame from the browser into an
        // unhandled rejection instead of a no-op.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const type = (parsed as { type?: unknown }).type;
        if (type !== 'update' && type !== 'game-diagnostics') return;
        message = parsed as ClientMessage;
      } catch {
        return; // malformed frames are ignored; the browser is ours
      }

      if (message.type === 'game-diagnostics') {
        // A running game reporting its own trouble (`ide-bridge`, Task 5) —
        // passed on to every OTHER connected socket (the editor), never
        // echoed back to the game that sent it: the game already has this
        // list, and it is never fed through `ctx.composition.update()` or
        // re-labelled `{type:'diagnostics'}` — those two namespaces stay
        // apart the same way `Diagnostic.plugin`'s own doc keeps them
        // apart (see contracts' `protocol.ts`).
        //
        // Recorded before the relay loop, unconditionally — see
        // `lastGameDiagnostics`'s own doc for why this is retained rather
        // than only forwarded live.
        //
        // Stamped `source: 'game'` on the way out rather than passed
        // through untouched: the frame that arrived is a `ClientMessage`,
        // which carries no source at all, and what leaves here is a
        // `ServerMessage`, which must. The stamp is this host's own
        // knowledge of where the frame entered — see
        // `GameDiagnosticsSource`.
        lastGameDiagnostics.set('game', {
          diagnostics: message.diagnostics,
          dropped: message.dropped,
        });
        const relayed: ServerMessage = {
          type: 'game-diagnostics',
          diagnostics: message.diagnostics,
          dropped: message.dropped,
          source: 'game',
        };
        for (const other of clients) {
          if (other !== socket) send(other, relayed);
        }
        return;
      }

      const diagnostics = await ctx.composition.update(message.id, message.config);
      if (diagnostics.length) {
        send(socket, { type: 'diagnostics', diagnostics });
      } else {
        await broadcast();
      }
    });

    send(socket, { type: 'snapshot', snapshot: await ctx.composition.snapshot() });
    // A client that (re)connects after a game already reported trouble
    // must not see "nothing has ever gone wrong" just because it wasn't
    // listening at the time — see `lastGameDiagnostics`'s own doc. Sent
    // whole, after the snapshot, the same "always the current picture, in
    // the same place" treatment `Snapshot` above already gets.
    //
    // ONE FRAME PER SOURCE, in `GAME_DIAGNOSTIC_SOURCES` order. A source
    // that has never spoken is skipped entirely rather than sent as an empty
    // frame — "nothing has been reported" is not "an empty report", and the
    // client already renders the first correctly on its own
    // (`GameDiagnosticsState.diagnostics` starts `null`).
    for (const source of GAME_DIAGNOSTIC_SOURCES) {
      const retained = lastGameDiagnostics.get(source);
      if (!retained) continue;
      send(socket, {
        type: 'game-diagnostics',
        diagnostics: retained.diagnostics,
        dropped: retained.dropped,
        source,
      });
    }
  });

  // The graph is the source of truth: whenever it moves, the browser hears about it.
  ctx.on('internal/status', () => void broadcast());
  ctx.on('loader/config-update', () => void broadcast());
}
