# Scene editor — design (slice 17, sub-project A of the scenes redesign)

Date: 2026-09-17. Branch: `feat/slot-webide-cordis`. Supersedes the scene
half of `2026-09-17-scenes-and-layers-design.md` (slice 16): scenes are no
longer keyed by spin stage and no longer live in the `stage1` row.

## 0. Where this sits

The 2026-09-17 conversation replaced the slice-16 model with four
sub-projects, built in this order:

- **A — this spec.** Scene = named tree of nodes in its own file; nested
  scenes; node types as plugins; assets derived from the tree; a scene
  tab (tree editor), a Scenes sidebar, a right sidebar for properties.
- **B — canvas.** Click, drag, scale on the preview. Needs A.
- **C — flow editor.** A DnD graph (`boot`, `spin.result`, `shell.button`,
  `scene.done`, `timer` → `show scene`, `wait`, `branch`, …) that becomes
  the ONLY driver of the game; `main.ts` interprets it, `result.stage` is
  just an event. Needs A.
- **D — symbols and animations** (UC5): `spine`, `spritesheet`, … as node
  types.

Until C lands, one temporary rule keeps the game playable: the page shows
the scene whose `id` equals `result.stage`, if such a scene exists.

## 1. Goal

A game author declares what is on screen as **scenes** — trees of typed
nodes in `scenes/<id>.scene.yml` — and edits them in the IDE without
touching code: a Scenes sidebar lists them, a double-click opens a scene
in its own tab as a node tree, the selected node's properties sit in a
right sidebar, and the running preview shows the scene being edited. Node
types are plugins; the first four are `container`, `image`, `reels`, and
`scene` (a nested scene). The runtime loads the assets a scene needs
before showing it and unloads what nothing visible needs after hiding it.
Everything the slice-16 `stage1` row did that still matters — design
resolution, fit, transitions — moves into the new `scenes1` row; the
`layers`/`scenes` config and the `@energy8engine/stage` package go.

## 2. Non-goals

- Picking or moving nodes on the canvas (B). A selected node is
  HIGHLIGHTED in the preview; the preview does not select.
- Any logic in a scene: when to show, what to do on a button (C).
- `spine`, `spritesheet`, `text`, `video` node types (D and later).
- Bundling scenes into a production build (the game reads them from the
  host in dev; `boot` keeps no copy). Ceiling noted in §5.3.
- Undo/redo in the tree editor.

## 3. The scene document

One file per scene: `scenes/<id>.scene.yml` under the project root. The
directory is created by the first `+`.

```yaml
# scenes/base_game.scene.yml
id: base_game
nodes:
  - id: bg
    type: image
    props: { src: assets/bg.png, x: 240, y: 144, anchor: 0.5 }
  - id: board
    type: reels
    props: { row: reels1, x: 0, y: 0 }
  - id: big_win
    type: scene
    props: { scene: big_win, visible: false }
    # a nested scene renders inside this one; shown by `scenes.show('big_win')`
```

```ts
// @energy8engine/contracts
export interface SceneNode {
  id: string;            // unique within the scene document
  type: string;          // a registered node type
  props: Record<string, unknown>;
  children?: SceneNode[]; // `container` only today; any type may carry them
}
export interface SceneDoc {
  id: string;            // equals the file's basename before `.scene.yml`
  nodes: SceneNode[];    // list order is draw order, first at the back
}
```

Rules:

- `id` must equal the file name; the host reports a mismatch and the
  file's basename wins for lookup.
- Node ids are unique within a document; a duplicate is an error, the
  later node is skipped by the runtime.
- Common props every node type accepts, applied by the runtime after
  `mount`: `x`, `y` (px in design space, default `0`), `scale` (default
  `1`), `rotation` (radians, `0`), `alpha` (`1`), `visible` (`true`),
  `anchor` (`0`; applied only when the view has `anchor`). A node type's
  own schema adds the rest.
- The IDE writes the file through the host; comments do not survive a
  write (same as `e8.patch.yml`).

## 4. Node types

A node type is a runtime registration:

```ts
// @energy8engine/scenes
export interface NodeType<P = Record<string, unknown>> {
  type: string;
  /** schemastery schema for `props` (own fields only; common props are the runtime's). */
  schema: Schema<P>;
  /** Builds the pixi view. `ctx` is the scenes row's context. */
  mount(props: P, ctx: Context): Container;
  /** Applies new props in place; absent → the runtime unmounts and mounts again. */
  update?(view: Container, props: P, ctx: Context): void;
  /** Called before the view is removed; the runtime never destroys a view it did not create. */
  unmount?(view: Container): void;
  /** Project-relative asset paths this node needs. Empty by default. */
  assets?(props: P): string[];
}
```

`ctx.nodeTypes` is a `createRegistry({ policy: 'last-wins' })` of these,
provided by the `scenes1` row BEFORE `ctx.scenes`, so a project plugin
with `inject: ['nodeTypes']` registers before the first `show`. Re-registering
a type re-mounts every node of that type in every loaded scene.

Built into `@energy8engine/scenes`:

| type | props | mount | assets |
|---|---|---|---|
| `container` | none | empty `Container`; `children` mount into it | — |
| `image` | `src: string` (project-relative) | `Sprite` from `Assets.get(src)` | `[src]` |
| `scene` | `scene: string` | the referenced scene's tree, mounted as a child (see §5.2) | the referenced scene's assets |

Registered by `@energy8engine/reels`' runtime: `reels` with
`props: { row?: string }` (default `reels1`, informative only while one
reels row exists) — `mount` returns `ctx.board.view`, detached from wherever
it was; `unmount` detaches it without destroying. The reels row keeps
providing `board` and, when no `scenes` service ever appears, keeps its
slice-16 fallback of mounting to the renderer root with the same warning
text minus the word "layer". The `layer` config key is removed.

## 5. Runtime: `@energy8engine/scenes`, row `scenes1`

Replaces `@energy8engine/stage` in `engine/bundles/e8-base/e8.bundle.yml`
(row id `scenes1`, `hot: true`) and in every fixture bundle that lists
`stage1`. `fitStage`, the design-resolution root container, `resize`,
`createTransitions`, `cut`, `fade` move over unchanged; the `stage`
package is deleted.

### 5.1 Config and service

```yaml
- id: scenes1
  name: '@energy8engine/scenes'
  config:
    design: { width: 480, height: 288 }   # applies: restart
    mode: contain                          # contain | cover
    transition: cut                        # default for show()
    transitionMs: 300
```

```ts
export interface ScenesService {
  /** Mounts the scene if needed, loads its assets, runs the transition, makes it visible. Resolves when the transition ends. Unknown id → error diagnostic, resolves. */
  show(id: string, opts?: { transition?: string }): Promise<void>;
  /** Hides; unloads assets no visible scene needs. */
  hide(id: string): Promise<void>;
  /** Visible top-level scene ids, in the order they were shown. */
  visible(): string[];
  /** Every loaded document, by id. */
  docs(): ReadonlyMap<string, SceneDoc>;
  /** Replaces the document set; remounts what changed, keeps what is visible visible. */
  replace(docs: SceneDoc[]): void;
  /** Draws a highlight box around the node (bounds in design space); `null` clears it. */
  highlight(ref: { scene: string; node: string } | null): void;
  /** Root design-space container (was `stage.container`). */
  container: Container;
}
```

`show` on a scene that is a nested child of a visible scene sets that
node visible; on a top-level scene it adds the scene's root container to
the design root. `show` on an already-visible scene is a no-op that
resolves. Concurrent `show`/`hide` calls are queued and run in order
(closes slice-16 debt 6).

Transitions keep the slice-16 contract (`from`, `to`, `ms`, `ticker`);
`fade` still fades only arriving containers. `ctx.transitions` stays as
it was. The `game-transitions` `/ide` message stays.

### 5.2 Mounting

A document mounts to a root `Container` named after the scene. Nodes
mount depth-first in list order; the common props apply after `mount`.
A node whose type is unknown becomes an error diagnostic
(`source: 'scenes'`, `subject: '<scene>/<node>'`) and is skipped; the
rest of the scene still mounts. A `scene` node mounts the referenced
document as a child container; the reference chain is checked for a cycle
first and a cycle skips the node with an error. `visible: false` is the
usual state for a nested scene; the flow (C) or `show()` flips it.

`replace(docs)` diffs by scene id: removed docs unmount; changed docs
(deep-unequal) unmount and mount again in place, preserving visibility;
unchanged docs are left alone. A `board.view` reparented by a `reels`
node survives a remount because `unmount` detaches and never destroys.

### 5.3 Assets

`assets(doc)` = the union of every node's `assets(props)` through nested
scenes. `show` calls `pixi.js`' `Assets.load` on the paths not yet loaded
(project-relative → same-origin URL, the dev server serves the project
root); a path that fails to load is an error diagnostic naming the node,
and that node is skipped. `hide` unloads (`Assets.unload`) every path no
visible scene references. Nothing is loaded at boot; the first `show`
pays. Ceiling: a production bundle must inline the documents and map the
paths — out of scope, noted for `boot`.

### 5.4 Loading and hot updates

On apply the row fetches `GET /api/scenes` (same origin; the preview port
answers it, §6) and calls `replace(response.scenes)`. `ide-bridge`
handles a `scenes` message (§7) by calling `ctx.scenes.replace(msg.scenes)`
and a `scene-select` message by calling `highlight`. It answers the host
with a `node-types` message (§7) once `nodeTypes` is provided and on every
registration change, the way it reports `game-transitions`. The
`scene-preview` handler calls `show(scene)` as before. `window.__e8` gains
`scenesVisible(): string[]` and `nodeVisible(scene, node): boolean`;
`sceneCurrent()`/`layerVisible()` go.

## 6. Host: `engine/ide/host/src/plugins/scenes.ts` (rewritten)

Reads `scenes/*.scene.yml` (via `files.tree`/`files.read`, `js-yaml`),
keeps the parsed set, and re-reads on `files/written`/`files/removed`
under `scenes/`. Checks, reported through
`ideRpc.reportGameDiagnostics('scenes', …)` (replaced whole each time):

- file does not parse, or is not `{ id, nodes[] }` → error, document skipped
- `id` ≠ basename → warning
- duplicate node id → error
- unknown node type (against the game's last `node-types` report; silent
  until one arrives) → error
- `scene` node referencing a missing scene → error; a reference cycle → error
- `image.src` not present in the project tree → error
- props that fail the type's schema (schemas travel in `node-types`) →
  error naming the node and the field

Routes (root and preview alike, origin-guarded like the rest):

- `GET /api/scenes` → `ScenesResponse { scenes: SceneDoc[]; diagnostics: Diagnostic[]; nodeTypes: NodeTypeInfo[] }`
- `PUT /api/scenes/:id` body `SceneDoc` → validates, writes
  `scenes/<id>.scene.yml`, answers the refreshed `ScenesResponse`; a body
  whose `id` ≠ `:id` is refused
- `POST /api/scenes` body `{ id }` → creates `scenes/<id>.scene.yml` with
  `nodes: []`; refused if it exists or the id is not `[a-z0-9_]+`
- `DELETE /api/scenes/:id` → removes the file (through `files.remove`)
- `POST /api/scenes/preview { scene }` — unchanged
- `POST /api/scenes/select { scene, node }` (`node` may be `null`) →
  broadcasts `scene-select`

Every change to the set (write, remove, external edit) broadcasts a
`scenes` message to every `/ide` socket; a socket's greeting carries the
current set and node types. `node-types` from the game is stored and
relayed to the IDE sockets like `game-transitions`; cleared to `[]` when
the project switches (also closes slice-16 debt 2 for transitions).

## 7. Contracts (`@energy8engine/contracts`)

```ts
export interface NodeTypeInfo { type: string; schema: unknown /* schemastery JSON */ }
export interface ScenesMessage { type: 'scenes'; scenes: SceneDoc[]; diagnostics: Diagnostic[] }
export interface NodeTypesMessage { type: 'node-types'; types: NodeTypeInfo[] }   // both ways, like game-transitions
export interface SceneSelectMessage { type: 'scene-select'; scene: string; node: string | null }
export interface ScenesResponse { scenes: SceneDoc[]; diagnostics: Diagnostic[]; nodeTypes: NodeTypeInfo[] }
```

`ScenePreviewMessage` and `GameTransitionsMessage` stay. `ServerMessage`
and `ClientMessage` unions grow accordingly.

## 8. IDE client

### 8.1 Right sidebar (shell)

`ctx.shell.slots.sideRight = 'shell.sideRight'`. Contributions register
like `shell.sidebar`: `{ name: 'shell.sideRight', key, title }` +
component. Shell state: `sideRight(): string | undefined`,
`showSideRight(key)`, `hideSideRight()`. `Shell.tsx` draws the region
right of the document area, 280 px, only while `sideRight()` names a
registered contribution; a retracted contribution hides it. No activity
button opens it — a plugin does, when it has something to show. Tests in
`shell.test.tsx` for: hidden by default, shown by `showSideRight`, hidden
when the contribution retracts.

### 8.2 `scenes` client service (`src/plugins/scenes.tsx`, rewritten)

`inject = ['slots', 'connection', 'files', 'shell', 'viewers', 'gameDiagnostics']`.

```ts
export interface ScenesService {
  docs(): readonly SceneDoc[];
  diagnostics(): readonly Diagnostic[];
  nodeTypes(): readonly NodeTypeInfo[];
  selected(): { scene: string; node: string | null } | null;
  select(scene: string, node: string | null): void;    // also POSTs /api/scenes/select
  create(id: string): Promise<Refusal | undefined>;
  remove(id: string): Promise<Refusal | undefined>;
  update(doc: SceneDoc): Promise<Refusal | undefined>;  // PUT; refused when the YAML text tab is dirty
  preview(id: string): Promise<void>;                   // POST /api/scenes/preview
  open(id: string): void;                               // opens the scene tab
  subscribe(listener: () => void): () => void;
}
```

State comes from `GET /api/scenes` at boot and `scenes`/`node-types`
frames over the connection. `update` is refused with
`{ error: 'the text tab of scenes/<id>.scene.yml has unsaved edits' }`
when that document is dirty in the shell — the slice-15 rule.

### 8.3 Surfaces

- **Activity** `{ key: 'scenes', icon: 'layers', order: 35, opens: 'sidebar' }`
  (unchanged).
- **Scenes sidebar** (`shell.sidebar`, key `scenes`): rows `scene-<id>`,
  one per document; click → `select(id, null)` + `preview(id)`;
  double-click → `open(id)`; hover `×` → confirm → `remove`. Header `+`
  → inline input (`scene-add-input`), Enter → `create`, refusal inline.
  Below the list, the scene diagnostics. Empty → `scenes-empty` with the
  hint "press + to add a scene".
- **Scene tab** (`shell.document`, key `scene:<id>`, title `<id>`,
  closable): the node tree. Rows `node-<id>` show type and id, indent by
  depth; click → `select(scene, id)`; hover `×` → remove node (no confirm;
  a removed container takes its children). Header `+ node` → menu of
  `nodeTypes()`; a new node gets `id: <type>-<n>`, default props from the
  schema, appended to the selected container or the root. DnD between rows
  reorders; dropping onto a `container` row nests. Every change →
  `update(doc)`. Activating the tab → `preview(id)`; closing it clears the
  selection when it was in this scene. `viewers` registration: path
  matches `/^scenes\/[^/]+\.scene\.yml$/` → this document, so the Explorer
  opens the same tab; "Open as text" stays reachable from the Explorer
  menu (`openPath(path, { viewer: 'editor' })` — a one-line addition to
  the viewers pick).
- **Properties** (`shell.sideRight`, key `scenes`): shown while
  `selected()` is non-null. Node selected → `id` (editable, refused on
  duplicate), `type` (read-only), then `SchemaForm` over the type's
  schema merged with the common-props schema; commit → `update(doc)`.
  Scene selected, no node → `id` read-only, node count, asset list
  (derived from the docs and `nodeTypes`, read-only). Nothing selected →
  `hideSideRight()`.
- **Preview**: `select` sends `scene-select`; the game draws a 2 px box
  around the node's bounds (`highlight`), cleared on `null`.

### 8.4 Removed

`ScenesSidebar.tsx`'s layer/transition editing, `gameComposition.stages`
and `previewScene` (the sidebar POSTs itself), `checkScenes`, the stage
hint copy, `scenes.spec.ts` as written.

## 9. Template and example

`engine/templates/slot-basic` and `engine/examples/first-slot` (kept
byte-identical where they already are) get:

- `scenes/base_game.scene.yml`: `board` (`reels`) and `big_win`
  (`scene: big_win, visible: false`).
- `scenes/big_win.scene.yml`: one `container` node `banner` (a placeholder
  the author replaces; `image` needs a file the template does not ship).
- `e8.patch.yml`: the `stage1` row becomes `scenes1` with `design` only;
  `reels1.config.layer` gone.
- `main.ts`: `presentStage` shows `result.stage` leniently
  (`ctx.reflect.get('scenes', false)?.show(stage)`); a missing scene is
  silent — that is the temporary rule of §0, and the flow (C) removes it.
- `package.json`: `@energy8engine/scenes` replaces `@energy8engine/stage`.

## 10. Testing

- `@energy8engine/scenes` (vitest, headless pixi `Container` as in
  slice 16): mount order and common props; unknown type skipped with a
  diagnostic; nested scene mounts, cycle refused; `replace` remounts only
  changed docs and keeps visibility; `reels` node reparents `board.view`
  and a remount does not destroy it; `assets(doc)` through nesting;
  `show`/`hide` load and unload through a fake `Assets`; queued `show`s.
- `@energy8engine/reels`: registers `reels` when `nodeTypes` exists, root
  fallback when neither `nodeTypes` nor `scenes` ever appears.
- `ide-bridge`: `scenes` → `replace`, `scene-select` → `highlight`,
  `node-types` reported on provide and on registry change.
- host: each check in §6 with a fixture; every route's happy path and
  refusal; `scenes` broadcast on a write through `files`; greeting
  carries the set; project switch clears node types and transitions.
- client: shell right sidebar (§8.1); the `scenes` service against a fake
  fetch and connection; sidebar, scene tab and properties rendered
  THROUGH THE PLUGIN'S OWN CTX (slice-16 lesson); the dirty-tab refusal;
  the Explorer opening `scenes/x.scene.yml` in the scene tab.
- e2e `scenes.spec.ts` (rewritten, on the working-tree fixture — the
  fixture must be committed clean): `+` creates a scene and the Explorer
  shows the file; double-click opens the tab; `+ node` → `container`
  appears in the tree and its properties on the right; renaming a node
  writes the file (read back via the text tab); clicking `base_game`
  makes `__e8.scenesVisible()` `['base_game']`; showing `big_win` from
  the sidebar makes `nodeVisible('base_game', 'big_win')` true; a spin
  still presents (temporary rule).

## 11. Debts carried in

Slice-16 debts 1 (re-enter after hot re-apply — closed by `replace`
preserving visibility), 2 (stale lists — closed by clearing on project
switch), 6 (queued `show`) are closed by this design. Debt 3 (anonymous
game diagnostics bucket), 10 (`TS7016`), and the four un-reconnecting
`/ide` sockets stay.

## 12. Amendments made while planning

- **No root fallback for the reels board.** §4 said the reels row keeps
  mounting to the renderer root when no `scenes` service appears. The row
  now mounts nothing on its own and only registers the `reels` node type;
  the host warns (`where: reels1`) when a reels row exists and no scene
  has a `reels` node. Smaller, and the fact lives in data.
- **The scene tab IS the file's viewer.** Its key is `f:scenes/<id>.scene.yml`
  (the `viewers` route), so there is no separate text tab, no "Open as
  text", and no dirty-refusal — §8.3's last two sentences do not apply.
- **No `scenes` greeting on `/ide`.** The IDE and the game both fetch
  `GET /api/scenes` at boot (as they do `/api/composition`); only
  `node-types` greets a late socket, like `game-transitions`.
- **`nodeVisible`/`view()` address top-level scenes only.** A nested
  scene's inner nodes are not addressable from outside; the `scene` node
  itself is.
- **`ctx.assetLoader`** is provided by the `scenes1` row (pixi `Assets` in
  the game, a fake in tests); `image` reads it leniently.
