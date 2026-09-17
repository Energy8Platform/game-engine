# Scene Canvas Implementation Plan (slice 18)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The scene tab becomes a canvas: the project's `editor.html` (same composition as the game plus `@energy8engine/scene-edit`) in an iframe, with click-to-select, drag/scale/rotate gizmo, grid+snap, keyboard, and drop-an-asset-to-make-a-node — talking to the IDE over `postMessage`, the IDE being the only file writer.

**Architecture:** A new runtime package `@energy8engine/scene-edit` (applied only by `src/editor.ts`) owns picking, the ported `transformGizmo`, grid/snap, keys and the drop target, and speaks `e8:ide:req/res/evt` to `window.parent`. The IDE's `SceneDocument` grows a toolbar (ported `ViewportBar`), the iframe, and a left tree pane; a `canvas-rpc.ts` client (ported `IdeClient`) forwards canvas events into `ctx.scenes` (`select`/`update`) and mirrors selection back. A client registry `ctx.assetNodeTypes` maps dropped file extensions to nodes.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8, React 18, vitest 2, Playwright; ports from `feat/slot-ide-ir` (`transformGizmo.ts`, `transform.ts`, `ideBridge.ts` RPC core, `apps/ide/src/rpc.ts`, `apps/ide/src/viewport.ts`).

**Spec:** `docs/superpowers/specs/2026-09-17-scene-canvas-design.md`

## Global Constraints

- The Preview document is untouched; the canvas is the scene tab (viewer for `scenes/<id>.scene.yml`, key `f:scenes/<id>.scene.yml`).
- Wire shape verbatim: `{ type: 'e8:ide:req', id, method, params }` → `{ type: 'e8:ide:res', id, ok, result | error }`; `{ type: 'e8:ide:evt', event, payload }`. Methods: `select { node }`, `grid { on, step }`, `snapshot {}`. Events: `ready { scene }`, `selected { node }`, `edit { node, props }` (ONE per gesture), `remove { node }`, `zorder { node, delta }`, `drop { path? , file?, x, y }`, `error { message }`.
- The child (editor page) never writes a file; the IDE writes through `ctx.scenes.update`.
- Canvas edits touch only `x y scale rotation`; z-order = position among siblings; Delete removes.
- Gizmo: body drag → `x,y`; corners → uniform `scale` (Shift: from centre); rotate handle → `rotation`; no edge handles. Snap to grid step and to the design centre lines (±4 px) on `x,y`; Alt suspends. Grid default off, step 16; steps `8 | 16 | 32`.
- Keys in the iframe: arrows 1 px (Shift 10), `Delete`/`Backspace`, `]`/`[`, `Escape`.
- `ctx.assetNodeTypes`: `register(id, { extensions, node(path, at) })`, `pick(path)`; built-in `image` for `png jpg jpeg webp` → `{ type: 'image', props: { src, x, y, anchor: 0.5 } }`; a desktop file goes to `assets/<name>` via `ctx.files.write` first (refuse when the name exists).
- `editor.html` and `src/editor.ts` are pinned byte-identical between `engine/templates/slot-basic` and `engine/examples/first-slot` by `template.test.ts`; the template's top-level list gains `editor.html`.
- Ports from `feat/slot-ide-ir` are ports: read the old file (`git show feat/slot-ide-ir:<path>`), keep its structure, replace the doc/patch model with node props. Do not rewrite from scratch.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`. No `git checkout`/`git stash` on files you did not create. Never kill a process you did not start. Playwright runs alone. `git branch --show-current` = `feat/slot-webide-cordis` before and after.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>`; e2e: `cd engine/apps/web && npx playwright test tests/e2e/canvas.spec.ts`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/game/scene-edit/package.json`, `tsconfig.json`, `vitest.config.ts` | new package (copy `engine/game/scenes/`'s three; name `@energy8engine/scene-edit`; exports `.` → `src/index.ts`; no `e8.runtime` manifest — it is applied by `editor.ts`, not composed) |
| `engine/game/scene-edit/src/wire.ts` | child-side RPC: `createWire({ parentOrigin, post, listen })` → `{ emit, handle(method, fn), dispose }` |
| `engine/game/scene-edit/src/snap.ts` | pure: `snapPoint(p, { step, design, on, centre })` |
| `engine/game/scene-edit/src/pick.ts` | pure over pixi: `pickAt(views: {node, view}[], point)` topmost first |
| `engine/game/scene-edit/src/gizmo.ts` | port of `transformGizmo.ts` + the `transform.ts` bits it needs, over node props |
| `engine/game/scene-edit/src/index.ts` | the plugin: `name = 'scene-edit'`, `inject = ['scenes', 'nodeTypes', 'renderer']`, `apply(ctx, { scene, parentOrigin })` |
| `engine/templates/slot-basic/{editor.html,src/editor.ts,assets/logo.png,scenes/base_game.scene.yml,package.json,README.md}` + the same under `engine/examples/first-slot/` | the editor page and the first real image |
| `engine/ide/host/tests/template.test.ts` | pins |
| `engine/ide/client/src/shell/canvas-rpc.ts` | parent-side RPC (port of `IdeClient`) |
| `engine/ide/client/src/plugins/asset-node-types.ts` | registry plugin |
| `engine/ide/client/src/shell/CanvasToolbar.tsx` | port of `ViewportBar` as React |
| `engine/ide/client/src/shell/SceneDocument.tsx` | layout: toolbar / tree pane / iframe; event wiring |
| `engine/ide/client/src/context.ts`, `src/index.ts` | compose + export |
| `engine/apps/web/tests/e2e/canvas.spec.ts` | proof |

---

### Task 1: `@energy8engine/scene-edit` — package, wire, snap, pick

**Files:**
- Create: `engine/game/scene-edit/package.json` (deps: `@energy8engine/contracts`, `@energy8engine/scenes`, `@energy8engine/renderer-pixi`, `cordis`, `pixi.js`; dev: vitest, typescript), `tsconfig.json`, `vitest.config.ts` — copied from `engine/game/scenes/`
- Create: `src/wire.ts`, `src/snap.ts`, `src/pick.ts`
- Test: `tests/wire.test.ts`, `tests/snap.test.ts`, `tests/pick.test.ts`

**Interfaces (produces):**

```ts
// wire.ts
export interface WireOptions { parentOrigin: string; post(msg: unknown, origin: string): void; listen(fn: (e: { data: unknown; origin: string }) => void): () => void; }
export interface Wire { emit(event: string, payload?: unknown): void; handle(method: string, fn: (params: unknown) => unknown | Promise<unknown>): void; dispose(): void; }
export function createWire(o: WireOptions): Wire;
// snap.ts
export interface SnapOptions { on: boolean; step: number; design: { width: number; height: number }; centre?: boolean /* default true */; threshold?: number /* 4 */ }
export function snapPoint(p: { x: number; y: number }, o: SnapOptions): { x: number; y: number };
// pick.ts
export interface Pickable { node: string; view: Container }
export function pickAt(views: readonly Pickable[], point: { x: number; y: number }): string | null; // last in array = topmost
```

- [ ] **Step 1: Failing tests**

```ts
// tests/wire.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createWire } from '../src/wire';

function fakeWindow(parentOrigin = 'http://ide') {
  const posted: { msg: unknown; origin: string }[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  const wire = createWire({
    parentOrigin,
    post: (msg, origin) => posted.push({ msg, origin }),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  return { wire, posted, receive: (data: unknown, origin = parentOrigin) => listener?.({ data, origin }) };
}

describe('wire', () => {
  it('answers a request with a response carrying the same id; a throwing handler answers ok:false', async () => {
    const { wire, posted, receive } = fakeWindow();
    wire.handle('select', (p) => ({ got: p }));
    wire.handle('boom', () => { throw new Error('nope'); });
    receive({ type: 'e8:ide:req', id: 1, method: 'select', params: { node: 'a' } });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ msg: { type: 'e8:ide:res', id: 1, ok: true, result: { got: { node: 'a' } } }, origin: 'http://ide' });
    receive({ type: 'e8:ide:req', id: 2, method: 'boom', params: {} });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].msg).toEqual({ type: 'e8:ide:res', id: 2, ok: false, error: 'nope' });
  });
  it('an unknown method is ok:false; a foreign origin, a non-request, or a malformed frame is ignored', async () => {
    const { wire, posted, receive } = fakeWindow();
    receive({ type: 'e8:ide:req', id: 3, method: 'nope', params: {} });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].msg).toMatchObject({ ok: false });
    receive({ type: 'e8:ide:req', id: 4, method: 'nope', params: {} }, 'http://evil');
    receive({ type: 'e8:ide:evt', event: 'x' });
    receive('junk');
    receive(null);
    await new Promise((r) => setTimeout(r, 5));
    expect(posted).toHaveLength(1);
  });
  it('emit posts an event to the parent origin; "*" accepts any origin', () => {
    const { wire, posted, receive } = fakeWindow('*');
    wire.emit('ready', { scene: 'a' });
    expect(posted[0]).toEqual({ msg: { type: 'e8:ide:evt', event: 'ready', payload: { scene: 'a' } }, origin: '*' });
    wire.handle('grid', () => ({}));
    receive({ type: 'e8:ide:req', id: 1, method: 'grid', params: {} }, 'http://anything');
    return vi.waitFor(() => expect(posted).toHaveLength(2));
  });
});
```

```ts
// tests/snap.test.ts
import { describe, expect, it } from 'vitest';
import { snapPoint } from '../src/snap';
const design = { width: 480, height: 288 };
describe('snapPoint', () => {
  it('off → unchanged', () => expect(snapPoint({ x: 13, y: 7 }, { on: false, step: 16, design })).toEqual({ x: 13, y: 7 }));
  it('on → nearest grid line', () => expect(snapPoint({ x: 13, y: 25 }, { on: true, step: 16, design })).toEqual({ x: 16, y: 32 }));
  it('the design centre wins within the threshold even off-grid', () => {
    expect(snapPoint({ x: 243, y: 100 }, { on: true, step: 16, design })).toEqual({ x: 240, y: 96 });
    expect(snapPoint({ x: 243, y: 100 }, { on: false, step: 16, design })).toEqual({ x: 240, y: 100 });
    expect(snapPoint({ x: 243, y: 100 }, { on: false, step: 16, design, centre: false })).toEqual({ x: 243, y: 100 });
  });
});
```

```ts
// tests/pick.test.ts
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { pickAt } from '../src/pick';
const box = (x: number, y: number, w: number, h: number) => { const c = new Container(); c.addChild(new Graphics().rect(0, 0, w, h).fill(0xffffff)); c.position.set(x, y); return c; };
describe('pickAt', () => {
  it('returns the topmost (last) view containing the point, null when none', () => {
    const root = new Container();
    const a = box(0, 0, 100, 100), b = box(50, 50, 100, 100);
    root.addChild(a, b);
    const views = [{ node: 'a', view: a }, { node: 'b', view: b }];
    expect(pickAt(views, { x: 75, y: 75 })).toBe('b');
    expect(pickAt(views, { x: 10, y: 10 })).toBe('a');
    expect(pickAt(views, { x: 400, y: 400 })).toBeNull();
  });
  it('an invisible view is not picked', () => {
    const root = new Container();
    const a = box(0, 0, 100, 100); a.visible = false; root.addChild(a);
    expect(pickAt([{ node: 'a', view: a }], { x: 10, y: 10 })).toBeNull();
  });
});
```

Run: `npm install && npm test -w @energy8engine/scene-edit` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`wire.ts` — the child half of `feat/slot-ide-ir`'s `ideBridge.ts` (`REQ/RES/EVT` constants, `post`, `emit`), with a `handle` map; requests are dispatched asynchronously (`Promise.resolve().then(fn)`), errors become `{ ok: false, error: message }`; `parentOrigin === '*'` accepts every origin. `snap.ts`: round to `step` when `on`; then if `centre !== false` and `|p.x - width/2| <= threshold` → `width/2` (same for y). `pick.ts`: iterate from the end, skip `!view.visible` (or `!view.worldVisible` if available), `view.getBounds().containsPoint(point)` (pixi 8: `getBounds()` returns a `Bounds` with `containsPoint`; if not, use `.rectangle.contains`).

- [ ] **Step 3: Run → PASS. Commit** `git add engine/game/scene-edit package-lock.json && git commit -m "Start @energy8engine/scene-edit: the wire, snapping, picking"` (the lockfile is gitignored per slice 17 — stage it only if `git status` lists it).

---

### Task 2: The gizmo — port of `transformGizmo.ts` over node props

**Files:**
- Create: `engine/game/scene-edit/src/gizmo.ts` (from `git show feat/slot-ide-ir:packages/game-engine/src/scene/transformGizmo.ts` and the `Box`/`HandleId`/`handlePoint`/`resizeFactors` parts of `git show feat/slot-ide-ir:packages/game-engine/src/scene/transform.ts`)
- Test: `engine/game/scene-edit/tests/gizmo.test.ts`

**Interfaces (produces):**

```ts
export type HandleId = 'nw' | 'ne' | 'se' | 'sw' | 'rotate' | 'body';
export interface GizmoTarget { node: string; view: Container; props: { x: number; y: number; scale: number; rotation: number } }
export interface GizmoOptions {
  layer: Container;                       // where the gizmo draws (above the scene root)
  /** Screen→design: the scene root's world scale (1/scale). */
  designPerPixel(): number;
  snap(p: { x: number; y: number }, alt: boolean): { x: number; y: number };
  onEdit(node: string, props: Partial<GizmoTarget['props']>): void;   // ONE per gesture end
  onBodyClick(globalX: number, globalY: number): void;                  // press without move
}
export interface Gizmo {
  attach(target: GizmoTarget | null): void;   // draws frame+handles from view.getBounds(); null hides
  refresh(): void;                            // re-read bounds (call every frame while attached)
  /** Programmatic gesture (tests): screen coords. */
  drag(handle: HandleId, from: { x: number; y: number }, to: { x: number; y: number }, mods?: { shift?: boolean; alt?: boolean }): void;
  nudge(dxDesign: number, dyDesign: number): void;   // one onEdit with x,y
  destroy(): void;
}
export function createGizmo(o: GizmoOptions): Gizmo;
```

Rules: body drag applies `snap` to the resulting `{x,y}` then `onEdit(node, {x,y})` at pointer-up; a corner drag computes uniform `scale = props.scale * (distance to the opposite corner after / before)` (Shift: distance to centre), `onEdit(node, {scale})`; rotate: `rotation = atan2(pointer - centre) - atan2(start - centre) + props.rotation`, `onEdit(node, {rotation})`. During the gesture the VIEW is updated live (`view.position/scale/rotation`) so the user sees it; the doc is written once at the end. A press with < 3 px travel → `onBodyClick`.

- [ ] **Step 1: Failing tests** (headless pixi; drive with `drag(...)`)

```ts
import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { createGizmo } from '../src/gizmo';
function target(x = 100, y = 100) {
  const view = new Container(); view.addChild(new Graphics().rect(-20, -20, 40, 40).fill(0xffffff)); view.position.set(x, y);
  return { node: 'n', view, props: { x, y, scale: 1, rotation: 0 } };
}
function boot(dpp = 1) {
  const layer = new Container(); const onEdit = vi.fn(); const onBodyClick = vi.fn();
  const gizmo = createGizmo({ layer, designPerPixel: () => dpp, snap: (p) => p, onEdit, onBodyClick });
  return { gizmo, layer, onEdit, onBodyClick };
}
describe('gizmo', () => {
  it('a body drag moves the view live and emits one edit with x,y in design units', () => {
    const { gizmo, onEdit } = boot(0.5); const t = target(); gizmo.attach(t);
    gizmo.drag('body', { x: 100, y: 100 }, { x: 140, y: 120 });
    expect(t.view.position).toMatchObject({ x: 120, y: 110 });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('n', { x: 120, y: 110 });
  });
  it('a corner drag scales uniformly; Shift scales about the centre', () => {
    const { gizmo, onEdit } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('se', { x: 120, y: 120 }, { x: 140, y: 140 });   // opposite corner nw at (80,80): 40→60 → 1.5
    expect(onEdit).toHaveBeenLastCalledWith('n', { scale: 1.5 });
  });
  it('the rotate handle emits rotation', () => {
    const { gizmo, onEdit } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('rotate', { x: 100, y: 60 }, { x: 140, y: 100 });   // 12 o'clock → 3 o'clock = +π/2
    expect(onEdit.mock.calls[0][1].rotation).toBeCloseTo(Math.PI / 2, 5);
  });
  it('a press without travel is a body click, not an edit; nudge is one edit', () => {
    const { gizmo, onEdit, onBodyClick } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('body', { x: 100, y: 100 }, { x: 101, y: 100 });
    expect(onEdit).not.toHaveBeenCalled(); expect(onBodyClick).toHaveBeenCalledWith(101, 100);
    gizmo.nudge(1, 0); expect(onEdit).toHaveBeenCalledWith('n', { x: 101, y: 100 });
  });
  it('attach(null) hides; the frame follows the view on refresh', () => {
    const { gizmo, layer } = boot(); const t = target(); gizmo.attach(t);
    expect(layer.children.some((c) => c.visible)).toBe(true);
    t.view.position.set(300, 300); gizmo.refresh();
    const frame = layer.getChildByLabel?.('gizmo-frame') ?? layer.children[0];
    expect(frame.getBounds().x).toBeGreaterThan(250);
    gizmo.attach(null); expect(layer.children.every((c) => !c.visible)).toBe(true);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Port** — keep the old file's structure (layer, frame Graphics labelled `gizmo-frame`, handle Graphics, body catcher, `onDown`/`onMove`/`onUp` on the pixi event system with `globalpointermove`/`pointerup` on `layer`), delete the `n e s w` handles and the `LayoutRule`/orientation code, replace `applyPatch` with the live view update + one `onEdit` at the end. `drag()` synthesises the same three steps the pointer path uses (so the test exercises the real math). Run → PASS.

- [ ] **Step 3: Commit** `git commit -m "Port the transform gizmo onto scene-node props"`.

---

### Task 3: The plugin — `scene-edit`'s `apply`

**Files:**
- Create: `engine/game/scene-edit/src/index.ts`
- Test: `engine/game/scene-edit/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `ctx.scenes` (`show`, `docs`, `view`, `sceneView`, `container`, `resize`), `ctx.renderer.app` (`stage`, `canvas`, `ticker`, `renderer.events`), `ctx.nodeTypes`; Task 1's `createWire`/`snapPoint`/`pickAt`; Task 2's `createGizmo`.
- Produces: `export const name = 'scene-edit'; export const inject = ['scenes', 'nodeTypes', 'renderer']; export interface SceneEditConfig { scene: string; parentOrigin: string; /* tests */ post?, listen?, dropTarget?: HTMLElement }`; `window.__e8edit = { snapshot(), select(node), grid(on, step), emitted(): {event,payload}[] }` on the editor page (test hooks, like `__e8`).

Behaviour (spec §4.1–4.2): on apply → `scenes.show(scene)` then `emit('ready', { scene })` (an unknown scene → `emit('error', …)` and no gizmo); a `Graphics` grid under the scene root inside `scenes.container`, redrawn on `grid` method; gizmo `layer` added last to `scenes.container`; `pointerdown` on `app.stage` (eventMode `static`, `hitArea` = the whole screen) → `pickAt` over the shown scene's top-level nodes (`docs().get(scene).nodes` in order, `view({scene,node})`) → `select(node)`; `select` = gizmo.attach + `emit('selected', { node })` (skipped when unchanged); `app.ticker.add(gizmo.refresh)`; methods `select`, `grid`, `snapshot` (bounds per top-level node via `view.getBounds()` mapped into design space by `container.toLocal`); keys on `window`: arrows → `gizmo.nudge` (1/10), `Delete|Backspace` → `emit('remove', {node})`, `]`/`[` → `emit('zorder', {node, delta})`, `Escape` → `select(null)`; drop: `dragover` (preventDefault) and `drop` on `config.dropTarget ?? app.canvas` → design point = `container.toLocal({x: clientX - rect.left, y: clientY - rect.top})` → `emit('drop', { path: dataTransfer.getData('text/x-e8-path') || undefined, file: files[0], x, y })`; `ctx.effect` disposers for everything.

- [ ] **Step 1: Failing tests** — boot a `Context` with a fake `renderer` (`app = { stage: new Container(), ticker: { add, remove }, canvas: document.createElement('canvas') }` under `// @vitest-environment jsdom`), a real `createScenes` (from `@energy8engine/scenes`, headless) with two docs, `nodeTypes` with `container`/`image`, and a fake wire (`post`/`listen` injected via config):

```ts
it('shows the scene, emits ready, and answers snapshot with per-node bounds in design space', …);
it('a pointerdown over a node selects it (event selected) and the gizmo attaches; over nothing clears', …); // dispatch a pixi FederatedPointerEvent on app.stage or call the exported `pickAndSelect(x,y)` test hook
it('select over the wire moves the gizmo without re-emitting selected', …);
it('Delete emits remove; ] emits zorder +1; Escape clears', …);   // window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
it('a drop with the Explorer type emits drop with design coords; a foreign drop is ignored', …); // dispatch DragEvent on config.dropTarget with a stub dataTransfer
it('grid on/off redraws; an unknown scene emits error and no gizmo', …);
```

- [ ] **Step 2: Implement; run `npm test -w @energy8engine/scene-edit` → PASS; typecheck clean.** Commit `git commit -m "The scene-edit plugin: pick, gizmo, grid, keys, drop, and the wire to the IDE"`.

---

### Task 4: The editor page in the template and the example

**Files:**
- Create: `engine/templates/slot-basic/editor.html`, `src/editor.ts`, `assets/logo.png`; the same three under `engine/examples/first-slot/`
- Modify: `scenes/base_game.scene.yml` (both), `package.json` (both: add `"@energy8engine/scene-edit": "*"`), `README.md` (both: one paragraph)
- Modify: `engine/ide/host/tests/template.test.ts` (top-level list: `+ 'assets'`, `+ 'editor.html'`; identity loop: `+ 'editor.html'`, `+ 'src/editor.ts'`, `+ 'assets/logo.png'`)

- [ ] **Step 1: `editor.html`** — a copy of `index.html` reduced to `<div id="mount"></div>` + `<script type="module" src="/src/editor.ts">` and the same `<style>` for a full-window mount (read `index.html` first; keep its `<meta>`s).

- [ ] **Step 2: `src/editor.ts`**

```ts
/**
 * The scene canvas — the page the IDE embeds in a scene tab. Same
 * composition as `main.ts` (the project's rows, from `/api/composition`),
 * no spin loop and no page UI: `@energy8engine/scene-edit` draws the gizmo
 * and talks to the IDE over `postMessage`. The IDE is the only writer of
 * scene files; this page only reports what the pointer did.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

// The same placeholder art `main.ts` draws — the board must look the same here.
const CELL = 96;
const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];
const resolve: SymbolResolver = (symbolId: string): SymbolView => { /* verbatim from main.ts */ };

const game = await createGame({ mount: document.getElementById('mount')!, provide: { assets: { resolve } } });
const params = new URLSearchParams(location.search);
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, { scene: params.get('scene') ?? '', parentOrigin });
```

Copy `resolve` verbatim from `main.ts`. `cp` the template's `editor.html`/`src/editor.ts` to `first-slot`.

- [ ] **Step 3: `assets/logo.png`** — generate a 64×64 PNG with a node script (a filled circle in the accent colour; `zlib`+manual PNG chunks, or `pngjs` if already in the tree — check `npm ls pngjs`; if nothing is available, write the smallest valid 64×64 solid PNG by hand with `zlib.deflateSync`). Same bytes in both places.

- [ ] **Step 4: `base_game.scene.yml`** (both): prepend `- id: logo\n  type: image\n  props: { src: assets/logo.png, x: 240, y: 40, anchor: 0.5 }` before `board`.

- [ ] **Step 5: `template.test.ts`** updates; `npm test -w @energy8engine/ide-host -- template scenes` → PASS (the host `scenes` check must be silent on the example: `assets/logo.png` exists).

- [ ] **Step 6: Boot check** — if 5679 is free: `cd engine/examples && node ../apps/cli/bin/e8.mjs` in the background; `curl -s http://127.0.0.1:5681/editor.html | head -3` shows the page; stop what you started. Record.

- [ ] **Step 7: Commit** `git commit -m "Ship the editor page and the first real image with the template"`.

---

### Task 5: Client `canvas-rpc.ts` (port of `IdeClient`)

**Files:**
- Create: `engine/ide/client/src/shell/canvas-rpc.ts` (from `git show feat/slot-ide-ir:apps/ide/src/rpc.ts`, the `IdeClient` class only)
- Test: `engine/ide/client/tests/canvas-rpc.test.ts`

**Interfaces (produces):**

```ts
export interface CanvasRpc {
  attach(target: { contentWindow: Window | null }, origin: string): void;  // origin = previewUrl's origin; '*' in tests
  call<T = unknown>(method: string, params?: unknown): Promise<T>;        // rejects after 5 s
  on(event: string, handler: (payload: unknown) => void): () => void;
  dispose(): void;
}
export function createCanvasRpc(win: { addEventListener; removeEventListener } = window): CanvasRpc;
```

- [ ] **Step 1: Failing tests** — a fake `Window` capturing `postMessage(msg, origin)` and a way to deliver `message` events; cases: `call` posts a `req` with an incrementing id and resolves on the matching `res`; `ok:false` rejects with the error text; an event reaches `on` handlers and the disposer stops it; frames from another origin are ignored; `dispose` removes the listener. Run → FAIL.
- [ ] **Step 2: Port; run → PASS.** Commit `git commit -m "A postMessage client for the scene canvas"`.

---

### Task 6: `ctx.assetNodeTypes`

**Files:**
- Create: `engine/ide/client/src/plugins/asset-node-types.ts`
- Modify: `engine/ide/client/src/context.ts` (compose before `scenes`), `src/index.ts` (export the type)
- Test: `engine/ide/client/tests/asset-node-types.test.ts`

**Interfaces (produces):**

```ts
export interface AssetNodeType { extensions: string[]; node(path: string, at: { x: number; y: number }): { type: string; props: Record<string, unknown> } }
export interface AssetNodeTypesService { register(id: string, def: AssetNodeType): () => void; pick(path: string): AssetNodeType | undefined; list(): readonly { id: string; def: AssetNodeType }[] }
export const name = 'assetNodeTypes'; // ctx.assetNodeTypes
```

Built-in `image` registered in `apply`: `extensions: ['png','jpg','jpeg','webp']`, `node: (src, {x,y}) => ({ type: 'image', props: { src, x, y, anchor: 0.5 } })`.

- [ ] **Step 1: Failing tests**: `pick('assets/a.PNG')` → image (case-insensitive); `pick('a.mp4')` → undefined; a later `register('image', …)` wins (last-wins) and its disposer restores the built-in; `node()` shape. Run → FAIL.
- [ ] **Step 2: Implement with `createRegistry({ policy: 'last-wins' })` keyed by id, `pick` scanning `list()` from the end.** Run → PASS. Commit `git commit -m "Map dropped assets to scene nodes through a registry"`.

---

### Task 7: The scene tab becomes the canvas

**Files:**
- Create: `engine/ide/client/src/shell/CanvasToolbar.tsx` (port of `git show feat/slot-ide-ir:apps/ide/src/viewport.ts` — `DEVICE_PRESETS`, rotate, zoom −/+/Fit/%, plus grid toggle + step select)
- Modify: `engine/ide/client/src/shell/SceneDocument.tsx` (layout + wiring), `src/styles.css` (`.e8-canvas-*` rules: a grid `toolbar / [tree | stage]`, the stage centres the iframe, the tree pane 220 px with a collapse button)
- Test: `engine/ide/client/tests/canvas-toolbar.test.tsx`, `tests/scene-document.test.tsx` (extend)

**DOM contract:** tab root `scene-doc-<id>` (unchanged); `canvas-toolbar` with `canvas-preset` (select), `canvas-rotate`, `canvas-zoom-out`, `canvas-zoom`, `canvas-zoom-in`, `canvas-fit`, `canvas-grid` (checkbox), `canvas-grid-step` (select 8/16/32); `canvas-tree` (the existing tree, unchanged inside) with `canvas-tree-toggle`; `canvas-stage` holding `iframe[title="scene canvas"]` with `src="${previewUrl}/editor.html?scene=<id>"`, `width/height` from the preset (`Fill panel` → 100%), `style.transform = scale(zoom)`; `canvas-unavailable` when `previewUrl` is null.

**Wiring** (in `SceneDocument`, via `createCanvasRpc` attached on iframe `load`): `on('selected', {node})` → `ctx.scenes.select({scene, node})` unless already selected; `on('edit', {node, props})` → `ctx.scenes.update(map props into the node)`; `on('remove', {node})` → clear selection if it is the node or inside it (existing rule) → `update(removeNode(...))`; `on('zorder', {node, delta})` → `update(moveNode(doc, node, delta > 0 ? { before: nextNextSibling ?? end } : { before: prevSibling }))` — write a small helper `shiftNode(doc, id, delta)` next to `moveNode`, tested; `on('error', {message})` → `scene-doc-error`; `ctx.scenes.subscribe` → when `selected()` changes for this scene → `call('select', { node })`; grid controls → `call('grid', { on, step })`; `ready` → re-send the current selection and grid state. Remove the slice-17 "activate → preview" effect. Focus the iframe on `pointerdown` inside `canvas-stage`.

- [ ] **Step 1: Failing tests** — `CanvasToolbar`: preset change reports `{w,h}`; rotate swaps; zoom −/+ changes the % and Fit resets; grid toggle/step call back. `SceneDocument` (through `ctx.viewers.pick`): renders the iframe with the right `src` (fake `ctx.workspace.state()` with `previewUrl: 'http://127.0.0.1:5681'`); a `selected` frame from the iframe (post a `message` event on `window` with `source` = the iframe's `contentWindow` stub) → `POST /api/scenes/select`; an `edit` frame → PUT with merged props; `remove` → PUT without the node; `zorder +1` → PUT with the order swapped; selecting in the tree → a `req select` posted to the iframe; the old "activation → preview" test is deleted; `previewUrl: null` → `canvas-unavailable`. Run → FAIL.
- [ ] **Step 2: Implement; run `npm test -w @energy8engine/ide-client` + typecheck → PASS; `npm run build -w @energy8engine/ide-web` succeeds; no `pixi` in `dist`.** Commit `git commit -m "Turn the scene tab into a canvas: toolbar, iframe, tree pane, the wire"`.

---

### Task 8: Drop an asset → a node

**Files:**
- Modify: `engine/ide/client/src/shell/SceneDocument.tsx` (the `drop` event handler), `src/plugins/scenes.tsx` (`inject` gains `'assetNodeTypes'`, `'files'`, `'workspace'` if `SceneDocument` reads them through `ctx` — check what Task 7 already needed)
- Test: `engine/ide/client/tests/scene-document.test.tsx` (extend)

Behaviour: `on('drop', { path, file, x, y })`: with `path` → `ctx.assetNodeTypes.pick(path)`; none → `ctx.connection.report(diagnostic('warning','scenes', path, 'no node type for .<ext>', 'register one with ctx.assetNodeTypes'))` and `scene-doc-error` shows it; found → `addNode(doc, def.node(path, {x,y}).type, props, null)` with `nextId`, `update`, then `select` the new node. With `file` → `ctx.files.write('assets/<file.name>', bytes)` (FileReader as the Explorer does); if `ctx.files.tree()` lists that path already → refuse with `scene-doc-error` "assets/<name> exists — rename the file"; on success → the path branch. (Note: a `File` cannot cross `postMessage` structured-clone? It CAN — `File` is cloneable. Keep it.)

- [ ] **Step 1: Failing tests**: a `drop` with `path: 'assets/logo.png'` → PUT adds `image-1` with `src`, `x`, `y`, `anchor: 0.5` and then `POST select` for it; `path: 'a.mp4'` → no PUT, warning rendered; a `drop` with a `File` → `PUT /api/files/assets/<name>` then the PUT of the doc; an existing name → refusal, no write. Run → FAIL.
- [ ] **Step 2: Implement; run → PASS.** Commit `git commit -m "Drop an asset on the canvas and get a node where it landed"`.

---

### Task 9: End to end

**Files:**
- Create: `engine/apps/web/tests/e2e/canvas.spec.ts`
- Modify: `engine/apps/web/tests/e2e/scenes.spec.ts` only if the tab's DOM moved (the tree is now inside `canvas-tree`; testids unchanged)

- [ ] **Step 1: Write** (helpers from `scenes.spec.ts`; the canvas iframe is `iframe[title="scene canvas"]` INSIDE the IDE page; `frame.evaluate(() => window.__e8edit.snapshot())` reads bounds; gestures: `page.mouse` at the iframe's screen coordinates computed from `snapshot().bounds` + the iframe's bounding box + the CSS scale):

```ts
test('the scene tab boots the canvas and shows the logo', …);       // ready → snapshot().bounds.logo exists; Properties empty
test('click selects, drag moves: the file gets the new x', …);       // mouse.move to logo centre, down, move +40, up → poll file for `x: 280`
test('a corner drag scales, ] moves it forward', …);                 // snapshot bounds → se corner → drag → scale in file; press ] with iframe focused → order in file
test('dropping assets/logo.png from the Explorer adds an image node', …); // page.dragAndDrop from `explorer-entry-assets/logo.png` (check the Explorer's row testid) to the iframe
test('the Preview still plays', …);                                  // open the preview doc, __e8.spin()
```

- [ ] **Step 2: Run** `cd engine/apps/web && npx playwright test tests/e2e/canvas.spec.ts tests/e2e/scenes.spec.ts` alone; fix product defects in the product with a unit test, premise errors in the test with a reason.
- [ ] **Step 3: Whole suite**: `npm test -w @energy8engine/scene-edit -w @energy8engine/scenes -w @energy8engine/ide-host -w @energy8engine/ide-client -w @energy8engine/ide-web`, then the full Playwright run alone. Record counts.
- [ ] **Step 4: Commit** `git commit -m "Prove the scene canvas in a browser"`.
