/**
 * `scene-edit`: the canvas plugin the IDE's editor page applies on top of
 * a project's own composition (spec §4). Shows one scene, picks and
 * transforms its top-level nodes with the gizmo, draws a grid, and talks
 * to the IDE over the `e8:ide:*` postMessage wire. It never writes a
 * file — the parent is the one writer. With `config.symbol !== undefined`
 * (an id, or `''` for none picked yet) it shows one `symbols.yml` state
 * instead — no scene, no gizmo/grid/keyboard/drop.
 */
import type { Context } from 'cordis';
import type { SceneDoc, SymbolsDoc, SymbolState } from '@energy8engine/contracts';
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
  /**
   * Symbol mode: show this `symbols.yml` id's state instead of `scene`.
   * `scene`, the gizmo, the grid, the keyboard and the drop handler are all
   * skipped whenever this is anything other than `undefined` — `''`
   * included, which means "symbol mode, nothing picked yet" (the Symbols
   * document's canvas before any chip is selected) and boots to the
   * outline only, waiting for the first `symbol` call. `undefined` (the
   * key left out entirely) is the only value that means scene mode.
   */
  symbol?: string;
}

export interface Bounds { x: number; y: number; w: number; h: number }
export interface Snapshot { scene: string; selected: string | null; bounds: Record<string, Bounds> }
/** What symbol mode's `snapshot` answers instead — no nodes, one preview. */
export interface SymbolSnapshot { symbol: string | null; state: SymbolState | null; w: number; h: number }

/** `window.__e8edit` on the editor page — test hooks, like `__e8` on the game page. Symbol mode exposes only `emitted`/`snapshot`/`frameOf` (no node to `select`, no `grid`, nothing to `pickAndSelect`). */
export interface SceneEdit {
  snapshot(): Snapshot | SymbolSnapshot;
  select(node: string | null): void;
  grid(on: boolean, step: number): void;
  /** Screen coords — what a `pointerdown` on the stage does. */
  pickAndSelect(x: number, y: number): void;
  /** The last 100 events sent to the IDE. */
  emitted(): { event: string; payload?: unknown }[];
  /** The node's view's `currentFrame` (an `AnimatedSprite`, or the gif wrapper's child); `null` for a still or unknown node. */
  frameOf(node: string): number | null;
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

  // Symbol mode: one symbols.yml state on the canvas, nothing scene-shaped
  // armed. Gated on `!== undefined`, not truthiness: `''` is a real symbol
  // mode request — the Symbols document before any chip is selected embeds
  // `selected?.id ?? ''`, so `editor.html?symbol=` must still boot symbol
  // mode (outline only, waiting for the first `symbol` call), not fall
  // through to scene mode with `scene: ''`.
  if (config.symbol !== undefined) {
    bootSymbol(config.symbol);
    return;
  }

  // Every canvas edit is applied HERE first (`scenes.replace` with the node's
  // props merged), then told to the IDE, whose answer comes back as a
  // `replace` of the same set — JSON-equal, so nothing remounts under a
  // gesture in flight. Until it does, the edit is `pending`: the IDE's echo
  // of an OLDER edit (key repeat outruns the round trip) must not snap the
  // node back, so an incoming set acknowledges the latest pending edit it
  // reflects and the ones after it are laid over it again. A set that
  // reflects none (a refused write, another writer) is taken as is.
  const pending: { node: string; props: Record<string, number> }[] = [];
  const patch = (docs: SceneDoc[], node: string, props: Record<string, number>): SceneDoc[] =>
    docs.map((d) => d.id !== scene ? d : { ...d, nodes: d.nodes.map((n) => (n.id === node ? { ...n, props: { ...n.props, ...props } } : n)) });
  const reflects = (docs: SceneDoc[], e: { node: string; props: Record<string, number> }): boolean => {
    const n = docs.find((d) => d.id === scene)?.nodes.find((x) => x.id === e.node);
    return !!n && Object.entries(e.props).every(([k, v]) => n.props[k] === v);
  };
  // The IDE's documents, on every change: this page composes no `ide-bridge`
  // (its `scene-preview` handler would switch the scene shown here), so the
  // parent is the one source of edits after the boot GET. Handled before
  // `ready`: a `replace` that beats the GET is the fresher fact (the runtime
  // then drops the GET's own answer).
  wire.handle('replace', (p) => {
    let docs = (p as { docs?: SceneDoc[] })?.docs ?? [];
    const acked = pending.map((e) => reflects(docs, e)).lastIndexOf(true);
    pending.splice(0, acked >= 0 ? acked + 1 : pending.length);
    for (const e of pending) docs = patch(docs, e.node, e.props);
    scenes.replace(docs);
    return {};
  });

  // The documents land after apply (`scenes`' boot GET, or the IDE's own `replace`): decide once they have.
  void scenes.ready.then(
    () => {
      if (!alive) return;
      if (scenes.docs().has(scene)) boot();
      else emit('error', { message: `scene "${scene}" is not declared` });
    },
    (e: unknown) => { if (alive) emit('error', { message: e instanceof Error ? e.message : String(e) }); },
  );

  /**
   * `config.symbol` set: no scene document, no gizmo/grid/keyboard/drop — just one
   * `symbols.yml` state, fitted to `ctx.board?.cellSize` (96×96 when there is no
   * reel board), centred on the screen at the scenes root's design→screen scale.
   * The composed game (`flow1`'s `boot → show base_game`) still mounts under
   * `scenes.container` — `board.cellSize` and the symbols live set need it —
   * but is hidden; the preview sits on `app.stage` above it, so its own bounds
   * are measurable and `snapshot` still reads them back in design units.
   */
  function bootSymbol(id: string): void {
    const root = scenes.container;
    root.visible = false;
    type SymbolsLike = {
      replace(doc: SymbolsDoc | null): void;
      ready: Promise<void>;
      preview(symId: string, state: SymbolState, size: { width: number; height: number }): Container | null;
    };
    const symbols = ctx.reflect.get('symbols', false) as SymbolsLike | undefined;
    if (!symbols) { emit('error', { message: 'no "symbols" service' }); return; }

    const cellSize = (ctx.reflect.get('board', false) as { cellSize?: { width: number; height: number } } | undefined)
      ?.cellSize ?? { width: 96, height: 96 };
    const previewBox = new Container();
    previewBox.label = 'symbol-preview';
    previewBox.position.set(app.screen.width / 2, app.screen.height / 2);
    // `getGlobalTransform`, not `worldTransform`: the latter is only refreshed by a render pass.
    previewBox.scale.set(root.getGlobalTransform().a);
    const outline = new Graphics()
      .roundRect(-cellSize.width / 2, -cellSize.height / 2, cellSize.width, cellSize.height, 8)
      .stroke({ width: 2, color: 0x3a4152 });
    outline.label = 'symbol-outline';
    previewBox.addChild(outline);
    app.stage.addChild(previewBox);
    ctx.effect(() => () => { app.stage.removeChild(previewBox); previewBox.destroy({ children: true }); root.visible = true; }, 'scene-edit:symbol-preview');

    let current: { id: string; state: SymbolState } | null = null;
    let view: Container | null = null;

    /** Swaps the shown state: destroys the old view (drops it from the runtime's live set), previews the new one. */
    const showSymbol = (symId: string, state: SymbolState): boolean => {
      if (view) { view.destroy({ children: true }); view = null; }
      current = { id: symId, state };
      view = symbols.preview(symId, state, cellSize);
      if (view) previewBox.addChild(view);
      return view !== null;
    };

    wire.handle('symbol', (p) => {
      const { id: symId, state } = p as { id: string; state: SymbolState };
      return { shown: showSymbol(symId, state) };
    });
    wire.handle('replaceSymbols', (p) => {
      symbols.replace((p as { doc: SymbolsDoc | null }).doc);
      if (current) showSymbol(current.id, current.state);
      return {};
    });
    const snapshot = (): SymbolSnapshot => {
      let w = 0;
      let h = 0;
      if (view) {
        const b = view.getBounds();
        const tl = root.toLocal({ x: b.minX, y: b.minY });
        const br = root.toLocal({ x: b.maxX, y: b.maxY });
        w = br.x - tl.x;
        h = br.y - tl.y;
      }
      return { symbol: current?.id ?? null, state: current?.state ?? null, w, h };
    };
    wire.handle('snapshot', () => snapshot());

    /** Walks the current preview view's descendants for the first numeric `currentFrame` — same idea as `boot()`'s `frameOf`, just not limited to one level. */
    const frameOf = (_node: string): number | null => {
      if (!view) return null;
      const stack: Container[] = [view];
      while (stack.length) {
        const n = stack.shift()!;
        const cf = (n as unknown as { currentFrame?: unknown }).currentFrame;
        if (typeof cf === 'number') return cf;
        stack.push(...n.children);
      }
      return null;
    };
    // Same test-hook slot scene mode uses, `emitted`/`snapshot`/`frameOf` only — no node
    // to `select`, no `grid`, nothing to `pickAndSelect`. The browser e2e reads
    // `emitted()` for `ready` and `snapshot()` for the bounds, same as the scene canvas.
    const winHook = window as unknown as { __e8edit?: Pick<SceneEdit, 'emitted' | 'snapshot' | 'frameOf'> };
    winHook.__e8edit = { emitted: () => [...emitted], snapshot, frameOf };
    ctx.effect(() => () => { if (winHook.__e8edit?.frameOf === frameOf) delete winHook.__e8edit; }, 'scene-edit:hook');

    void symbols.ready.catch(() => {}).then(() => { if (alive) emit('ready', { symbol: id }); });
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
      gridOn = on; gridStep = Math.max(1, step || 16);
      gridGfx.clear();
      if (!on) return;
      const d = design();
      for (let x = 0; x <= d.width; x += gridStep) gridGfx.moveTo(x, 0).lineTo(x, d.height);
      for (let y = 0; y <= d.height; y += gridStep) gridGfx.moveTo(0, y).lineTo(d.width, y);
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
      onEdit: applyEdit,
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
      if (node === selected) return;
      selected = node;
      // A node with no top-level view (nested, or not mounted) is the IDE's pick, not the canvas': kept, not echoed.
      if (node === null || target) emit('selected', { node });
    };
    const pickAndSelect = (x: number, y: number) => select(pickAt(views(), { x, y }));

    /** Rounded as the file should read (the IDE rounds the same), applied here, then told. */
    function applyEdit(node: string, props: Partial<GizmoTarget['props']>): void {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(props) as [string, number][]) rounded[k] = Math.round(v * (k === 'rotation' ? 1e4 : 100)) / (k === 'rotation' ? 1e4 : 100);
      if (pending.push({ node, props: rounded }) > 100) pending.shift();
      scenes.replace(patch([...scenes.docs().values()], node, rounded));
      retarget();
      emit('edit', { node, props: rounded });
    }

    // A `replace` remounts: the selected node's view is a new object — follow it, or drop a node that is gone.
    const retarget = () => {
      if (!target) return;
      const view = scenes.view({ scene, node: target.node });
      if (!view) select(null);
      else if (view !== target.view) gizmo.attach((target = { ...target, view }));
    };
    const frame = () => { retarget(); gizmo.refresh(); };
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
      if (!selected || e.metaKey || e.ctrlKey || isField(e.target)) return;
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

    const frameOf = (node: string): number | null => {
      const view = scenes.view({ scene, node });
      const animated = [view, view?.children[0]].find((v) => typeof (v as { currentFrame?: unknown } | undefined)?.currentFrame === 'number');
      return animated ? (animated as unknown as { currentFrame: number }).currentFrame : null;
    };

    wire.handle('select', (p) => { select((p as { node?: string | null })?.node ?? null); return {}; });
    wire.handle('grid', (p) => { const { on, step } = p as { on?: boolean; step?: number }; grid(!!on, step ?? 16); return {}; });
    wire.handle('snapshot', () => snapshot());

    const api: SceneEdit = { snapshot, select, grid, pickAndSelect, emitted: () => [...emitted], frameOf };
    const w = window as unknown as { __e8edit?: SceneEdit };
    w.__e8edit = api;
    ctx.effect(() => () => { if (w.__e8edit === api) delete w.__e8edit; }, 'scene-edit:hook');

    void scenes.show(scene).then(() => { if (alive) emit('ready', { scene }); });
  }
}
