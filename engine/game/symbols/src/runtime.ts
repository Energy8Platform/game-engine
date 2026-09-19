/**
 * Runtime half of `symbols` — the `symbols1` row in `e8-base`, between
 * `spine1` and `reels1`. Provides TWO services, both synchronously in
 * `apply` (`reels1` reads `assets` at ITS apply time and throws without
 * it, so no `ctx.inject` gating here):
 *
 * - `assets: { resolve(symbolId) }` — the legacy `SymbolResolver` the
 *   reel board's cells call on every `setData`. Untyped on `Context`:
 *   `@energy8engine/reels/runtime` already declares `assets` as its
 *   `AssetsService`, and a second declaration is TS2717; the shape here is
 *   the same `{ resolve }`.
 * - `symbols: SymbolsService` — `replace(doc)` (hot: remounts every live
 *   view, loads every state's assets, refreshes, repaints the board),
 *   `doc()`, `ready`, and `preview(id, state, size)` for the Symbols
 *   document's canvas.
 *
 * **`inject: []`**, like `flow`: `nodeTypes`, `assetLoader` and `board`
 * are read leniently (`ctx.reflect.get(name, false)`) at the moment they
 * are needed — the rows providing them (`scenes1`, `reels1`) sit earlier
 * or later in the same bundle and are there at run time; a missing one is
 * a placeholder wrapper or a skipped repaint, never a row stuck PENDING.
 *
 * Boot: `GET /api/symbols`, then `replace(body.doc)` — the same
 * `replaced`/`alive`/`ready` device as `flow/runtime.ts` (see its doc for
 * the race argument: a `replace` from `ide-bridge`'s `symbols` frame that
 * lands first wins, and a dispose mid-flight drops the answer).
 */
import type { Context } from 'cordis';
import type { Container } from 'pixi.js';
import {
  diagnostic,
  type SymbolDef,
  type SymbolsDoc,
  type SymbolsResponse,
  type SymbolState,
} from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { AssetLoader, NodeTypesService } from '@energy8engine/scenes';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { createSymbolHandle, type SymbolHandle, type ViewDeps } from './view';

declare module 'cordis' {
  interface Context {
    symbols: SymbolsService;
  }
}

export interface SymbolsConfig {
  /** Tests only; the page's `fetch` otherwise. */
  fetchFn?: typeof fetch;
}

export interface SymbolsService {
  /** Hot: loads every state's assets, refreshes live views, repaints the board. `null` clears the doc — live views fall back to the box. */
  replace(doc: SymbolsDoc | null): void;
  doc(): SymbolsDoc | null;
  /** The boot GET landed (or a `replace` beat it); rejects when the GET failed and nothing replaced. */
  ready: Promise<void>;
  /** A fresh view of ONE state, fitted to `size`; `null` when the symbol or the state is absent. Destroying it drops it from the live set. */
  preview(
    id: string,
    state: SymbolState,
    size: { width: number; height: number },
  ): Container | null;
}

export const name = 'symbols';
export const inject = [];

const STATES: SymbolState[] = ['static', 'idle', 'win'];

export function apply(ctx: Context, config: SymbolsConfig = {}): void {
  const report = (where: string, message: string, fix?: string) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(
      diagnostic('error', 'symbols', where, message, fix),
    );
  const deps: ViewDeps = {
    ctx,
    nodeTypes: () => ctx.reflect.get('nodeTypes', false) as NodeTypesService | undefined,
    report,
  };

  const live = new Set<SymbolHandle>();
  let defs = new Map<string, SymbolDef>();
  let current: SymbolsDoc | null = null;
  /** Ids reported absent since the last `replace` — once per id per doc. */
  const missing = new Set<string>();
  let alive = true;
  let replaced = false;

  const handle = (id: string, only?: SymbolState): SymbolHandle => {
    const h = createSymbolHandle(id, deps, { only, onDestroy: () => live.delete(h) });
    h.apply(defs.get(id));
    live.add(h);
    return h;
  };

  const resolve: SymbolResolver = (id) => {
    if (!defs.has(id) && !missing.has(id)) {
      missing.add(id);
      report(`symbols/${id}`, `no symbol "${id}" in symbols.yml`, 'add it to symbols.yml');
    }
    return handle(id).view;
  };

  /** Every state's assets, loaded as one batch; a failure is one diagnostic and the wrappers stay placeholders. */
  async function load(): Promise<void> {
    const loader = ctx.reflect.get('assetLoader', false) as AssetLoader | undefined;
    const nodeTypes = deps.nodeTypes();
    const urls = new Set<string>();
    for (const def of defs.values())
      for (const state of STATES) {
        const node = def[state];
        if (!node) continue;
        for (const u of nodeTypes?.get(node.type)?.assets?.(node.props) ?? []) urls.add(u);
      }
    if (loader && urls.size > 0) {
      try {
        await loader.load([...urls]);
      } catch (e) {
        report(
          'symbols',
          `could not load the symbol assets: ${e instanceof Error ? e.message : String(e)}`,
          'check the paths under the project',
        );
      }
    }
    if (!alive) return;
    for (const h of live) h.refresh();
    (ctx.reflect.get('board', false) as { repaint?(): void } | undefined)?.repaint?.();
  }

  const symbols: SymbolsService = {
    replace(doc) {
      replaced = true;
      current = doc;
      defs = new Map((doc?.symbols ?? []).map((d) => [d.id, d]));
      missing.clear();
      for (const h of live) h.apply(defs.get(h.id));
      void load();
    },
    doc: () => current,
    ready: Promise.resolve(),
    preview(id, state, size) {
      const def = defs.get(id);
      if (!def?.[state]) return null;
      const h = handle(id, state);
      h.resize(size);
      return h.view;
    },
  };

  ctx.effect(
    () => () => {
      alive = false;
    },
    'symbols:alive',
  );
  ctx.provide('assets', { resolve });
  ctx.provide('symbols', symbols);

  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  symbols.ready = (async () => {
    try {
      const res = await fetchFn('/api/symbols');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<SymbolsResponse>;
      if (!('doc' in body)) throw new Error('the response has no "doc"');
      // `doc: null` — a project with no `symbols.yml` yet draws boxes; not an error.
      if (!replaced && alive && body.doc) symbols.replace(body.doc);
    } catch (error) {
      if (!alive) return;
      const message = `could not read the symbols document: ${error instanceof Error ? error.message : String(error)}`;
      report(
        '/api/symbols',
        message,
        'the host serves this route; symbols draw as boxes until it answers',
      );
      if (!replaced) throw new Error(message);
    }
  })();
  symbols.ready.catch(() => {});
}
