import type { Context } from 'cordis';
import type { ClientMessage, ServerMessage } from '@energy8engine/contracts';
import type { WebSocket } from 'ws';

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
        if ((parsed as { type?: unknown }).type !== 'update') return;
        message = parsed as ClientMessage;
      } catch {
        return; // malformed frames are ignored; the browser is ours
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
