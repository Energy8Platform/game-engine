# Scene canvas — design (slice 18, sub-project B of the scenes redesign)

Date: 2026-09-17. Branch: `feat/slot-webide-cordis`. Builds on
`2026-09-17-scene-editor-design.md` (slice 17: scene documents, node
types, the Scenes sidebar, the scene tab, Properties on the right).

## 0. Where this sits

Slice 17 shipped the scene as a node tree. The user's verdict: "the scene
editor is a visual editor where I manage images" — and "the preview is
for playing; the scene editor is the scene editor". This slice makes the
scene tab a canvas, the way `feat/slot-ide-ir` did it: the IDE embeds a
page of the PROJECT in an iframe, a runtime plugin inside that page draws
the gizmo and owns picking, and the two talk over `postMessage`. One
model, no second renderer: whatever a node type draws in the game, it
draws on the canvas. The Preview document is untouched.

## 1. Goal

Double-click a scene → a tab with the scene drawn at design resolution.
Click an object → it is selected (frame + handles; Properties on the
right). Drag → moves it; corner handles → scale; the top handle →
rotation; arrows nudge; `Delete` removes; `]`/`[` move it forward/back.
A grid with snap. Drop a PNG from the Explorer or the desktop onto the
canvas → a new `image` node at that point (the asset-to-node mapping is a
registry, so later types — `gif`, `video`, `spine` — are one registration
each). Every gesture ends in one write of the scene file through the host;
the tree pane and Properties update from the same `scenes` frame as
always.

## 2. Non-goals

- Multi-select, copy/paste, undo/redo, alignment tools.
- `gif`/`video`/`spine` node types (sub-project D adds them and their
  registry entries).
- Editing anything but `x y scale rotation` and z-order on the canvas.
- Playing the game on the canvas (no spin, no shell).

## 3. The editor page — `editor.html` + `src/editor.ts`

Shipped by the template next to `index.html`/`src/main.ts`, served by the
project's own vite (the preview port). `src/editor.ts`:

```ts
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

const game = await createGame({ mount: document.getElementById('mount')!, provide: { assets: { resolve } } });
const scene = new URLSearchParams(location.search).get('scene') ?? '';
game.ctx.plugin(sceneEdit, { scene, parentOrigin: document.referrer ? new URL(document.referrer).origin : '*' });
```

`resolve` is the same placeholder symbol art `main.ts` has (copied; `editor.ts`
is pinned byte-identical between template and example like `main.ts`).
The composition is the game's (`/api/composition`): `renderer1`,
`scenes1`, `reels1`, the project's node types — and `playloop1`, which is
inert without a caller. Nothing spins. `editor.html` has a `#mount` and
nothing else.

## 4. `@energy8engine/scene-edit` — the canvas plugin

A runtime package (`engine/game/scene-edit`), applied by `editor.ts` only.
`inject = ['scenes', 'nodeTypes', 'renderer']`.

### 4.1 What it does on apply

- `ctx.scenes.show(config.scene)` — the scene is on screen, no transition.
- Draws a design-space grid (`Graphics`, below the scene root) when
  enabled; default off, step 16.
- Installs picking: `pointerdown` on the renderer's stage hit-tests the
  shown scene's top-level node views (`scenes.view({scene,node})` for each
  node in draw order, topmost first, `getBounds().contains(point)`); a hit
  selects the node, a miss clears. `eventMode = 'static'` on the scene
  root; node views are not made interactive (a `reels` board keeps its own
  events).
- Attaches the **transform gizmo** to the selection: a port of
  `feat/slot-ide-ir`'s `packages/game-engine/src/scene/transformGizmo.ts`
  (8 handles + rotate + body drag; live bounds re-read each frame) with its
  `ScenePatch`/`LayoutRule` output replaced by the node's common props —
  body drag → `x, y` (design units = screen delta ÷ the scene root's world
  scale); corner handle → uniform `scale` (Shift: from centre); rotate
  handle → `rotation`. Edge handles (`n e s w`) are dropped: nodes have no
  width/height, only scale. Snap (grid step, and the design centre lines
  ±4 px) applies to `x, y` while dragging; Alt suspends it.
- Keyboard (the iframe must have focus — the IDE focuses it on click):
  arrows nudge 1 px (Shift 10); `Delete`/`Backspace` → `remove` event;
  `]`/`[` → `zorder` event `+1/-1`; `Escape` clears the selection.
- Drop target: `dragover`/`drop` on the canvas element; `drop` reads
  `dataTransfer.getData('text/x-e8-path')` (the Explorer's drag type) or
  `dataTransfer.files[0]` (desktop) and emits `drop` with the design-space
  point; the IDE decides what node to add (§5.3).
- Listens for `scenes` changes: `ctx.scenes` remounts on a `replace`
  (already the case); the gizmo re-reads bounds every frame, so an edit
  from Properties moves the frame at once (slice-17 highlight lesson).

### 4.2 The wire — `postMessage`, shape from `feat/slot-ide-ir`

```
parent → child   { type: 'e8:ide:req', id, method, params }
child  → parent  { type: 'e8:ide:res', id, ok, result | error }
child  → parent  { type: 'e8:ide:evt', event, payload }
```

Origin: the child posts to `config.parentOrigin`; it accepts requests only
from `event.origin === parentOrigin` (or any origin when `'*'` — the dev
default, same as before). Methods (parent → child):

| method | params | result |
|---|---|---|
| `select` | `{ node: string \| null }` | `{}` — moves the gizmo |
| `grid` | `{ on: boolean; step: 8 \| 16 \| 32 }` | `{}` |
| `snapshot` | `{}` | `{ scene, selected, bounds: Record<nodeId, {x,y,w,h}> }` (design space) |

Events (child → parent):

| event | payload | when |
|---|---|---|
| `ready` | `{ scene }` | after `show` resolved |
| `selected` | `{ node: string \| null }` | a pick on the canvas |
| `edit` | `{ node, props: Partial<{x,y,scale,rotation}> }` | ONE per gesture end (pointer up, one arrow press) |
| `remove` | `{ node }` | Delete |
| `zorder` | `{ node, delta: 1 \| -1 }` | `]` / `[` |
| `drop` | `{ path?: string; file?: File; x, y }` | a drop on the canvas |
| `error` | `{ message }` | a scene that will not show, a failed load |

The child never writes a file. The parent (the IDE) is the one writer.

## 5. IDE

### 5.1 The scene tab becomes the canvas

`engine/ide/client/src/shell/SceneDocument.tsx` (the viewer for
`scenes/<id>.scene.yml`, key `f:scenes/<id>.scene.yml`) lays out three
regions inside the tab: a toolbar (top), the canvas (centre: the iframe),
the node tree (left pane, 220 px, collapsible — the slice-17 tree,
unchanged in behaviour). Properties stays the right sidebar.

- iframe `src` = `${previewUrl}/editor.html?scene=<id>` (`previewUrl`
  from `ctx.workspace`, as `PreviewWall` reads it); `title="scene canvas"`;
  remounted when `previewUrl` or the project changes (same rules as
  `PreviewWall`).
- Toolbar (a port of `feat/slot-ide-ir`'s `apps/ide/src/viewport.ts`):
  device preset select (`Fill panel`, `Desktop 1280×720`, `Laptop`,
  `Popout L/S`, `Mobile L/M/S`), rotate, zoom `−`/`+`/`Fit` with the
  percentage, grid toggle + step. The iframe is sized to the preset in
  CSS px and scaled with a transform to fit; the game's own resize handles
  the rest (as before).
- The tab talks to the iframe through `src/shell/canvas-rpc.ts` — a port
  of the old `IdeClient` (`call(method, params)`, `on(event, cb)`,
  `attach(iframe)`), ~80 lines, tested against a fake `Window`.
- Wiring: `selected` → `ctx.scenes.select({scene, node})`; `edit` →
  `ctx.scenes.update(doc with node.props merged)`; `remove` →
  `removeNode` (existing helper) → `update`, selection cleared first;
  `zorder` → `moveNode` by one position among its siblings → `update`;
  `drop` → §5.3; `ctx.scenes` selection change (tree click, Properties
  rename) → `call('select', { node })`; grid toggle → `call('grid', …)`.
  The iframe is focused on `pointerdown` inside it (so keys reach it).
- The slice-17 highlight box in the PREVIEW (`scene-select` over `/ide`)
  stays as is; the canvas has its own gizmo.

### 5.2 Selection is one fact

`ctx.scenes.selected()` remains the single source; the canvas mirrors it
(`select` request) and reports picks into it (`selected` event → the same
`select()`). A `selected` event for the node already selected is dropped
(no POST storm).

### 5.3 Assets become nodes — `ctx.assetNodeTypes`

A client registry (`createRegistry`, last-wins) in
`src/plugins/asset-node-types.ts`, `inject = ['slots']`-free, provided
before `scenes`:

```ts
export interface AssetNodeType {
  /** Lower-case extensions without the dot. */
  extensions: string[];
  /** The scene node to create for a dropped path. */
  node(path: string, at: { x: number; y: number }): { type: string; props: Record<string, unknown> };
}
register(id: string, def: AssetNodeType): () => void; pick(path: string): AssetNodeType | undefined;
```

Built in: `image` for `png jpg jpeg webp` → `{ type: 'image', props: { src: path, x, y, anchor: 0.5 } }`.
A project plugin (client half) registers more — the way `viewers` and
`languages` are extended. The `drop` handler: a `path` → `pick(path)`;
no match → a warning diagnostic (`plugin: 'scenes'`, "no node type for
.ext — register one with ctx.assetNodeTypes"); a match → `addNode(doc,
type, props, null)` with `nextId`, then `update`, then `select` the new
node. A desktop `file` → written to `assets/<name>` through
`ctx.files.write` (the slice-15 upload path; refuse when the name exists,
as the Explorer does), then the same as a path.

### 5.4 Removed / changed from slice 17

- The tree is no longer the whole tab; its DOM contract (`node-<id>`,
  `node-add`, …) is unchanged inside the left pane.
- `SceneDocument`'s "activate → preview(id)" rule goes: the canvas is the
  scene's own view; the Preview shows what the game plays. The sidebar's
  click-to-preview stays.

## 6. Template and example

- `editor.html`, `src/editor.ts` (both pinned byte-identical to
  `first-slot`'s by `template.test.ts`; the top-level list grows by one).
- `assets/logo.png` (a real 64×64 PNG, the Energy8 mark or a placeholder)
  and `scenes/base_game.scene.yml` gains
  `{ id: logo, type: image, props: { src: assets/logo.png, x: 240, y: 40, anchor: 0.5 } }`
  before `board` — the first real image in the example (closes slice-17
  debt 2: the pixi `Assets` adapter is exercised by the game and the e2e).
- `package.json` (both): `@energy8engine/scene-edit` as a dependency.
- `README.md`: one paragraph on the canvas.

## 7. Reuse from `feat/slot-ide-ir` (port, do not rewrite)

- `packages/game-engine/src/scene/transformGizmo.ts` (255 lines) and the
  parts of `transform.ts` it needs (`handlePoint`, `resizeFactors`,
  `sizeLever` — the rule math becomes props math).
- `packages/game-engine/src/scene/devtools/ideBridge.ts` lines 100–180: the
  `e8:ide:*` request/response/event plumbing (child side).
- `apps/ide/src/rpc.ts` `IdeClient` (parent side) and
  `apps/ide/src/viewport.ts` `ViewportBar` (presets, zoom, fit) — as React
  in this codebase.

## 8. Testing

- `scene-edit` (vitest, headless pixi as slice 17): pick topmost by draw
  order; body drag → one `edit` with `x,y` in design units under a scaled
  root; corner drag → `scale`; rotate → `rotation`; snap to grid and to
  centre, Alt suspends; nudge; `]`/`[`; `drop` with a path and with a file;
  RPC: `select` moves the gizmo, `snapshot` bounds, origin check refuses a
  foreign origin.
- client: `canvas-rpc.ts` against a fake window; `SceneDocument` renders
  the iframe with the right `src`, forwards `selected`/`edit`/`remove`/
  `zorder`/`drop` into the service (assert PUT bodies), mirrors selection
  into `select` calls, `assetNodeTypes` pick/refusal, desktop file →
  `files.write` then a node; the toolbar's preset sizes the iframe.
- host: `template.test.ts` pins `editor.html`/`src/editor.ts`.
- e2e `canvas.spec.ts`: open `base_game` → the iframe boots and `ready`
  fires (`logo` visible: the game's `__e8.nodeVisible` is the preview's —
  add `window.__e8edit.snapshot()` on the editor page for tests); click
  the logo → Properties shows `logo`; drag it 40 px → file has the new
  `x`; corner-drag → `scale` changes; `]` → order changes; drop
  `assets/logo.png` from the Explorer → a second image node in the file;
  the Preview document is unaffected (still plays a spin).

## 9. Debts this closes

Slice 17 debt 2 (pixi `Assets` unproven), the user's two verdicts (visual
editor; preview ≠ editor). The tree-only tab remains as the left pane.
