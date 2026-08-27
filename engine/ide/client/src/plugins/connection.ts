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
  /**
   * Host-authored diagnostics (from the latest `snapshot`/`diagnostics`
   * message) concatenated with client-authored ones (from `report()`).
   * The two have different provenance and different lifetimes — see
   * `report()`'s doc comment — but this property hides the split so every
   * existing reader (the composition screen, these tests) keeps working
   * against one flat array.
   */
  diagnostics: Diagnostic[];
  subscribe(listener: () => void): () => void;
  update(id: string, config: unknown): void;
  /**
   * Record a *client*-authored diagnostic and notify subscribers — the
   * public counterpart of `update()`'s own internal send-failure path, for
   * any other plugin (`modules`, so far) that needs to surface a failure
   * through the same array the composition screen already renders. Reuses
   * the identity-based dedupe below: an identical repeat (same `plugin` +
   * `where` + `message`) replaces the earlier entry instead of appending a
   * duplicate, while a distinct failure — a different row, or a different
   * reason for the same row — stays alongside it. Assigning `diagnostics`
   * directly instead of calling this was considered and rejected: it writes
   * the field without notifying subscribers, so nothing reacts to it.
   *
   * Diagnostics reported here survive the next host `snapshot`/`diagnostics`
   * message — see the split between host- and client-authored diagnostics
   * on `diagnostics` below for why.
   */
  report(diagnostic: Diagnostic): void;
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

  // Two sources, two lifetimes. Host-authored diagnostics (a `snapshot` or
  // `diagnostics` server message) are wholesale-replaced by the next
  // message — the host is describing the current state of the world, and a
  // message that omits a formerly-reported diagnostic means the host
  // considers it resolved. Client-authored diagnostics (`report()`, below)
  // describe something wrong in *this* browser tab — a send failure, or
  // (since Task 10) a broken plugin client half — that has nothing to do
  // with whatever the host just pushed, and must survive an unrelated
  // snapshot arriving. A single shared array was tried first and rejected:
  // the socket handler's wholesale replace on every message would wipe a
  // still-unresolved client-authored diagnostic the moment the developer
  // touched an unrelated composition row, with nothing left to explain why
  // a plugin stayed broken.
  let hostDiagnostics: Diagnostic[] = [];
  let clientDiagnostics: Diagnostic[] = [];

  const service: ConnectionService = {
    snapshot: null,
    get diagnostics() {
      return [...hostDiagnostics, ...clientDiagnostics];
    },
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
      // the same `service.report`, which collapses repeats of the exact
      // same failure (a range input's onChange can fire tens of times a
      // second while the socket is down) into one diagnostic and one
      // notification, while keeping distinct failures — a different row, or
      // a different reason for the same row — as separate entries. See
      // `service.report`'s own comment for why identity, not just
      // `where`, is the dedupe key.
      //
      // Queuing the edit for replay on reconnect was considered and
      // rejected: the host is the source of truth, and the snapshot that
      // arrives on reconnect could already contradict a queued edit made
      // against stale state. Dropping it silently was rejected too — the
      // user acted and nothing would show for it.
      if (socket.readyState !== WEBSOCKET_OPEN) {
        service.report(
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
        service.report(
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
    /**
     * Records a diagnostic, replacing any earlier diagnostic with the same
     * *identity* — `plugin` + `where` + `message` — instead of appending, so
     * repeated identical failures (the drag-a-knob case, or a `modules`
     * import that fails the same way on every retry) collapse into a single
     * entry with a single notification. Keying on `where === 'connection'`
     * alone was tried first and rejected: it collapsed unrelated failures
     * too — row A's stale diagnostic would be silently discarded the moment
     * row B failed, and a `JSON.stringify` failure would erase a
     * not-connected failure (or vice versa) for the same row, even though
     * neither condition had actually resolved. Keying on identity means
     * only a byte-identical repeat collapses; a different row or a
     * different failure reason for the same row stands alongside.
     */
    report(next) {
      const sameIdentity = (d: Diagnostic) => d.plugin === next.plugin && d.where === next.where && d.message === next.message;
      const existing = clientDiagnostics.find(sameIdentity);
      if (existing && diagnosticsEqual(existing, next)) return;
      clientDiagnostics = [...clientDiagnostics.filter((d) => !sameIdentity(d)), next];
      for (const listener of listeners) listener();
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
      hostDiagnostics = message.snapshot.diagnostics;
    } else {
      hostDiagnostics = message.diagnostics;
    }
    for (const listener of listeners) listener();
  });

  ctx.effect(() => () => socket.close(), 'ide-socket');
  ctx.provide('connection', service);
}
