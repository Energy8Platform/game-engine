import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type ResolvedRow } from '@energy8engine/contracts';

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
 * **Fetched once, at boot.** Composition is not hot — the plan says so
 * about the game and it is no more hot for the editor's view of it — so a
 * reload is what picks up an edited `e8.profile.yml`/`e8.patch.yml`.
 * Refetching on every `/ide` snapshot was considered and dropped: the
 * socket carries the EDITOR's composition, and a knob turned there says
 * nothing about whether the game's project files moved.
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
  rows: ResolvedRow[] | null;
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
}

export interface GameCompositionService extends GameCompositionState {
  subscribe(listener: () => void): () => void;
}

export interface GameCompositionConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Where the host is. Defaults to the page origin, which the IDE's own vite proxies to it. */
  origin?: string;
}

export const name = 'game-composition';

/** The one diagnostic this plugin authors itself: the composition could not be read at all. */
function unreachable(reason: string): Diagnostic {
  return diagnostic(
    'error',
    'composition',
    '/api/composition',
    `could not read the game's composition: ${reason}`,
    'check that the host is running — `e8 dev` serves this route',
  );
}

export function apply(ctx: Context, config: GameCompositionConfig = {}) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';

  const service: GameCompositionService = {
    rows: null,
    diagnostics: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  void (async () => {
    try {
      const res = await fetchFn(`${origin}/api/composition`);
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as { rows?: unknown; diagnostics?: unknown };
      // A 200 with the wrong shape is a failure like any other: better one
      // diagnostic naming it than a screen that renders `undefined.map`.
      if (!Array.isArray(body.rows)) throw new Error('the response has no "rows" array');
      service.rows = body.rows as ResolvedRow[];
      service.diagnostics = Array.isArray(body.diagnostics)
        ? (body.diagnostics as Diagnostic[])
        : [];
    } catch (error) {
      // An empty row list, not `null`: the question was asked and
      // answered. The screen says why alongside it.
      service.rows = [];
      service.diagnostics = [unreachable(error instanceof Error ? error.message : String(error))];
    }
    for (const listener of listeners) listener();
  })();

  ctx.provide('gameComposition', service);
}

/** Subscribe a component to the game's resolved composition. */
export function useGameComposition(ctx: Context): GameCompositionState {
  const read = (): GameCompositionState => ({
    rows: ctx.gameComposition.rows,
    diagnostics: ctx.gameComposition.diagnostics,
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
