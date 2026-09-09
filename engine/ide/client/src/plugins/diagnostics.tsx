import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import {
  GAME_DIAGNOSTIC_SOURCES,
  type Diagnostic,
  type GameDiagnosticsSource,
} from '@energy8engine/contracts';
import type { ConnectionConfig, WebSocketLike } from './connection';

/**
 * The client-side store for a GAME's own diagnostics — the far end of the
 * road tasks 1-6 built: a running game's `ctx.diagnostics` forwarded by
 * `ide-bridge`, relayed by the host to every OTHER connected socket as
 * `{type:'game-diagnostics', diagnostics, dropped, source, game}`. Two
 * speakers share that message type and each sends a whole list, so this
 * store keeps one list per source (see `GameDiagnosticsSource`) — and, one
 * axis finer, one list per GAME within the `game` speaker (see
 * `GameDiagnosticsGroup`), because the preview wall (a later task) can have
 * several games talking to the same host at once. Neither axis absorbs the
 * other: `byGame` below nests a per-source map INSIDE each game's own
 * entry, the same shape `rpc.ts`'s own retention took on the host side —
 * see that file's doc on `lastGameDiagnostics` for the identical rule
 * stated for the wire.
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

/**
 * One running game's whole list, kept apart from every other game's — the
 * per-game generalisation of what used to be this store's single flat
 * list. A game is a THIRD axis, finer than `source` and living only inside
 * the `game` speaker (see the module doc): the host is not a game and
 * never produces a group of its own — a `source: 'host'` frame carries no
 * `game` (see `GameDiagnosticsMessage.game`'s own doc) and lands in the
 * SAME group as the one unidentified game, `game: undefined`.
 */
export interface GameDiagnosticsGroup {
  /**
   * Which game. `undefined` when only one game ever spoke — the common
   * case, a project opened the ordinary way with no wall in play — and
   * also where a HOST frame's contribution lands, since the host has no
   * game identity of its own to be grouped by.
   */
  game: string | undefined;
  /**
   * This group's own list, concatenated in `GAME_DIAGNOSTIC_SOURCES` order
   * across whichever speakers have contributed to it — the game's own
   * account before the host's, exactly the order the flat list used before
   * there could be more than one game.
   */
  diagnostics: readonly Diagnostic[];
  /** How many this group's own bounded logs forgot, summed across its speakers. */
  dropped: number;
}

export interface GameDiagnosticsState {
  /**
   * Every game that has spoken, each kept apart from the others — see
   * `GameDiagnosticsGroup`.
   *
   * Null until the FIRST frame from ANY source arrives — absent is not
   * empty, the same distinction this field always made, now stated one
   * level up: a game with an empty `diagnostics` array (reported and has
   * nothing wrong) is a group that exists; no group having spoken yet is
   * `null`.
   */
  readonly groups: readonly GameDiagnosticsGroup[] | null;
  /** How many the bounded logs behind every group forgot, summed. The panel must be able to say so. */
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

  /**
   * One list per (game, source) pair — `bySource`, generalised one axis
   * outward. The inner map is unchanged from before this task: a frame
   * replaces THAT source's entry within its game and leaves every other
   * one alone, which is what makes a second speaker (the host) additive
   * rather than destructive within one game's group — see the module doc.
   * The outer key is `GameDiagnosticsMessage.game`, `undefined` included as
   * a legal key of its own (the anonymous game, and every host frame — see
   * `GameDiagnosticsGroup`'s own doc for why the two share a bucket).
   *
   * It was `bySource`, one level shallower, keyed by source alone — right
   * when at most one game could ever be talking to the host, wrong once
   * the wall could open several at once: a second game's frame landed in
   * the SAME `'game'` slot the first one used and silently replaced it,
   * the identical defect the source axis itself exists to prevent, one
   * level down. Reproduced directly against this store before this fix —
   * see task-5-context.md.
   *
   * Entries also LEAVE, on a `game-gone` frame. For a while the only
   * mutation here was a `set`, so a client connected while a wall tile was
   * open kept that tile's rows for the life of the page — rows naming a
   * game that had stopped running, which is a false statement about the
   * system, not a stale-but-true one. The host had already drawn that
   * distinction for its own retention (`rpc.ts`, decision 3) and had no
   * way to pass it on.
   */
  const byGame = new Map<
    string | undefined,
    Map<GameDiagnosticsSource, { diagnostics: Diagnostic[]; dropped: number }>
  >();

  const service: GameDiagnosticsService = {
    get groups() {
      if (byGame.size === 0) return null;
      return [...byGame].map(([game, bySource]) => ({
        game,
        diagnostics: GAME_DIAGNOSTIC_SOURCES.flatMap(
          (source) => bySource.get(source)?.diagnostics ?? [],
        ),
        dropped: GAME_DIAGNOSTIC_SOURCES.reduce(
          (total, source) => total + (bySource.get(source)?.dropped ?? 0),
          0,
        ),
      }));
    },
    get dropped() {
      let total = 0;
      for (const bySource of byGame.values()) {
        for (const entry of bySource.values()) total += entry.dropped;
      }
      return total;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  socket.addEventListener('message', (event: { data: string }) => {
    let message: {
      type: string;
      diagnostics: Diagnostic[];
      dropped?: number;
      source?: unknown;
      game?: unknown;
    };
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Malformed frames are ignored, not just unparsable ones — `null`, an
      // array, or a primitive all pass JSON.parse but would throw on
      // `.type` below, outside this catch, since parsing itself succeeded.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      // The type tag is the ONLY thing read here to recognise a frame —
      // never `plugin`. A `{type:'diagnostics'}` frame (the project's own,
      // equally well-formed) must still be ignored: see the module doc.
      const type = (parsed as { type?: unknown }).type;
      if (type !== 'game-diagnostics' && type !== 'game-gone') return;
      message = parsed as {
        type: string;
        diagnostics: Diagnostic[];
        dropped?: number;
        source?: unknown;
        game?: unknown;
      };
    } catch {
      return;
    }

    // A game the host has watched disconnect (see `GameGoneMessage`). Its
    // whole group goes — every speaker's contribution to it, the host's
    // included, since what the host had to say was said ABOUT that game.
    // Only a named one: `undefined` is the anonymous game's bucket, which
    // this frame never carries and which nothing releases, on either side
    // of the wire.
    //
    // Notified only when something actually went. A frame for a game this
    // client never heard from is not an error and not news — the host
    // broadcasts to every connected client, and only some of them were
    // listening when that tile spoke.
    if (message.type === 'game-gone') {
      if (typeof message.game !== 'string') return;
      if (!byGame.delete(message.game)) return;
      for (const listener of listeners) listener();
      return;
    }
    // An absent or unrecognised `source` reads as `game` — the meaning this
    // message had before the host became a second speaker, so an older host
    // (or a hand-written frame) lands in the slot it would have replaced
    // anyway rather than inventing a third bucket that nothing renders in
    // order. Same deliberate looseness as `isServerMessage`'s.
    const source: GameDiagnosticsSource =
      message.source === 'host' || message.source === 'game' ? message.source : 'game';
    // A host frame names no game — see `GameDiagnosticsGroup`'s own doc —
    // so it always joins the anonymous game's bucket rather than reading
    // whatever (nothing, in practice) it carries in `.game`. A `game`
    // frame's own id is trusted only when it is actually a string; anything
    // else (missing, or a malformed non-string) degrades to `undefined`,
    // the same looseness `dropped` below already gets.
    const game: string | undefined =
      source === 'host' ? undefined : typeof message.game === 'string' ? message.game : undefined;
    let bySource = byGame.get(game);
    if (!bySource) {
      bySource = new Map();
      byGame.set(game, bySource);
    }
    bySource.set(source, {
      diagnostics: message.diagnostics,
      // Not required to be present at runtime by anything that actually
      // checks it — matching `isServerMessage`'s own deliberate looseness —
      // so a frame missing it degrades to "nothing forgotten" rather than
      // `NaN`/`undefined` reaching the panel.
      dropped: message.dropped ?? 0,
    });
    for (const listener of listeners) listener();
  });

  ctx.effect(() => () => socket.close(), 'game-diagnostics-socket');
  ctx.provide('gameDiagnostics', service);
}

/** Subscribe a component to every game's own diagnostics. */
export function useGameDiagnostics(ctx: Context): GameDiagnosticsState {
  const read = (): GameDiagnosticsState => ({
    groups: ctx.gameDiagnostics.groups,
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
