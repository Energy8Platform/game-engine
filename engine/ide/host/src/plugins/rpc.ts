import type { Context } from 'cordis';
import type { ClientMessage, Diagnostic, ServerMessage } from '@energy8engine/contracts';
import type { WebSocket } from 'ws';

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
   * Sends a `game-diagnostics` frame to every connected client. Unlike the
   * relay below, there is no "sender" socket to exclude — the host itself
   * is the origin, not a client passing something on.
   */
  broadcastGameDiagnostics(diagnostics: Diagnostic[], dropped?: number): void;
}

export const name = 'ide-rpc';
export const inject = ['composition', 'server'];

export function apply(ctx: Context) {
  const clients = new Set<WebSocket>();

  /**
   * The last `game-diagnostics` frame this host has seen, from EITHER
   * origin (a game's own `ide-bridge` relay below, or this host speaking
   * for itself via `broadcastGameDiagnostics`) — so a client that connects
   * (or reconnects) AFTER the fact still learns about it, instead of
   * seeing nothing until the NEXT thing happens to report. `Snapshot`
   * already gets this treatment (recomputed fresh and sent to every new
   * connection below); this is `game-diagnostics`'s own missing half of
   * the same symmetry.
   *
   * Two decisions this makes on purpose, not by accident:
   *
   *  1. **One retained frame, not one per game.** The protocol carries no
   *     game/session identity at all — `GameDiagnosticsMessage` is just
   *     `{diagnostics, dropped}` — so there is no key to keep several
   *     under even if this wanted to. In this dev model there is exactly
   *     one project being edited at a time (`e8 dev` serves one), so more
   *     than one connected GAME socket overwhelmingly means more than one
   *     VIEW of the same game (the preview iframe alongside a directly
   *     opened tab), not two different games — the same assumption
   *     `ctx.composition.snapshot()` already makes for the ONE `Snapshot`
   *     every client shares. Last-wins across whichever socket reported
   *     most recently is therefore the natural read of "the current
   *     picture", not an arbitrary tie-break.
   *  2. **Never cleared when the reporting socket disconnects.** A game
   *     going quiet because it crashed is exactly the case this exists
   *     for — the failure that caused the disconnect is the single most
   *     important thing for a client connecting afterwards to learn, and
   *     clearing it at the moment of disconnect would erase it at the
   *     worst possible time. The cost is real and named, not ignored: a
   *     newly connected client can be handed a frame describing a game
   *     that is no longer running. Between "may describe a game that has
   *     since gone" and "silently drops a real failure because a socket
   *     dropped", this picks the first — the same lean §8 and this whole
   *     slice already take everywhere else (a stale-but-true fact beats a
   *     silently withheld one).
   */
  let lastGameDiagnostics: { diagnostics: Diagnostic[]; dropped: number } | null = null;

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const broadcast = async () => {
    if (!clients.size) return;
    const snapshot = await ctx.composition.snapshot();
    for (const socket of clients) send(socket, { type: 'snapshot', snapshot });
  };

  ctx.provide('ideRpc', {
    broadcastGameDiagnostics(diagnostics, dropped = 0) {
      lastGameDiagnostics = { diagnostics, dropped };
      const message: ServerMessage = { type: 'game-diagnostics', diagnostics, dropped };
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
        lastGameDiagnostics = { diagnostics: message.diagnostics, dropped: message.dropped };
        for (const other of clients) {
          if (other !== socket) send(other, message);
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
    // the same place" treatment `Snapshot` above already gets. Omitted
    // entirely (not sent as an empty frame) when nothing has EVER been
    // reported in this host's lifetime — that is genuinely "no game has
    // reported anything yet", which the client already renders correctly
    // on its own (`GameDiagnosticsState.diagnostics` starts `null`).
    if (lastGameDiagnostics) {
      send(socket, {
        type: 'game-diagnostics',
        diagnostics: lastGameDiagnostics.diagnostics,
        dropped: lastGameDiagnostics.dropped,
      });
    }
  });

  // The graph is the source of truth: whenever it moves, the browser hears about it.
  ctx.on('internal/status', () => void broadcast());
  ctx.on('loader/config-update', () => void broadcast());
}
