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
  });

  // The graph is the source of truth: whenever it moves, the browser hears about it.
  ctx.on('internal/status', () => void broadcast());
  ctx.on('loader/config-update', () => void broadcast());
}
