import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type DiagnosticsResponse,
  type GameCompositionMessage,
  type GameCompositionResponse,
  type GameCompositionRow,
  type GameTransitionsMessage,
} from '@energy8engine/contracts';
import type { ConnectionConfig, WebSocketLike } from './connection';

/**
 * The feeder for the GAME half of the composition screen.
 *
 * `CompositionScreen` has rendered `ResolvedRow`s — with the layer that
 * placed each one — since Task 10, but only ever from a `rows` prop a
 * test passed it: nothing in the running IDE fetched the composition, so
 * that whole half of the screen was unreachable from the app a person
 * actually opens (found by the acceptance test, see task-11-report.md).
 * This plugin closes that: one `GET /api/composition` — the route
 * `runtime-assets.ts` already serves and `apps/web/vite.config.ts`
 * already proxies — parked on a service the screen subscribes to.
 *
 * Shaped after `connection.ts` and `slots.ts` rather than as a second
 * pattern: a plain service with `subscribe(listener)`, plus a hook that
 * bridges it into React.
 *
 * **Fetched once, at boot; then every `game-composition` frame (and
 * every `game-transitions` one, see below).** The boot GET is the
 * snapshot; the frame the host broadcasts on every `/ide`
 * socket after a `PUT /api/composition/rows/:id` (its own, or another
 * tab's) is the newer fact and replaces `rows`. The frame also carries the
 * host's `reload` verdict — `reloads` counts the `true` ones, and
 * `Preview` remounts its iframe when the count moves. Its own socket, for
 * the reason `workspace.ts` gives: `connection` filters strictly to
 * `snapshot`/`diagnostics` by design. A `snapshot` frame (the EDITOR's
 * composition) says nothing about the game's project files and is not
 * listened to here.
 *
 * **Edits go out through `update`.** `PUT` the user's whole config object
 * (the form hands over `row.config` with one path replaced — never a
 * defaults-filled copy, the patch is a replacement); a 200 carries the
 * rows the host resolved after the write and its `reload` verdict, and
 * the host's frame — which lands on this same socket — is what moves
 * `reloads`, so a `PUT` answer never counts twice. Refusals (a 500
 * `{ diagnostics }`, a 400 `{ error }`, a network that did not answer)
 * are BOTH returned and reported through `ctx.connection.report`, after
 * `workspace.ts`.
 *
 * **Failures are data.** A host that is not running, a non-2xx, a body
 * without a `rows` array — each becomes a diagnostic ON the screen, in
 * this service's own `diagnostics`, and never a throw and never a blank
 * panel. They are kept OUT of `ctx.connection.diagnostics` deliberately:
 * `EditorComposition` resolves that array's `plugin` field against the
 * editor's own rows, and a diagnostic about the game's composition has no
 * business being labelled with an editor row that merely shares an id.
 * `GameComposition` resolves them against the GAME's rows instead, which
 * is what they are actually about.
 */
declare module 'cordis' {
  interface Context {
    gameComposition: GameCompositionService;
  }
}

export interface GameCompositionState {
  /** `null` until the first fetch settles — "not asked yet", which the screen shows differently from "no rows". */
  rows: GameCompositionRow[] | null;
  /**
   * The host's own PROJECT diagnostics (`/api/composition`'s own
   * `diagnostics`), plus this plugin's if the fetch itself failed. Every
   * one carries a composition-row id, a bundle name, or a sentinel like
   * `profile` — namespace 1 of `Diagnostic.plugin`. Not a running game's
   * own diagnostics — those are `ctx.gameDiagnostics` instead
   * (`plugins/diagnostics.tsx`, Task 7), namespace 2, forwarded over the
   * `/ide` socket rather than fetched here. The two meet on screen only in
   * `DiagnosticsPanel` (Task 8), which reads this array under the name
   * `project` and that one under `game`, and keeps them apart by which
   * array a diagnostic came in on rather than by its `plugin` field.
   */
  diagnostics: Diagnostic[];
  /** How many `game-composition` frames said `reload: true` — the preview remounts when this moves. */
  reloads: number;
  /**
   * The `.spin` stages (`GameCompositionResponse.schema.stages`' keys) —
   * the scene ids a game can have. From the boot GET only; a
   * `game-composition` frame carries rows and leaves these standing.
   */
  stages: string[];
  /**
   * The transition ids the running game reported: the boot GET's
   * `GameCompositionResponse.transitions`, then every `game-transitions`
   * frame the host relays (the game boots after the GET, so the frame is
   * what usually fills this). A `game-composition` frame leaves it standing.
   */
  transitions: string[];
}

export interface GameCompositionService extends GameCompositionState {
  subscribe(listener: () => void): () => void;
  /**
   * `PUT /api/composition/rows/:id { config }`. `config` is the user's
   * whole object — the patch row is REPLACED by it. `diagnostics` is `[]`
   * on success; the host's refusals otherwise (also reported to
   * `connection`), with `reload: false`.
   */
  update(
    id: string,
    config: Record<string, unknown>,
  ): Promise<{ reload: boolean; diagnostics: Diagnostic[] }>;
  /**
   * `POST /api/scenes/preview { scene }` — "show this scene" to the
   * running game. Answers the host's diagnostics (a warning when no
   * preview is up); a network that did not answer is one diagnostic too,
   * never a throw.
   */
  previewScene(scene: string): Promise<Diagnostic[]>;
}

export interface GameCompositionConfig extends ConnectionConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Where the host is. Defaults to the page origin, which the IDE's own vite proxies to it. */
  origin?: string;
}

export const name = 'game-composition';
export const inject = ['connection'];

/** The diagnostics this plugin authors itself: the composition could not be read, or an edit could not be delivered. */
function ownDiagnostic(where: string, message: string): Diagnostic {
  return diagnostic(
    'error',
    'composition',
    where,
    message,
    'check that the host is running — `e8 dev` serves this route',
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFrame(parsed: unknown): parsed is GameCompositionMessage {
  return (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as { type?: unknown }).type === 'game-composition' &&
    Array.isArray((parsed as { rows?: unknown }).rows)
  );
}

function isTransitionsFrame(parsed: unknown): parsed is GameTransitionsMessage {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const { type, ids } = parsed as { type?: unknown; ids?: unknown };
  return (
    type === 'game-transitions' && Array.isArray(ids) && ids.every((id) => typeof id === 'string')
  );
}

export function apply(ctx: Context, config: GameCompositionConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';
  const socket = (config.socketFactory ?? ((url) => new WebSocket(url) as WebSocketLike))(
    config.url,
  );

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function reportAll(diagnostics: Diagnostic[]) {
    for (const d of diagnostics) ctx.connection.report(d);
    return { reload: false, diagnostics };
  }

  const service: GameCompositionService = {
    rows: null,
    diagnostics: [],
    reloads: 0,
    stages: [],
    transitions: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async update(id, nextConfig) {
      const where = `/api/composition/rows/${encodeURIComponent(id)}`;
      let res: Response;
      let body: unknown;
      try {
        res = await fetchFn(`${origin}${where}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: nextConfig }),
        });
        body = await res.json();
      } catch (error) {
        return reportAll([ownDiagnostic(where, `could not write the row: ${reason(error)}`)]);
      }
      const answer = body as {
        rows?: unknown;
        reload?: unknown;
        diagnostics?: unknown;
        error?: unknown;
      };
      if (res.ok && Array.isArray(answer.rows)) {
        service.rows = answer.rows as GameCompositionRow[];
        service.diagnostics = Array.isArray(answer.diagnostics)
          ? (answer.diagnostics as Diagnostic[])
          : [];
        notify();
        return { reload: answer.reload === true, diagnostics: [] };
      }
      // A 500 carries `{ diagnostics }`; a 400 only `{ error }`; a 200 of
      // the wrong shape is a failure like any other.
      return reportAll(
        Array.isArray(answer.diagnostics)
          ? (answer.diagnostics as Diagnostic[])
          : [
              ownDiagnostic(
                where,
                `could not write the row: ${typeof answer.error === 'string' ? answer.error : `the host answered ${res.status}`}`,
              ),
            ],
      );
    },
    async previewScene(scene) {
      const where = '/api/scenes/preview';
      try {
        const res = await fetchFn(`${origin}${where}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene }),
        });
        const body = (await res.json()) as Partial<DiagnosticsResponse>;
        if (!Array.isArray(body.diagnostics)) {
          throw new Error(`the host answered ${res.status} without a "diagnostics" array`);
        }
        return body.diagnostics;
      } catch (error) {
        return [ownDiagnostic(where, `could not show the scene: ${reason(error)}`)];
      }
    },
  };

  void (async () => {
    try {
      const res = await fetchFn(`${origin}/api/composition`);
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<GameCompositionResponse>;
      // A 200 with the wrong shape is a failure like any other: better one
      // diagnostic naming it than a screen that renders `undefined.map`.
      if (!Array.isArray(body.rows)) throw new Error('the response has no "rows" array');
      // Only the GET carries these; a frame that beat it says nothing about them.
      service.stages = Object.keys(body.schema?.stages ?? {});
      service.transitions = Array.isArray(body.transitions) ? body.transitions : [];
      // A frame (or a PUT answer) that landed first is the newer fact.
      if (service.rows !== null) {
        notify();
        return;
      }
      service.rows = body.rows;
      service.diagnostics = Array.isArray(body.diagnostics) ? body.diagnostics : [];
    } catch (error) {
      if (service.rows !== null) return;
      // An empty row list, not `null`: the question was asked and
      // answered. The screen says why alongside it.
      service.rows = [];
      service.diagnostics = [
        ownDiagnostic(
          '/api/composition',
          `could not read the game's composition: ${reason(error)}`,
        ),
      ];
    }
    notify();
  })();

  socket.addEventListener('message', (event: { data: string }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    // The game's transition list, relayed by the host as the game reports
    // it (and in the greeting): the game boots after this plugin's GET, so
    // the GET's `transitions` is empty on the default path.
    if (isTransitionsFrame(parsed)) {
      service.transitions = parsed.ids;
      notify();
      return;
    }
    // Same guard as `workspace`: `null`, an array or a primitive all pass
    // JSON.parse; a frame without a `rows` array is ignored, not applied.
    if (!isFrame(parsed)) return;
    service.rows = parsed.rows;
    if (parsed.reload === true) service.reloads += 1;
    notify();
  });

  ctx.effect(() => () => socket.close(), 'game-composition-socket');
  ctx.provide('gameComposition', service);
}

/** Subscribe a component to the game's resolved composition. */
export function useGameComposition(ctx: Context): GameCompositionState {
  const read = (): GameCompositionState => ({
    rows: ctx.gameComposition.rows,
    diagnostics: ctx.gameComposition.diagnostics,
    reloads: ctx.gameComposition.reloads,
    stages: ctx.gameComposition.stages,
    transitions: ctx.gameComposition.transitions,
  });
  // A fresh object per notification on purpose: the service mutates its
  // own fields in place, so handing `setState` the same reference twice
  // would not re-render.
  const [state, setState] = useState<GameCompositionState>(read);
  useEffect(() => {
    setState(read());
    return ctx.gameComposition.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
