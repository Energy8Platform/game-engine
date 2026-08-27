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

/** Structural equality for the fields that make two `Diagnostic`s the same failure. */
function diagnosticsEqual(a: Diagnostic, b: Diagnostic): boolean {
  return a.severity === b.severity && a.plugin === b.plugin && a.where === b.where && a.message === b.message && a.fix === b.fix;
}

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
      // update() must never throw: it's called directly from UI code (a
      // React input handler, later task) that has no way to know a
      // try/catch is required here. Instead, failure becomes data in the
      // same place every other failure already lands — connection.diagnostics
      // — so the composition screen that already renders that array shows
      // "not connected" without new plumbing. Both failure modes below feed
      // the same `reportSendFailure`, which keeps at most one `where:
      // 'connection'` diagnostic at a time: a range input's onChange can
      // fire tens of times a second while the socket is down, and without
      // collapsing, every one of those calls would both pile up an
      // identical diagnostic and re-notify every subscriber. A genuinely
      // different failure (a different reason, a different plugin) still
      // replaces the slot and still notifies — only true duplicates collapse.
      //
      // Queuing the edit for replay on reconnect was considered and
      // rejected: the host is the source of truth, and the snapshot that
      // arrives on reconnect could already contradict a queued edit made
      // against stale state. Dropping it silently was rejected too — the
      // user acted and nothing would show for it.
      if (socket.readyState !== WEBSOCKET_OPEN) {
        reportSendFailure(
          diagnostic(
            'error',
            id,
            'connection',
            'not connected to the host — the change was not sent',
            'wait for the connection to reopen, then try again',
          ),
        );
        return;
      }
      try {
        const message: ClientMessage = { type: 'update', id, config: next };
        // JSON.stringify throws synchronously for values it can't serialise
        // (a circular reference, a BigInt) regardless of readyState, and a
        // non-conformant WebSocketLike could throw out of send() even while
        // reporting OPEN — both are send failures from the caller's point
        // of view, so both are caught here rather than only the case this
        // fix started from.
        socket.send(JSON.stringify(message));
      } catch (error) {
        reportSendFailure(
          diagnostic(
            'error',
            id,
            'connection',
            `could not send the change: ${error instanceof Error ? error.message : String(error)}`,
            'check the value and try again',
          ),
        );
      }
    },
  };

  /**
   * Records a failed `update()` as a `where: 'connection'` diagnostic,
   * replacing any earlier one there instead of appending — so repeated
   * identical failures (the drag-a-knob case) collapse into a single entry
   * with a single notification, while a genuinely different failure still
   * replaces it and still notifies.
   */
  function reportSendFailure(next: Diagnostic) {
    const existing = service.diagnostics.find((d) => d.where === 'connection');
    if (existing && diagnosticsEqual(existing, next)) return;
    service.diagnostics = [...service.diagnostics.filter((d) => d.where !== 'connection'), next];
    for (const listener of listeners) listener();
  }

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
