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
import {
  diagnostic,
  type Diagnostic,
  type SafeArea,
  type ScenesResponse,
} from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { container, image, scene, shape, text, type AssetLoader } from './builtin';
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
  /** The design in portrait; the schema fills `{}` when unset, which reads as absent (the landscape design rotated). */
  portrait?: Partial<{ width: number; height: number }>;
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
  for (const t of [container, image, scene, shape, text]) nodeTypes.register(t);
  ctx.provide('nodeTypes', nodeTypes);
  const transitions = createTransitions(report);
  transitions.register(cut);
  transitions.register(fade);
  ctx.provide('transitions', transitions);
  ctx.provide('assetLoader', pixiLoader);
  const app = ctx.renderer.app as {
    stage: Container & {
      on?(event: 'pointerdown', fn: (e: { global: { x: number; y: number } }) => void): unknown;
      off?(event: 'pointerdown', fn: (e: { global: { x: number; y: number } }) => void): unknown;
    };
    ticker?: TickerLike;
    screen?: { width: number; height: number };
    renderer?: {
      on(event: 'resize', fn: (width: number, height: number) => void): unknown;
      off(event: 'resize', fn: (width: number, height: number) => void): unknown;
    };
  };
  // Exactly one of the portrait width/height is nothing to fit into —
  // `renderer-pixi`'s precedent: say so, and strip it so the fit reads the
  // block as absent (the landscape design rotated). The schema hands `{}`
  // over when the row sets neither, which is the same "absent".
  const portrait = config.portrait ?? {};
  const half = (portrait.width === undefined) !== (portrait.height === undefined);
  if (half)
    report(
      diagnostic(
        'warning',
        'scenes',
        'scenes1',
        'portrait needs both width and height — using the landscape design rotated',
        'set both or neither',
      ),
    );
  const scenes = createScenes({
    root: app.stage,
    design: config.design,
    portrait:
      !half && portrait.width !== undefined && portrait.height !== undefined
        ? { width: portrait.width, height: portrait.height }
        : undefined,
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

  // Fitting the design into the renderer is the ROW's job: on the editor
  // page `scene-edit` also calls `resize`, but the GAME page has nobody
  // else to, and an unfitted `container` draws the design at 1:1 in the
  // corner. Optional chaining throughout — a headless composition's
  // `renderer` (and a test's fake app) has neither `screen` nor an
  // event-emitting `renderer`, and that is a game with nothing to fit.
  //
  // The fit is into the viewport MINUS the safe area: an explicit
  // `safeArea` service (the editor page's preset band, a notch) wins over
  // the shell's own. Read at EVERY call, never cached — the shell's bar
  // height is measured and moves with its layout, so each `resize` must
  // see the current value. `inject(['shell'])` re-fits when the shell row
  // provides after this one, so row order does not matter.
  //
  // The resize listener defers one microtask: `scenes1` applies before
  // `shell1`, so its listener is registered first and would otherwise run
  // BEFORE the shell has re-laid its bar on the very resize that flips it
  // wide↔mobile — reading the OLD bar height. After the microtask every
  // listener of that resize has run, the shell's included.
  const insets = (): SafeArea | undefined =>
    (ctx.reflect.get('safeArea', false) as SafeArea | undefined) ??
    (ctx.reflect.get('shell', false) as { safeArea?: SafeArea } | undefined)?.safeArea;
  // The four numbers the last fit was made with, COPIED — the shell mutates
  // its `safeArea` in place, so holding the object would compare it to itself.
  let ft = 0;
  let fr = 0;
  let fb = 0;
  let fl = 0;
  const fit = (width = app.screen?.width, height = app.screen?.height) => {
    // `alive`: the deferred call may land after a dispose tore `scenes` down.
    if (!alive || !width || !height) return;
    const i = insets();
    ft = i?.top ?? 0;
    fr = i?.right ?? 0;
    fb = i?.bottom ?? 0;
    fl = i?.left ?? 0;
    scenes.resize(width, height, i);
  };
  fit();
  const onResize = (width: number, height: number) => queueMicrotask(() => fit(width, height));
  ctx.effect(() => {
    app.renderer?.on('resize', onResize);
    return () => void app.renderer?.off('resize', onResize);
  }, 'scenes:fit');
  ctx.inject(['shell'], () => fit());
  // The insets can move WITHOUT a resize — the shell's `renderBar()`
  // re-scales its bar — and nothing announces that. So every frame reads
  // the four numbers and re-fits when they differ from the last fit's:
  // pinned nodes follow the bar at once. Four compares, no allocation.
  const check = () => {
    const i = insets();
    if (
      (i?.top ?? 0) !== ft ||
      (i?.right ?? 0) !== fr ||
      (i?.bottom ?? 0) !== fb ||
      (i?.left ?? 0) !== fl
    )
      fit();
  };
  ctx.effect(() => {
    app.ticker?.add(check);
    return () => void app.ticker?.remove(check);
  }, 'scenes:insets');

  // A tap anywhere on the canvas, in DESIGN units, on the flow bus — what
  // a `wait { event: ui.tap }` holds an intro card for. Lenient by design:
  // `events` is the flow row's service (NOT `ctx.events`, cordis's own),
  // and a project with no flow row simply has nobody listening.
  //
  // `scene-edit` sets these same two stage fields for its own picking and
  // adds its own `pointerdown`: both handlers fire, and its dispose
  // restores whatever it found here. But the editor page composes the
  // project's WHOLE bundle, flow row included, so the extra emit would
  // land on a real bus — a `wait { event: ui.tap }` would advance every
  // time the designer clicks to select a node. `scene-edit` provides
  // `sceneEdit`, read HERE at click time (row order irrelevant): on that
  // page the tap is the editor's alone.
  //
  // `app.screen` is the renderer's own `Rectangle`, RESIZED IN PLACE, so
  // the hit area stays in step with the viewport without re-assigning.
  if (typeof app.stage.on === 'function') {
    app.stage.eventMode = 'static';
    if (app.screen) app.stage.hitArea = app.screen as unknown as Container['hitArea'];
    const onDown = (e: { global: { x: number; y: number } }) => {
      if (ctx.reflect.get('sceneEdit', false)) return;
      const p = scenes.container.toLocal(e.global);
      (
        ctx.reflect.get('events', false) as
          | { emit(name: string, payload?: unknown): void }
          | undefined
      )?.emit('ui.tap', { x: p.x, y: p.y });
    };
    ctx.effect(() => {
      app.stage.on!('pointerdown', onDown);
      return () => void app.stage.off?.('pointerdown', onDown);
    }, 'scenes:tap');
  }

  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  // `scenes.ready` is this GET: a reader that needs the boot set (`scene-edit`)
  // awaits it instead of polling `docs()`. A frame's earlier `replace` counts
  // as ready even when the GET then fails; nobody else awaiting it is fine
  // too (the `catch` below keeps a rejection from surfacing as unhandled).
  scenes.ready = (async () => {
    try {
      const res = await fetchFn('/api/scenes');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<ScenesResponse>;
      if (!Array.isArray(body.scenes)) throw new Error('the response has no "scenes" array');
      if (!replaced && alive) scenes.replace(body.scenes);
    } catch (error) {
      if (!alive) return;
      const message = `could not read the scene documents: ${error instanceof Error ? error.message : String(error)}`;
      report(diagnostic('error', 'scenes', '/api/scenes', message,
        'the host serves this route; the game shows no scene until it answers'));
      if (!replaced) throw new Error(message);
    }
  })();
  scenes.ready.catch(() => {});
}
