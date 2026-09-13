import type { Context } from 'cordis';
import type { Server, WsRoute } from '@cordisjs/plugin-server';
import type { WebSocket } from 'ws';
import {
  GAME_DIAGNOSTIC_SOURCES,
  diagnostic,
  type ClientMessage,
  type Diagnostic,
  type GameDiagnosticsSource,
  type ServerMessage,
  type Snapshot,
  type WorkspaceState,
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
  /** Tells every client which projects exist and which is open — also the FIRST frame on connect. */
  broadcastWorkspace(state: WorkspaceState): void;
  /** Registers the `/ide` websocket route on `server` — the root's by default; the preview's too (Task 4). */
  attach(server: Server): void;
}

export const name = 'ide-rpc';
/**
 * `server` only: `rpc` lives on the ROOT and outlives every project, so the
 * active project's `composition` is read at call time (`compositionOf`
 * below), never injected — a root with no project open must still answer.
 */
export const inject = ['server'];

export function apply(ctx: Context) {
  const clients = new Set<WebSocket>();

  /** One source's, or one GAME's, whole reported list, as retained. */
  type RetainedFrame = { diagnostics: Diagnostic[]; dropped: number };

  /**
   * The last `game-diagnostics` frame this host has seen **from each
   * GAME** (see `GameDiagnosticsMessage.game`) — so a client that connects
   * (or reconnects) AFTER the fact still learns about it, instead of
   * seeing nothing until the NEXT thing happens to report. `Snapshot`
   * already gets this treatment (recomputed fresh and sent to every new
   * connection below); this is `game-diagnostics`'s own missing half of
   * the same symmetry.
   *
   * The HOST's own frames live apart from this map entirely, in
   * `lastHostDiagnostics` below, never as an entry here — `source` (which
   * SPEAKER) and `game` (which GAME, a finer axis living only inside the
   * `game` speaker) do not collapse into one key. See
   * `GAME_DIAGNOSTIC_SOURCES`'s own doc for that rule stated for `source`
   * itself.
   *
   * Three decisions this makes on purpose, not by accident:
   *
   *  1. **One retained frame per GAME, keyed by `GameDiagnosticsMessage.
   *     game` — `undefined` included, as a legal key of its own.** This
   *     was one retained frame for the WHOLE `game` speaker, full stop,
   *     because more than one connected GAME socket overwhelmingly meant
   *     more than one VIEW of the same game in this dev model (`e8 dev`
   *     serves one project) — the preview iframe alongside a directly
   *     opened tab, not two different games. That is still exactly right
   *     for a socket that names no game: every such socket shares the one
   *     `undefined` key, most-recent-wins, unchanged. It stopped being
   *     right the moment a socket COULD name itself: the preview wall (a
   *     later task) opens several tiles against this one host at once,
   *     each its own socket, each its own `game` id, and the old single
   *     slot let the second tile's whole-list frame silently erase the
   *     first's — measured directly against this file before this fix,
   *     two sockets reporting as `a` and `b` left a later client told only
   *     about `b`. A socket that DOES send an id is trusted at its word
   *     and gets a slot of its own, because that id is the one thing that
   *     tells two tiles apart at all.
   *  2. **The source is decided HERE, from where the frame entered — never
   *     read off the frame.** Unchanged, and still about `source` only:
   *     `game` is the opposite, carried through exactly as the sender
   *     wrote it, never inferred — the host can tell its own process from
   *     a socket, but it cannot verify what a browser page claims to be
   *     running. See `GameDiagnosticsMessage.game`'s own doc.
   *  3. **Cleared on disconnect — but only a NAMED entry, and only by the
   *     socket that currently owns it.** This used to never clear at all,
   *     for the one speaker that had a retained slot, because a game going
   *     quiet BECAUSE it crashed is exactly the case retention exists for,
   *     and clearing at the moment of disconnect would erase the failure
   *     at the worst possible time. That argument is untouched for the
   *     `undefined` key (still shared, still never cleared — the one
   *     project `e8 dev` serves crashing is still worth remembering after
   *     its socket drops) and for the host (see `lastHostDiagnostics`,
   *     which has no disconnect to clear on at all). It does NOT survive
   *     for a named game, because the reasoning that made "never clear"
   *     SAFE does not survive either: that reasoning was "there are two
   *     slots, full stop" (the old version of decision 1, above), and a
   *     key the wall can mint without limit breaks it completely — an
   *     entry per tile ever opened, kept for the life of the host process,
   *     is a leak, not a stale-but-true fact held a while longer. So a
   *     named entry is deleted when the socket that owns it closes
   *     (`gameSocket` below is the ownership record that makes "the socket
   *     that owns it" answerable, since a `Diagnostic[]` says nothing
   *     about who sent it) — and THAT release-on-close rule is what bounds
   *     this map now, not decision 1's old count of two. Not "one entry
   *     per open socket": one socket that names several different ids over
   *     its life holds that many entries until IT closes (see
   *     `gameSocket`'s own doc) — the actual guarantee is narrower, "no
   *     entry outlives the socket that claimed it", which is not a hard
   *     cap on how many can exist at any one instant. It is the wall's own
   *     discipline of closing a tile's socket when the tile closes that
   *     keeps this map from becoming a growing history of every id the
   *     host has ever seen.
   */
  const lastGameDiagnostics = new Map<string | undefined, RetainedFrame>();

  /**
   * Which socket currently claims to BE a given named game — the
   * ownership record decision 3 above needs and `lastGameDiagnostics`
   * cannot hold by itself, since a `Diagnostic[]` says nothing about which
   * socket sent it. Only ever keyed by a DEFINED game id; the anonymous
   * slot has no owner to track because nothing ever needs to take its
   * entry back (see decision 3).
   *
   * Updated on every frame that names a game, not only the first, so a
   * fresher connection reporting under the same id displaces an older one
   * as that id's owner. Without this, a stale tile's `close` racing a
   * reconnect — an old socket that had not yet noticed it was gone —
   * could delete a NEWER socket's still-live entry out from under it.
   *
   * The other edge this resolves: one socket naming two different games
   * over its life. Nothing here forbids it — both ids simply end up
   * pointing at this one socket, and its eventual `close` releases both.
   * The alternative, picking a single id as "the" winner for that socket,
   * would have to silently prefer one over the other with nothing to show
   * for the choice — the exact shape of defect this whole slice exists to
   * end.
   */
  const gameSocket = new Map<string, WebSocket>();

  /**
   * The host's own last frame — see `IdeRpcService.reportGameDiagnostics`.
   * Exactly one slot, never a map keyed by anything: the host is one
   * speaker with no game of its own to further key by
   * (`GameDiagnosticsMessage.game` is always absent on a host frame — see
   * that field's own doc). Never cleared, unlike a named game's entry:
   * this plugin IS the host process, so there is no "the host
   * disconnected" event to clear it on.
   */
  let lastHostDiagnostics: RetainedFrame | null = null;

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  /** The active project's composition, or `null` between projects. Read at call time — the root has none. */
  const compositionOf = () => ctx.get('composition') ?? null;
  const emptySnapshot = (): Snapshot => ({ rows: [], diagnostics: [] });
  const currentSnapshot = async (): Promise<Snapshot> =>
    (await compositionOf()?.snapshot()) ?? emptySnapshot();

  const broadcast = async () => {
    if (!clients.size) return;
    const snapshot = await currentSnapshot();
    for (const socket of clients) send(socket, { type: 'snapshot', snapshot });
  };

  /** What a client is told about the workspace: the last state broadcast, until `workspace` says otherwise. */
  let lastWorkspace: WorkspaceState = {
    projects: [],
    active: null,
    previewUrl: null,
    diagnostics: [],
  };

  /**
   * What a newly connecting client is told about ONE speaker — see
   * `lastGameDiagnostics`'s own doc for why the two speakers' retained
   * shapes differ (a game can be several; the host can only ever be one).
   * `GAME_DIAGNOSTIC_SOURCES` below still governs the SPEAKER order (the
   * game's own account before the host's); which of several games comes
   * first within that is not a promise this protocol makes — the client
   * groups by `game` and does not rely on wire order to do it.
   */
  const retainedFrames = (source: GameDiagnosticsSource): (RetainedFrame & { game?: string })[] => {
    if (source === 'host') return lastHostDiagnostics ? [{ ...lastHostDiagnostics }] : [];
    return [...lastGameDiagnostics].map(([game, frame]) => ({ ...frame, game }));
  };

  /**
   * What the HOST itself has found wrong with the running game, kept whole
   * — see `IdeRpcService.reportGameDiagnostics`. The same service a game's
   * own `ctx.diagnostics` is, composed by nobody: it has no cordis
   * dependency for exactly this reason.
   */
  const hostDiagnostics = createDiagnostics();

  const service: IdeRpcService = {
    reportGameDiagnostics(diagnostics) {
      for (const d of diagnostics) hostDiagnostics.report(d);
      const frame = {
        diagnostics: [...hostDiagnostics.list()],
        dropped: hostDiagnostics.dropped(),
      };
      lastHostDiagnostics = frame;
      const message: ServerMessage = { type: 'game-diagnostics', ...frame, source: 'host' };
      for (const socket of clients) send(socket, message);
    },
    broadcastWorkspace(state) {
      lastWorkspace = state;
      for (const socket of clients) send(socket, { type: 'workspace', workspace: state });
    },
    attach(server) {
      server.ws('/ide', handler);
    },
  };
  ctx.provide('ideRpc', service);

  const handler: NonNullable<WsRoute['handle']> = async (_req, accept) => {
    const socket = await accept();
    clients.add(socket);
    socket.on('close', () => {
      clients.delete(socket);
      // Release whatever named game(s) this socket owned — see
      // `gameSocket`'s own doc for why "whatever it owned" can be more
      // than one id, and why OWNERSHIP (not merely "this socket once sent
      // this id") is what decides whether an entry actually goes: a
      // socket that lost its claim to a fresher reconnect before it closed
      // must not delete the entry that fresher socket now owns.
      for (const [game, owner] of gameSocket) {
        if (owner !== socket) continue;
        gameSocket.delete(game);
        lastGameDiagnostics.delete(game);
        // Say so, rather than only forgetting. Releasing the entry fixes
        // what a LATER client is told; every client already connected
        // holds its own copy of this game's list and has no other way to
        // learn the game is gone — so it would keep showing a tile's rows,
        // under that tile's name, for the life of the page. `clients` no
        // longer holds this socket (deleted above), so this reaches
        // exactly the readers that need it.
        const gone: ServerMessage = { type: 'game-gone', game };
        for (const other of clients) send(other, gone);
      }
    });

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
        // Recorded before the relay loop, unconditionally, keyed by WHICH
        // GAME rather than by source — see `lastGameDiagnostics`'s own doc
        // for why this is retained at all, and for decision 1 on why the
        // key is `message.game` now. `gameSocket` learns this socket's
        // claim in the same breath, for decision 3's cleanup on close.
        //
        // Stamped `source: 'game'` on the way out rather than passed
        // through untouched: the frame that arrived is a `ClientMessage`,
        // which carries no source at all, and what leaves here is a
        // `ServerMessage`, which must. The stamp is this host's own
        // knowledge of where the frame entered — see
        // `GameDiagnosticsSource`. `game`, unlike `source`, needs no such
        // stamp: it already arrived exactly as the sender wrote it, and is
        // passed on unchanged.
        lastGameDiagnostics.set(message.game, {
          diagnostics: message.diagnostics,
          dropped: message.dropped,
        });
        if (message.game !== undefined) gameSocket.set(message.game, socket);
        const relayed: ServerMessage = {
          type: 'game-diagnostics',
          diagnostics: message.diagnostics,
          dropped: message.dropped,
          source: 'game',
          game: message.game,
        };
        for (const other of clients) {
          if (other !== socket) send(other, relayed);
        }
        return;
      }

      const composition = compositionOf();
      const diagnostics = composition
        ? await composition.update(message.id, message.config)
        : [
            diagnostic(
              'error',
              'ide-rpc',
              message.id,
              'no project is open',
              'open a project first',
            ),
          ];
      if (diagnostics.length) {
        send(socket, { type: 'diagnostics', diagnostics });
      } else {
        await broadcast();
      }
    });

    // Workspace first, then the snapshot (spec §9): a client learns WHICH
    // project the rows belong to before it sees any rows.
    send(socket, { type: 'workspace', workspace: lastWorkspace });
    send(socket, { type: 'snapshot', snapshot: await currentSnapshot() });
    // A client that (re)connects after a game already reported trouble
    // must not see "nothing has ever gone wrong" just because it wasn't
    // listening at the time — see `lastGameDiagnostics`'s own doc. Sent
    // whole, after the snapshot, the same "always the current picture, in
    // the same place" treatment `Snapshot` above already gets.
    //
    // SPEAKER-major order, in `GAME_DIAGNOSTIC_SOURCES`: the game's own
    // account (one frame per game that has spoken, in no particular order
    // among themselves — nothing here promises which tile comes first)
    // before the host's single frame. A speaker, or a game, that has never
    // spoken is skipped entirely rather than sent as an empty frame —
    // "nothing has been reported" is not "an empty report", and the client
    // already renders the first correctly on its own
    // (`GameDiagnosticsState.diagnostics` starts `null`).
    for (const source of GAME_DIAGNOSTIC_SOURCES) {
      for (const frame of retainedFrames(source)) {
        send(socket, {
          type: 'game-diagnostics',
          diagnostics: frame.diagnostics,
          dropped: frame.dropped,
          source,
          game: frame.game,
        });
      }
    }
  };
  service.attach(ctx.server);

  // The graph is the source of truth: whenever it moves, the browser hears about it.
  ctx.on('internal/status', () => void broadcast());
  ctx.on('loader/config-update', () => void broadcast());
  // A project switch is a new graph (or none): the browser sees the new
  // rows, or an empty snapshot, without waiting for the graph to move.
  ctx.on('workspace/changed', (state) => {
    service.broadcastWorkspace(state);
    void broadcast();
  });
}
