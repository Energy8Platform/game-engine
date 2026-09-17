/**
 * `scene-edit`: the canvas plugin the IDE's editor page applies on top of
 * a project's own composition (spec §4). Shows one scene, picks and
 * transforms its top-level nodes with the gizmo, draws a grid, and talks
 * to the IDE over the `e8:ide:*` postMessage wire. It never writes a
 * file — the parent is the one writer.
 */
import type { Context } from 'cordis';
import type {} from '@energy8engine/scenes/runtime';
import { COMMON } from '@energy8engine/scenes';
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { createGizmo, type GizmoTarget } from './gizmo';
import { pickAt } from './pick';
import { snapPoint } from './snap';
import { createWire, type WireOptions } from './wire';

export * from './wire';
export * from './snap';
export * from './pick';
export * from './gizmo';

export const name = 'scene-edit';
export const inject = ['scenes', 'nodeTypes', 'renderer'];

export interface SceneEditConfig {
  scene: string;
  /** Where events go, and the only origin requests are taken from (`'*'` for any). */
  parentOrigin: string;
  /** Tests: the transport; `window.parent.postMessage` / `window`'s `message` otherwise. */
  post?: WireOptions['post'];
  listen?: WireOptions['listen'];
  /** Tests: where `dragover`/`drop` are listened for; the renderer's canvas otherwise. */
  dropTarget?: HTMLElement;
}

export interface Bounds { x: number; y: number; w: number; h: number }
export interface Snapshot { scene: string; selected: string | null; bounds: Record<string, Bounds> }

/** `window.__e8edit` on the editor page — test hooks, like `__e8` on the game page. */
export interface SceneEdit {
  snapshot(): Snapshot;
  select(node: string | null): void;
  grid(on: boolean, step: number): void;
  /** Screen coords — what a `pointerdown` on the stage does. */
  pickAndSelect(x: number, y: number): void;
  /** The last 100 events sent to the IDE. */
  emitted(): { event: string; payload?: unknown }[];
}

const isField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function apply(ctx: Context, config: SceneEditConfig): void {
  const { scene } = config;
  const { scenes } = ctx;
  const app = ctx.renderer.app;
  const wire = createWire({
    parentOrigin: config.parentOrigin,
    post: config.post ?? ((msg, origin) => window.parent.postMessage(msg, origin)),
    listen: config.listen ?? ((fn) => {
      const on = (e: MessageEvent) => fn(e);
      window.addEventListener('message', on);
      return () => window.removeEventListener('message', on);
    }),
  });
  const emitted: { event: string; payload?: unknown }[] = [];
  const emit = (event: string, payload?: unknown) => {
    if (emitted.push({ event, payload }) > 100) emitted.shift();
    wire.emit(event, payload);
  };
  let alive = true;
  ctx.effect(() => () => { alive = false; wire.dispose(); }, 'scene-edit:wire');
  scenes.resize(app.screen.width, app.screen.height);

  // The documents may land after apply (`scenes`' boot GET, or the IDE's own
  // `replace`): decide the first time there are any — now, or on a frame.
  const start = () => {
    if (scenes.docs().has(scene)) return boot();
    emit('error', { message: `scene "${scene}" is not declared` });
  };
  if (scenes.docs().size > 0) start();
  else {
    const wait = () => { if (scenes.docs().size > 0) { app.ticker.remove(wait); if (alive) start(); } };
    app.ticker.add(wait);
    ctx.effect(() => () => app.ticker.remove(wait), 'scene-edit:wait');
  }

  function boot(): void {
    const root = scenes.container;
    const doc = () => scenes.docs().get(scene);
    const views = () =>
      (doc()?.nodes ?? []).flatMap((n) => { const view = scenes.view({ scene, node: n.id }); return view ? [{ node: n.id, view }] : []; });
    /** The design size, read off the fit: the screen centre is the design centre in both fit modes. */
    const design = () => { const c = root.toLocal({ x: app.screen.width / 2, y: app.screen.height / 2 }); return { width: c.x * 2, height: c.y * 2 }; };
    const toDesign = (p: { x: number; y: number }) => root.toLocal(p);

    // Grid: design space, under the scene root.
    const gridGfx = new Graphics();
    gridGfx.label = 'grid';
    root.addChildAt(gridGfx, 0);
    let gridOn = false;
    let gridStep = 16;
    const grid = (on: boolean, step: number) => {
      gridOn = on; gridStep = step;
      gridGfx.clear();
      if (!on) return;
      const d = design();
      for (let x = 0; x <= d.width; x += step) gridGfx.moveTo(x, 0).lineTo(x, d.height);
      for (let y = 0; y <= d.height; y += step) gridGfx.moveTo(0, y).lineTo(d.width, y);
      gridGfx.stroke({ width: 1, color: 0xffffff, alpha: 0.15, pixelLine: true });
    };
    ctx.effect(() => () => { root.removeChild(gridGfx); gridGfx.destroy(); }, 'scene-edit:grid');

    // Gizmo: screen space, above everything.
    const layer = new Container();
    layer.label = 'gizmo';
    app.stage.addChild(layer);
    let selected: string | null = null;
    let target: GizmoTarget | null = null;
    const gizmo = createGizmo({
      layer,
      // `getGlobalTransform`, not `worldTransform`: the latter is only refreshed by a render pass.
      designPerPixel: () => 1 / root.getGlobalTransform().a,
      snap: (p, alt) => (alt ? p : snapPoint(p, { on: gridOn, step: gridStep, design: design() })),
      onEdit: (node, props) => emit('edit', { node, props }),
      onBodyClick: (x, y) => pickAndSelect(x, y),
    });
    ctx.effect(() => () => { gizmo.destroy(); app.stage.removeChild(layer); layer.destroy(); }, 'scene-edit:gizmo');

    const targetOf = (node: string): GizmoTarget | null => {
      const view = scenes.view({ scene, node });
      const n = doc()?.nodes.find((x) => x.id === node);
      return view && n ? { node, view, props: COMMON(n.props as never) as GizmoTarget['props'] } : null;
    };
    const select = (node: string | null) => {
      target = node === null ? null : targetOf(node);
      gizmo.attach(target);
      const now = target?.node ?? null;
      if (now === selected) return;
      selected = now;
      emit('selected', { node: selected });
    };
    const pickAndSelect = (x: number, y: number) => select(pickAt(views(), { x, y }));

    // A `replace` remounts: the selected node's view is a new object — follow it, or drop a node that is gone.
    const frame = () => {
      if (target) {
        const view = scenes.view({ scene, node: target.node });
        if (!view) select(null);
        else if (view !== target.view) gizmo.attach((target = { ...target, view }));
      }
      gizmo.refresh();
    };
    app.ticker.add(frame);
    ctx.effect(() => () => app.ticker.remove(frame), 'scene-edit:frame');

    // Picking: the whole screen, on the stage; node views stay non-interactive.
    const was = { eventMode: app.stage.eventMode, hitArea: app.stage.hitArea };
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    const onDown = (e: FederatedPointerEvent) => pickAndSelect(e.global.x, e.global.y);
    app.stage.on('pointerdown', onDown);
    ctx.effect(() => () => { app.stage.off('pointerdown', onDown); Object.assign(app.stage, was); }, 'scene-edit:pick');

    const onKey = (e: KeyboardEvent) => {
      if (!selected || isField(e.target)) return;
      const n = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft': gizmo.nudge(-n, 0); break;
        case 'ArrowRight': gizmo.nudge(n, 0); break;
        case 'ArrowUp': gizmo.nudge(0, -n); break;
        case 'ArrowDown': gizmo.nudge(0, n); break;
        case 'Delete': case 'Backspace': emit('remove', { node: selected }); break;
        case ']': case '[': emit('zorder', { node: selected, delta: e.key === ']' ? 1 : -1 }); break;
        case 'Escape': select(null); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    ctx.effect(() => () => window.removeEventListener('keydown', onKey), 'scene-edit:keys');

    const dropTarget = config.dropTarget ?? app.canvas;
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      const path = e.dataTransfer?.getData('text/x-e8-path') || undefined;
      const file = e.dataTransfer?.files?.[0];
      if (!path && !file) return; // not ours: a stray text drag, a URL
      e.preventDefault();
      const rect = dropTarget.getBoundingClientRect();
      const { x, y } = toDesign({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      emit('drop', { path, file, x, y });
    };
    dropTarget.addEventListener('dragover', onDragOver);
    dropTarget.addEventListener('drop', onDrop);
    ctx.effect(() => () => { dropTarget.removeEventListener('dragover', onDragOver); dropTarget.removeEventListener('drop', onDrop); }, 'scene-edit:drop');

    const snapshot = (): Snapshot => ({
      scene,
      selected,
      bounds: Object.fromEntries(views().map(({ node, view }) => {
        const b = view.getBounds();
        const tl = toDesign({ x: b.minX, y: b.minY });
        const br = toDesign({ x: b.maxX, y: b.maxY });
        return [node, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }];
      })),
    });

    wire.handle('select', (p) => { select((p as { node?: string | null })?.node ?? null); return {}; });
    wire.handle('grid', (p) => { const { on, step } = p as { on?: boolean; step?: number }; grid(!!on, step || 16); return {}; });
    wire.handle('snapshot', () => snapshot());

    const api: SceneEdit = { snapshot, select, grid, pickAndSelect, emitted: () => [...emitted] };
    const w = window as unknown as { __e8edit?: SceneEdit };
    w.__e8edit = api;
    ctx.effect(() => () => { if (w.__e8edit === api) delete w.__e8edit; }, 'scene-edit:hook');

    void scenes.show(scene).then(() => { if (alive) emit('ready', { scene }); });
  }
}
