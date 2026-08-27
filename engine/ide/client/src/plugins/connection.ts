import type { Context } from 'cordis';
import type { ClientMessage, Diagnostic, ServerMessage, Snapshot } from '@energy8engine/contracts';

/** The slice of WebSocket we use — so tests can hand us a fake. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
}

declare module 'cordis' {
  interface Context {
    connection: ConnectionService;
  }
}

export interface ConnectionService {
  snapshot: Snapshot | null;
  diagnostics: Diagnostic[];
  subscribe(listener: () => void): () => void;
  update(id: string, config: unknown): void;
}

export interface ConnectionConfig {
  url: string;
  socketFactory?: (url: string) => WebSocketLike;
}

export const name = 'connection';

export function apply(ctx: Context, config: ConnectionConfig) {
  const listeners = new Set<() => void>();
  const socket = (config.socketFactory ?? ((url) => new WebSocket(url) as WebSocketLike))(config.url);

  const service: ConnectionService = {
    snapshot: null,
    diagnostics: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(id, next) {
      const message: ClientMessage = { type: 'update', id, config: next };
      socket.send(JSON.stringify(message));
    },
  };

  socket.addEventListener('message', (event: { data: string }) => {
    let message: ServerMessage;
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Malformed frames are ignored, not just unparsable ones — `null`, an
      // array, or a primitive all pass JSON.parse but would throw on
      // `.type` below (outside this catch, since parsing itself succeeded),
      // turning one bad frame from the host into an unhandled exception
      // inside a socket event handler nothing here can catch.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      if ((parsed as { type?: unknown }).type !== 'snapshot' && (parsed as { type?: unknown }).type !== 'diagnostics') {
        return;
      }
      message = parsed as ServerMessage;
    } catch {
      return;
    }
    if (message.type === 'snapshot') {
      service.snapshot = message.snapshot;
      service.diagnostics = message.snapshot.diagnostics;
    } else {
      service.diagnostics = message.diagnostics;
    }
    for (const listener of listeners) listener();
  });

  ctx.effect(() => () => socket.close(), 'ide-socket');
  ctx.provide('connection', service);
}
