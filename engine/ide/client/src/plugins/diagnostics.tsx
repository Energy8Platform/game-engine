import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import type { ConnectionConfig, WebSocketLike } from './connection';

/**
 * The client-side store for a GAME's own diagnostics — the far end of the
 * road tasks 1-6 built: a running game's `ctx.diagnostics` forwarded by
 * `ide-bridge`, relayed by the host to every OTHER connected socket as
 * `{type:'game-diagnostics', diagnostics, dropped}`.
 *
 * Shaped after `connection.ts`: a service with `subscribe(listener)`, a
 * socket owned and parsed the same defensive way (a `WebSocketLike` seam,
 * a default `new WebSocket(url)` factory, JSON.parse guarded against a
 * malformed frame throwing outside its own `try`). It is its own plugin
 * with its OWN socket, not a read of `connection.ts`'s internals, for the
 * reason `protocol.ts`'s own doc on `GameDiagnosticsMessage` gives: that
 * module's message handler already filters strictly to
 * `snapshot`/`diagnostics` and drops anything else by design — reaching
 * into its closure to widen that filter would blur the one guarantee the
 * protocol makes a reader: the message TYPE, never `Diagnostic.plugin`, is
 * what tells a project diagnostic from a game diagnostic apart. Two
 * independent listeners, each trusting only its own frame type, keep that
 * mechanical instead of relying on a sibling plugin to forward it right.
 * (`ide-bridge`'s browser half already opens its own second socket to the
 * same `/ide` endpoint for the same kind of reason — an independent
 * concern, independently wired — so this is not a new idiom for this
 * codebase, just the client-side mirror of it.)
 *
 * Kept entirely separate from `ConnectionService.diagnostics`: that array
 * is namespace 1 of `Diagnostic.plugin` (composition row ids); what lands
 * here is namespace 2 (a live game's own seam/mechanic ids) — see
 * `Diagnostic.plugin`'s own doc for why resolving the two against the same
 * rows would be wrong. This module does no resolution at all — it only
 * stores what arrived; the panel that reads it (`DiagnosticsPanel`) is
 * where the two namespaces are finally allowed to sit on one screen,
 * marked by which array they came from.
 */
declare module 'cordis' {
  interface Context {
    gameDiagnostics: GameDiagnosticsService;
  }
}

export interface GameDiagnosticsState {
  /** What the game has reported. Null until the first frame arrives — absent is not empty. */
  readonly diagnostics: readonly Diagnostic[] | null;
  /** How many the game's bounded log forgot. The panel must be able to say so. */
  readonly dropped: number;
}

export interface GameDiagnosticsService extends GameDiagnosticsState {
  subscribe(listener: () => void): () => void;
}

/** Identical shape to `connection.ts`'s own config — this plugin dials the same `/ide` endpoint, just for a different frame type. */
export type GameDiagnosticsConfig = ConnectionConfig;

export const name = 'game-diagnostics';

export function apply(ctx: Context, config: GameDiagnosticsConfig) {
  const listeners = new Set<() => void>();
  const socket = (config.socketFactory ?? ((url) => new WebSocket(url) as WebSocketLike))(
    config.url,
  );

  let diagnostics: Diagnostic[] | null = null;
  let dropped = 0;

  const service: GameDiagnosticsService = {
    get diagnostics() {
      return diagnostics;
    },
    get dropped() {
      return dropped;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  socket.addEventListener('message', (event: { data: string }) => {
    let message: { diagnostics: Diagnostic[]; dropped?: number };
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Malformed frames are ignored, not just unparsable ones — `null`, an
      // array, or a primitive all pass JSON.parse but would throw on
      // `.type` below, outside this catch, since parsing itself succeeded.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      // The type tag is the ONLY thing read here to recognise a frame —
      // never `plugin`. A `{type:'diagnostics'}` frame (the project's own,
      // equally well-formed) must still be ignored: see the module doc.
      if ((parsed as { type?: unknown }).type !== 'game-diagnostics') return;
      message = parsed as { diagnostics: Diagnostic[]; dropped?: number };
    } catch {
      return;
    }
    diagnostics = message.diagnostics;
    // Not required to be present at runtime by anything that actually
    // checks it — matching `isServerMessage`'s own deliberate looseness —
    // so a frame missing it degrades to "nothing forgotten" rather than
    // `NaN`/`undefined` reaching the panel.
    dropped = message.dropped ?? 0;
    for (const listener of listeners) listener();
  });

  ctx.effect(() => () => socket.close(), 'game-diagnostics-socket');
  ctx.provide('gameDiagnostics', service);
}

/** Subscribe a component to the game's own diagnostics. */
export function useGameDiagnostics(ctx: Context): GameDiagnosticsState {
  const read = (): GameDiagnosticsState => ({
    diagnostics: ctx.gameDiagnostics.diagnostics,
    dropped: ctx.gameDiagnostics.dropped,
  });
  const [state, setState] = useState<GameDiagnosticsState>(read);
  useEffect(() => {
    setState(read());
    return ctx.gameDiagnostics.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
