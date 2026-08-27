import type { Context } from 'cordis';
import { type ClientMessage, type Diagnostic, diagnostic, type ServerMessage, type Snapshot } from '@energy8engine/contracts';

/**
 * The slice of WebSocket we use — so tests can hand us a fake.
 *
 * `readyState` matches the WHATWG-standardised numeric values a real
 * `WebSocket` exposes (`CONNECTING=0`, `OPEN=1`, `CLOSING=2`, `CLOSED=3`) —
 * `update()` below checks it against `1` before sending, the same guard
 * the host's own `rpc.ts` applies before every `socket.send(...)`.
 */
export interface WebSocketLike {
  readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
}

const WEBSOCKET_OPEN = 1;

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
      // A real WebSocket throws InvalidStateError synchronously out of
      // send() when it isn't OPEN yet (still CONNECTING) — or, past that,
      // once it's CLOSING/CLOSED. update() must never throw: it's called
      // directly from UI code (a React input handler in a later task) that
      // has no way to know a try/catch is required here. Instead, failure
      // becomes data in the same place every other failure already lands —
      // connection.diagnostics — so the composition screen that already
      // renders that array shows "not connected" without new plumbing.
      //
      // Queuing the edit for replay on reconnect was considered and
      // rejected: the host is the source of truth, and the snapshot that
      // arrives on reconnect could already contradict a queued edit made
      // against stale state. Dropping it silently was rejected too — the
      // user acted and nothing would show for it.
      if (socket.readyState !== WEBSOCKET_OPEN) {
        service.diagnostics = [
          ...service.diagnostics,
          diagnostic(
            'warning',
            id,
            'connection',
            'not connected to the host — the change was not sent',
            'wait for the connection to reopen, then try again',
          ),
        ];
        for (const listener of listeners) listener();
        return;
      }
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
