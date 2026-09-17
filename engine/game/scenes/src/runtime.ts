/**
 * Runtime half of `scenes` — the `scenes1` row in `e8-base`. What
 * `@energy8engine/stage`'s `stage1` row was, grown from layers to node
 * trees; see `./index`'s module doc.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance
 * (`/@fs/<realpath>`), not a hand-written, import-free twin.
 *
 * **`inject: ['renderer']` is what gates this row**, same as `stage`
 * before it — see that module's doc for the full ordering argument;
 * nothing about it changed here.
 *
 * Unlike `stage`, this row also pulls its document set: on apply it GETs
 * `/api/scenes` (the host route Task 2's contracts describe) and calls
 * `scenes.replace()` with what comes back. A failed GET is one error
 * diagnostic — the row still applies, with no documents, rather than
 * failing the whole composition over a route that is down.
 */
import type { Context } from 'cordis';
import { Assets, type Container } from 'pixi.js';
import { diagnostic, type Diagnostic, type ScenesResponse } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { container, image, scene, type AssetLoader } from './builtin';
import { createNodeTypes, type NodeTypesService } from './node-types';
import { createScenes, type ScenesService } from './scenes';
import { createTransitions, cut, fade, type TickerLike, type TransitionsService } from './transitions';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    nodeTypes: NodeTypesService;
    transitions: TransitionsService;
    assetLoader: AssetLoader;
    scenes: ScenesService;
  }
}

export interface ScenesConfig {
  design: { width: number; height: number };
  mode?: 'contain' | 'cover';
  transition?: string;
  transitionMs?: number;
  /** Tests only; the page's `fetch` otherwise. */
  fetchFn?: typeof fetch;
}

export const name = 'scenes';
export const inject = ['renderer'];

/** `pixi.js`' `Assets`, project-relative paths served same-origin by the dev server. */
const pixiLoader: AssetLoader = {
  load: async (urls) => { await Assets.load(urls.map((u) => `/${u}`)); },
  unload: async (urls) => { await Assets.unload(urls.map((u) => `/${u}`)); },
  get: (url) => Assets.get(`/${url}`),
};

export function apply(ctx: Context, config: ScenesConfig): void {
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  ctx.provide('nodeTypes', nodeTypes);
  const transitions = createTransitions(report);
  transitions.register(cut);
  transitions.register(fade);
  ctx.provide('transitions', transitions);
  ctx.provide('assetLoader', pixiLoader);
  const app = ctx.renderer.app as { stage: Container; ticker?: TickerLike };
  const scenes = createScenes({
    root: app.stage,
    design: config.design,
    mode: config.mode,
    transition: config.transition,
    transitionMs: config.transitionMs,
    transitions,
    nodeTypes,
    loader: pixiLoader,
    ticker: app.ticker ?? null,
    ctx,
    report,
  });
  // The boot GET below races anything else that can call `replace` first —
  // `ide-bridge`'s own `scenes` frame handler, chiefly. Whichever lands
  // first wins: a `replace` that landed already is a fresher, human-driven
  // fact than a GET kicked off at boot, so the GET's own result is simply
  // dropped rather than clobbering it. `alive` is the same story for a
  // dispose that lands mid-flight: nothing should touch a `scenes` service
  // that has already been torn down.
  let replaced = false;
  let alive = true;
  const originalReplace = scenes.replace;
  scenes.replace = (docs) => {
    replaced = true;
    originalReplace(docs);
  };

  ctx.effect(
    () => () => {
      alive = false;
      scenes.destroy();
    },
    'scenes:root',
  );
  ctx.provide('scenes', scenes);

  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  void (async () => {
    try {
      const res = await fetchFn('/api/scenes');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<ScenesResponse>;
      if (!Array.isArray(body.scenes)) throw new Error('the response has no "scenes" array');
      if (!replaced && alive) scenes.replace(body.scenes);
    } catch (error) {
      if (!alive) return;
      report(diagnostic('error', 'scenes', '/api/scenes',
        `could not read the scene documents: ${error instanceof Error ? error.message : String(error)}`,
        'the host serves this route; the game shows no scene until it answers'));
    }
  })();
}
