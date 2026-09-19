# Symbols as Data + `tween`/`sound` Implementation Plan (slice 21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board's art becomes `symbols.yml` (a `symbols1` row builds `SymbolView`s out of scene nodes; a Symbols document with a live canvas edits it), and the flow gains `tween` and `sound` kinds in a `fx1` row; `main.ts`/`editor.ts` hold no art.

**Architecture:** `@energy8engine/symbols` provides the legacy `assets.resolve` off a `SymbolsDoc` (state = any registered node type, mounted in a fitted wrapper; `win` plays through the new `NodeType.once`) and a `symbols` service the host/bridge/canvas drive like `scenes`/`flow`. The host serves/checks `symbols.yml` with the node check extracted from `checkScenes`. The IDE mirrors the Flow plugin (service + document + Properties) and reuses the scene canvas iframe in a `symbol` mode of `scene-edit`. `@energy8engine/flow-fx` registers two kinds into `ctx.flowNodes` on the legacy `Tween` and `@pixi/sound`.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8.20.1, `@pixi/sound` 6.0.1 (in `node_modules`), `@energy8platform/game-engine/animation` (`Tween`, `Easing`) and `/slot` (`SymbolView`), schemastery, React 18, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-symbols-and-fx-design.md`

## Global Constraints

- `symbols.yml` EXACTLY per spec §3.1: `{ version: 1, symbols: [{ id, name?, fit?: 'contain'|'none', static, idle?, win? }] }`, a state `{ type, props }`; `id` a string.
- A `SymbolView` is centred on `(0,0)`; at rest it shows `idle ?? static`; `playWin` is defined ONLY when the def has `win` (the legacy scale pop otherwise); a state without `once` holds 600 ms; unknown id → the coloured box + one diagnostic per id per doc (`symbols/<id>`); unknown type → empty wrapper + one diagnostic per replace (`symbols/<id>/<state>`).
- `symbols1` provides `assets` and `symbols` SYNCHRONOUSLY in `apply` (`inject = []`); `nodeTypes`/`assetLoader`/`board`/`diagnostics` read leniently (`ctx.reflect.get(name, false)`). Bundle order: `symbols1` between `spine1` and `reels1`; `fx1` after `flow1`.
- `NodeType.once?(view, props, ctx): Promise<void>` — runtime-only (not in `NodeTypeInfo`); `spritesheet`/`gif`/`video`/`spine` implement it; an unfilled view resolves at once.
- `scenes.view(ref)` answers nested nodes (top-level first). `ReelsBoard.repaint()` = `setBoard(board)`; `ReelsBoard.cellSize` from `config.grid.cellSize` (fallback `{96,96}`); both no-ops/refused after `destroy` per the guard.
- Host: `GET /api/symbols` → `{ doc, known, diagnostics }` (`doc: null` = no file, not an error); `PUT` refused (400) on an error-level check; `plugin: 'symbols'`, `where: symbols/<id>[/<state>]`; the node check is `checkNode(...)` shared with `checkScenes` (scenes tests unchanged); `known` from `game/spec.json`'s `symbols`; the bridge frame is `{ type: 'symbols', doc, diagnostics }`; the game route attaches to the preview like `flowHost.attachGameRoutes`.
- IDE: activity `Symbols` (`order: 37`, icon `symbol-misc`), document key `symbols` (not closable), sideRight `symbols`; selection `{ id, state }` with mutual deselect against scenes/flow; drop data type `text/x-e8-path`; `Pickers.node()` = `<scene>/<node>` for every node (nested included).
- `flow-fx`: `tween { target (pick 'node'), x, y, scale, rotation (radians), alpha, ms=300, easing (Easing keys, default easeOutQuad), wait=true }`, `sound { src (asset mp3 ogg wav m4a), action play|stop = play, loop=false, volume=1, wait=false }`; a missing node / a failed play → `report` + `next`; abort → `Tween.killTweensOf` / instance stop.
- Example ≡ template (byte-identical, pinned): `symbols.yml` ids `1`..`6` (names from `spec.json`, `static` = `assets/symbols/<id>.png`, `win` on `1` = `coin.json` `loop: false`), six 64×64 PNGs, `assets/spin.wav`, `flow.yml` `click` (`sound`) between `idle` and `spin`, `main.ts`/`editor.ts` without art, `package.json` + `@energy8engine/symbols` + `@energy8engine/flow-fx`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`; the root lockfile is gitignored. No `git checkout`/`git stash` on files you did not create. Never kill a process you did not start. Playwright runs ALONE (one spec file per task at most; the full run is the controller's). Branch stays `feat/slot-webide-cordis`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>`; typecheck `npm run typecheck -w <pkg>`; e2e `cd engine/apps/web && npx playwright test tests/e2e/<file>`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/core/contracts/src/protocol.ts` | `SymbolNode`, `SymbolDef`, `SymbolState`, `SymbolsDoc`, `SymbolsMessage`, `SymbolsResponse`; `ServerMessage` union |
| `engine/game/scenes/src/{node-types,scenes}.ts` | `NodeType.once`; `view()` nested |
| `engine/game/node-media/src/{spritesheet,gif,video}.ts`, `engine/game/node-spine/src/spine.ts` | `once` |
| `engine/game/reels/src/index.ts` | `repaint`, `cellSize` |
| `engine/game/symbols/**` | `symbols1`: `view.ts` (wrapper/fit/playWin), `fallback.ts` (the box), `runtime.ts` (services, boot GET, replace, live set), `schema.ts`, `index.ts` |
| `engine/ide/host/src/plugins/{symbols,scenes,rpc,dev-game,project-scope}.ts` | route, checks, `checkNode`, broadcast, attach |
| `engine/game/ide-bridge/src/index.ts` | `symbols` in-frame |
| `engine/game/scene-edit/src/index.ts` | `symbol` mode |
| `engine/ide/client/src/plugins/symbols.tsx`, `src/shell/{SymbolsDocument,SymbolsProperties}.tsx`, `src/shell/symbols-doc.ts`, `src/shell/{PropertiesSidebar,FlowProperties}.tsx` | service, document, properties, reducers, `Pickers.node` |
| `engine/game/flow-fx/**` | `fx1`: `tween.ts`, `sound.ts`, `runtime.ts`, `schema.ts`, `index.ts` |
| `engine/bundles/e8-base/e8.bundle.yml` | `symbols1`, `fx1` |
| `engine/templates/slot-basic/**` ≡ `engine/examples/first-slot/**`; `engine/ide/host/tests/template.test.ts` | fixture + pins |
| `engine/apps/web/tests/e2e/{symbols,fx}.spec.ts` | proof |

---

### Task 1: Runtime contracts — `once`, nested `view`, `repaint`/`cellSize`, the symbol types

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts` (after `FlowResponse`), `engine/game/scenes/src/node-types.ts` (`NodeType.once`), `engine/game/scenes/src/scenes.ts:522` (`view`), `engine/game/node-media/src/spritesheet.ts`, `gif.ts`, `video.ts`, `engine/game/node-spine/src/spine.ts`, `engine/game/reels/src/index.ts`
- Test: `engine/core/contracts/tests/protocol-scenes.test.ts` (extend: the types compile and a `SymbolsMessage` is a `ServerMessage`), `engine/game/scenes/tests/scenes.test.ts` (extend: `view` finds a node nested under a `container`), `engine/game/node-media/tests/{spritesheet,gif,video}.test.ts`, `engine/game/node-spine/tests/spine.test.ts` (extend: `once`), `engine/game/reels/tests/*.test.ts` (extend: `repaint`, `cellSize`)

**Produces:**

```ts
// contracts
export interface SymbolNode { type: string; props: Record<string, unknown> }
export type SymbolState = 'static' | 'idle' | 'win';
export interface SymbolDef { id: string; name?: string; fit?: 'contain' | 'none'; static: SymbolNode; idle?: SymbolNode; win?: SymbolNode }
export interface SymbolsDoc { version: 1; symbols: SymbolDef[] }
export interface SymbolsMessage { type: 'symbols'; doc: SymbolsDoc | null; diagnostics: Diagnostic[] }   // in ServerMessage
export interface SymbolsResponse { doc: SymbolsDoc | null; known: { id: string; name: string }[]; diagnostics: Diagnostic[] }
// scenes
once?(view: Container, props: P, ctx: Context): Promise<void>;
// reels — on ReelsBoard (createReelsBoard), not on BoardApi
repaint(): void;                                    // reelSystem.setBoard(reelSystem.board); no-op after destroy
readonly cellSize: { width: number; height: number };   // reelSystem.config?.grid.cellSize ?? 96, square
```

Implementation notes:
- `spritesheet.once(view, props)`: not an `AnimatedSprite` or `textures.length <= 1` → `Promise.resolve()`; else `loop = false; onComplete = () => { onComplete = undefined; loop = props.loop; resolve(); }; gotoAndPlay(0)`. `gif`: the wrapper's `GifSprite` (find by `instanceof`), same shape on `loop`/`onComplete`/`currentFrame = 0; play()`. `video`: the `Sprite`'s `texture.source.resource` as `HTMLVideoElement` (absent → resolve); `loop = false; currentTime = 0; void play(); addEventListener('ended', …, { once: true })`, restore `loop`. `spine`: the wrapper's `Spine` child (absent → resolve); `const entry = spine.state.setAnimation(0, animation || first, false); entry.listener = { complete: () => resolve() }`. Tests drive completion by calling the view's `onComplete` / dispatching `ended` / calling `entry.listener.complete` on a real spine track (the existing minimal skeleton fixture).
- `scenes.view`: `const m = mounted.get(ref.scene); return m?.nodes.get(ref.node)?.view ?? m?.all.find((e) => e.node.id === ref.node)?.view;` — read `scenes.ts:79-95` for `Entry`/`all`.
- `reels`: `LegacyReelSystem` gains `readonly config?: { grid: { cellSize: number } }`; the fake in the existing tests may omit it. `repaint` counts as a `setBoard` call in the fake.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/contracts -w @energy8engine/scenes -w @energy8engine/node-media -w @energy8engine/node-spine -w @energy8engine/reels` green; typecheck the five. Commit `Let a node play once, a scene find a nested node, a board repaint`.

---

### Task 2: `@energy8engine/symbols` — the row

**Files:**
- Create: `engine/game/symbols/{package.json,tsconfig.json,vitest.config.ts}` (copy `engine/game/node-media/`'s; name `@energy8engine/symbols`; exports `.`, `./runtime`, `./schema`; `e8.runtime.entry ./src/runtime.ts`, `schema ./src/schema.ts`; deps `@energy8engine/scenes`, `@energy8engine/contracts`, `@energy8engine/diagnostics`, `@energy8platform/game-engine` (type-only, `/slot`), `cordis`, `pixi.js`, `schemastery`)
- Create: `src/fallback.ts`, `src/view.ts`, `src/runtime.ts`, `src/schema.ts` (`Schema.object({})`), `src/index.ts`
- Test: `tests/view.test.ts`, `tests/runtime.test.ts`

**Interfaces:**
- Consumes: `NodeTypesService` (`get`), `applyCommon` (both from `@energy8engine/scenes`), `AssetLoader` (`@energy8engine/scenes`' `builtin.ts`), `SymbolView`/`SymbolResolver` (`@energy8platform/game-engine/slot`), `ReelsBoard.repaint`/`cellSize` (Task 1), `SymbolsDoc`/`SymbolsResponse` (Task 1).
- Produces:

```ts
// fallback.ts
export function fallbackBox(id: string, size: { width: number; height: number }): Container;   // the COLORS square + id text main.ts draws today, drawn from -w/2,-h/2 (centred)
// view.ts
export interface ViewDeps { ctx: Context; nodeTypes(): NodeTypesService | undefined; report(where: string, message: string): void }
export interface SymbolHandle {
  readonly id: string;
  readonly view: SymbolView;                 // centred Container; `playWin` present iff def.win
  apply(def: SymbolDef | undefined): void;   // remount wrappers unless JSON-equal to the current def; undefined → fallback box
  refresh(): void;                           // type.update on every mounted wrapper, then fit — after an asset load
  resize(size: { width: number; height: number }): void;
  destroy(): void;                           // unmount wrappers, view.destroy, onDestroy()
}
export function createSymbolHandle(id: string, deps: ViewDeps, opts?: { only?: SymbolState; onDestroy?(): void }): SymbolHandle;
// runtime.ts
export const name = 'symbols'; export const inject = [];
export interface SymbolsConfig { fetchFn?: typeof fetch }
export interface SymbolsService {
  replace(doc: SymbolsDoc | null): void; doc(): SymbolsDoc | null; ready: Promise<void>;
  preview(id: string, state: SymbolState, size: { width: number; height: number }): Container | null;
}
declare module 'cordis' { interface Context { symbols: SymbolsService; assets: { resolve: SymbolResolver } } }   // `assets` is declared by reels' runtime.ts too — identical shape, merge is legal; if TS complains, import type from `@energy8engine/reels/runtime` instead
```

Implementation notes:
- Wrapper: `const wrapper = new Container(); const type = deps.nodeTypes()?.get(node.type); if (!type) { report(`symbols/${id}/${state}`, `unknown node type "${node.type}"`); } else { const child = type.mount(node.props, ctx); applyCommon(child, node.props); wrapper.addChild(child); type.update?.(child, node.props, ctx); }`. Fit: `const b = wrapper.getLocalBounds(); if (!b.width || !b.height) return; const s = def.fit === 'none' ? 1 : Math.min(size.width / b.width, size.height / b.height); wrapper.scale.set(s); wrapper.pivot.set(b.x + b.width / 2, b.y + b.height / 2); wrapper.position.set(0, 0);`. Wrap every `type.update`/`type.once` in try/catch → `report` once per handle (slice 20's refresh-guard lesson).
- Rest wrapper = `only ?? (def.idle ? 'idle' : 'static')`. `playWin` (assigned only when `def.win && !only`): hide rest, mount `win`, `await (type?.once?.(child, props, ctx) ?? wait(600))`, unmount `win` (`type.unmount?.(child)`, `wrapper.destroy({ children: true })`), show rest; `showStatic()` = the same teardown for a `win` in flight (a flag; the awaited `once` then resolves into a no-op).
- `runtime.apply`: `live: Set<SymbolHandle>`, `defs: Map<string, SymbolDef>`, `missing: Set<string>`; `resolve(id)`: create the handle (`onDestroy: () => live.delete(h)`), `h.apply(defs.get(id))`, report `no symbol "${id}" in symbols.yml` once per id per doc when absent, `live.add(h)`, return `h.view`. `replace(doc)`: set `defs`, clear `missing`, `for (h of live) h.apply(defs.get(h.id))`, then `void load()` — `assetLoader.load(all states' `type.assets?.(props)` flattened, deduped)` in try/catch (a failure = one diagnostic `symbols`, `could not load …`), then `for (h of live) h.refresh()`, then `(ctx.reflect.get('board', false) as { repaint?(): void } | undefined)?.repaint?.()`. `preview(id, state, size)`: `createSymbolHandle(id, deps, { only: state })` → `apply(def)`, `resize(size)`, add to `live` (its `view.destroy` removes it) → return `view`; `null` when `!def || !def[state]`. Boot GET + `replaced`/`alive` + `ready` EXACTLY as `engine/game/flow/src/runtime.ts` (`/api/symbols`, `SymbolsResponse.doc`, plugin `symbols`, where `/api/symbols`). Diagnostics via `ctx.reflect.get('diagnostics', false)?.report(diagnostic('error', 'symbols', where, message, fix))`.
- Tests on a real `new Context()` with `ctx.provide('nodeTypes', createNodeTypes())` registering scenes' `image` and node-media's `spritesheet`, `ctx.provide('assetLoader', fake)` (`get` answers `Texture.EMPTY`-based textures / a `Spritesheet`), `ctx.provide('diagnostics', { report: vi.fn() })`, `ctx.provide('board', { repaint: vi.fn() })`; headless pixi as in `engine/game/node-media/tests` (read one for the rAF/ResizeObserver stubs). Cases: spec §9 `symbols` list — every bullet is one `it`.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/symbols` green; typecheck. Commit `Symbols as data: a row that builds a SymbolView out of scene nodes`.

---

### Task 3: Host — `symbols.yml`, checks, the frame; the bridge listens

**Files:**
- Create: `engine/ide/host/src/plugins/symbols.ts`
- Modify: `engine/ide/host/src/plugins/scenes.ts:85-175` (extract `checkNode`), `engine/ide/host/src/plugins/rpc.ts` (`broadcastSymbols`, `IdeRpcService`), `engine/ide/host/src/plugins/dev-game.ts:254` (`ctx.get('symbolsHost')?.attachGameRoutes(preview)`), `engine/ide/host/src/plugins/project-scope.ts:61` (`await ctx.plugin(symbols)` after `flow`), `engine/game/ide-bridge/src/index.ts:875-935` (`symbols` next to `flow`: `(ctx.reflect.get('symbols', false) as { replace?(doc: unknown): void } | undefined)?.replace?.(message.doc)`)
- Test: `engine/ide/host/tests/symbols.test.ts` (mirror `flow.test.ts`'s harness), `engine/ide/host/tests/scenes.test.ts` (unchanged — must stay green), `engine/game/ide-bridge/tests/index.test.ts` (extend: a `symbols` frame reaches `symbols.replace`)

**Produces:**

```ts
// scenes.ts
export function checkNode(plugin: string, where: string, node: { type: string; props: Record<string, unknown> }, info: NodeTypeInfo | undefined, reported: boolean /* nodeTypes.length > 0 */, hasFile: (p: string) => boolean): Diagnostic[];
// symbols.ts
export const name = 'symbols'; export const inject = ['server', 'ideRpc', 'files'];
export function parseDoc(value: unknown): { doc?: SymbolsDoc; reason?: string };
export function checkSymbols(doc: SymbolsDoc, nodeTypes: NodeTypeInfo[], hasFile: (p: string) => boolean, known: { id: string; name: string }[]): Diagnostic[];
export interface SymbolsHostService { attachGameRoutes(server: Server): void; state(): SymbolsResponse }
// rpc.ts
broadcastSymbols(frame: Omit<SymbolsMessage, 'type'>): void;
```

Implementation notes:
- `checkNode` = the unknown-type / schema (`COMMON` + own) / `assetProps` (+ `sibling` derivation) block of `checkScenes`, with `plugin` in place of the literal `'scenes'`; `checkScenes` calls it per node and keeps the `scene`/`reels` parts.
- `checkSymbols`: `version !== 1` → error (`symbols.yml`); per def: empty/duplicate `id` → error `symbols/<id>`; `static` missing → error; each present state → `checkNode('symbols', `symbols/${id}/${state}`, state, infos.get(type), nodeTypes.length > 0, hasFile)`; WARNING `symbol <id> (<name>) has no entry` per `known` id absent; WARNING `symbol <id> is not in game/spec.json` per doc id absent from a non-empty `known`.
- `known()`: `ctx.files.read('game/spec.json')` → `symbols[].{id,name}` with `String(id)`; `[]` on any failure. `refresh(broadcast)` as flow's (`FILE = 'symbols.yml'`; `state = { doc, known, diagnostics }`; `reportGameDiagnostics('symbols', found)` on change; `broadcastSymbols({ doc, diagnostics })`); `files/written|removed` on `symbols.yml`, `game/spec.json`; `ctx.on('game/node-types', again)`. `hasFile` from `ctx.files.tree()` as scenes' does. PUT writes `yaml.dump(doc, { noRefs: true })`.
- Tests: GET without the file → `doc: null`, `known` from the fixture's `spec.json`, warnings per known id; each error path; PUT refused on `static` missing, written on a warning only; `files/written` → `broadcastSymbols` called; `checkNode` shared (a `spine` state with an empty `atlas` derives it).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/ide-host -w @energy8engine/ide-bridge` green; typecheck. Commit `Serve and check symbols.yml; the bridge hands the document to the game`.

---

### Task 4: The canvas in symbol mode — `@energy8engine/scene-edit`

**Files:**
- Modify: `engine/game/scene-edit/src/index.ts` (`SceneEditConfig.symbol?: string`; the `symbol` branch)
- Test: `engine/game/scene-edit/tests/plugin.test.ts` (extend with a `symbol` describe on the same fake-wire harness)

**Interfaces:**
- Consumes: `ctx.symbols` (Task 2: `ready`, `preview`, `replace`), `ctx.board?.cellSize` (Task 1).
- Produces (wire): `symbol { id, state } → { shown: boolean }`; `replaceSymbols { doc } → {}`; `snapshot → { symbol: string | null, state: SymbolState | null, w: number, h: number }`; event `ready` after `symbols.ready`; `__e8edit.frameOf('symbol')`; event `error { message }` when there is no `symbols` service.

Implementation notes:
- With `config.symbol` set: register `symbol`/`replaceSymbols`/`snapshot` handlers, skip `scenes.show`, the gizmo, the grid, the keyboard and the drop handler entirely (early branch before they are armed; `resize` still applies). The preview lives in a `Container` at `(design.width / 2, design.height / 2)` inside `scenes.container` (read how the plugin reaches the stage today), holding a `Graphics` outline `roundRect(-w/2, -h/2, w, h, 8).stroke({ width: 2, color: 0x3a4152 })` of `cellSize` and the current preview view; `symbol` destroys the previous view (`destroy({ children: true })`), sets `current = { id, state }`, adds `symbols.preview(id, state, cellSize)`, answers `{ shown: view !== null }`. `replaceSymbols` → `symbols.replace(doc)` then re-runs `symbol` for `current`. `frameOf('symbol')` walks the preview view's descendants for the first `currentFrame` number. `ready`: `symbols.ready.catch(() => {}).then(() => alive && emit('ready', { symbol: config.symbol }))`.
- Tests: with a fake `symbols` provided on the ctx (`preview` returns a `Container` with a child of known bounds; `ready` resolved): `ready` emitted with the symbol id; `symbol` answers `shown: true` and `snapshot` reports the bounds; a second `symbol` destroys the first view; `replaceSymbols` calls `replace` then re-previews; `select`/`grid` handlers are NOT registered in symbol mode (a request rejects with the wire's unknown-method error — read `wire.ts`); no `symbols` service → `error` event.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scene-edit` green; typecheck. Commit `The scene canvas shows one symbol state when asked to`.

---

### Task 5: Composition — the rows, art out of the pages, the example's symbols

**Files:**
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (`symbols1` between `spine1` and `reels1`, a comment like `media1`'s), `engine/templates/slot-basic/src/main.ts` ≡ `engine/examples/first-slot/src/main.ts` (drop `CELL`, `COLORS`, `resolve`, the `SymbolResolver`/`SymbolView`/`Container`/`Graphics`/`Text` imports if unused, `provide: { assets: { resolve } }` → `createGame({ mount })`; the header paragraph about `resolve` → two sentences saying the art is `symbols.yml` through the `symbols1` row; add `__e8.cellArt(col, row): string | null` — the constructor name of the deepest first descendant of the cell's `view` (`Sprite`/`AnimatedSprite`/`Graphics`), `null` without a grid/view — and `__e8.nodeProps(scene, node): { x: number; y: number; alpha: number } | null` from `scenes.view`), `src/editor.ts` ×2 (same art removal; `symbol: params.get('symbol') ?? ''` next to `scene`), `package.json` ×2 (`@energy8engine/symbols`), `README.md` ×2 (one paragraph: `symbols.yml`, the Symbols document)
- Create: `symbols.yml` ×2, `assets/symbols/{1..6}.png` ×2 (64×64 RGBA, generated by a Node script in your scratchpad — a zlib-deflated PNG the way slice 20's `coin.png` was made; distinct colour AND shape per id: disc, square, diamond, triangle, ring, cross; copy the same bytes to both projects)
- Modify: `engine/ide/host/tests/template.test.ts` (pin `symbols.yml`, `assets/symbols/1.png`…`6.png`)
- Test: `engine/game/runtime/tests/compose.test.ts` (extend if it pins row order — read it), `template.test.ts`

`symbols.yml` (both projects):
```yaml
version: 1
symbols:
  - id: '1'
    name: sym-1
    static: { type: image, props: { src: assets/symbols/1.png } }
    win: { type: spritesheet, props: { sheet: assets/coin.json, loop: false } }
  - id: '2'
    name: sym-2
    static: { type: image, props: { src: assets/symbols/2.png } }
  … 3..6 the same shape
```

- [ ] **Step 1:** pins fail. **Step 2:** files. **Step 3:** `npm test -w @energy8engine/ide-host -w @energy8engine/game-runtime` green; typecheck `first-slot` (`npm run typecheck -w first-slot` if the script exists, else `npx tsc --noEmit -p engine/examples/first-slot`); then ONE existing e2e file that spins the preview and reads `__e8.symbols()` (`grep -l "symbols()" engine/apps/web/tests/e2e/*.ts`, pick the first) — it must stay green with the art now coming from `symbols1`. Commit `The example's art lives in symbols.yml; the pages hold none`.

---

### Task 6: IDE — the Symbols service, document and Properties

**Files:**
- Create: `engine/ide/client/src/plugins/symbols.tsx`, `engine/ide/client/src/shell/symbols-doc.ts`, `engine/ide/client/src/shell/SymbolsDocument.tsx`, `engine/ide/client/src/shell/SymbolsProperties.tsx`
- Modify: `engine/ide/client/src/shell/PropertiesSidebar.tsx` (export `useNodePicker(ctx): () => string[]`; pass `node` in its `pickers`), `engine/ide/client/src/shell/FlowProperties.tsx:109` (`pickers={{ scene, asset, node }}`), the client's plugin list where `flow` is composed (`grep -rn "plugins/flow" engine/ide/client/src`), `engine/ide/client/src/plugins/flow.tsx` + `plugins/scenes.tsx` (deselect when `symbols` selects — same shape as flow's `scenes-deselect` effect; the symbols plugin does the reverse), the shell CSS where `.e8-flow-*` lives (list/chip styles, the card recipe of slice 17)
- Test: `engine/ide/client/tests/symbols-service.test.tsx`, `symbols-doc.test.ts`, `symbols-document.test.tsx`, `symbols-properties.test.tsx`, `properties-sidebar.test.tsx` (extend: `node` picker lists nested ids), `flow-properties.test.tsx` (extend: a `pick: 'node'` string renders a select of `<scene>/<node>`)

**Produces:**

```ts
// plugins/symbols.tsx — name 'symbols', inject ['slots','connection','shell','scenes','flow','files','assetNodeTypes']
export interface SymbolsClientService {
  doc(): SymbolsDoc | null; known(): readonly { id: string; name: string }[]; diagnostics(): readonly Diagnostic[];
  selected(): { id: string; state: SymbolState } | null; select(sel: { id: string; state: SymbolState } | null): void;
  update(doc: SymbolsDoc): Promise<Diagnostic[]>;   // PUT; the document serialises through commit() below
  subscribe(fn: () => void): () => void;
}
declare module 'cordis' { interface Context { symbols: SymbolsClientService } }
// symbols-doc.ts — pure reducers; an unknown id returns the doc unchanged
export const EMPTY: SymbolsDoc;   // { version: 1, symbols: [] }
export function addSymbol(doc: SymbolsDoc, id: string, name?: string): SymbolsDoc;          // static: { type: 'image', props: { src: '' } }; no-op when the id exists
export function removeSymbol(doc: SymbolsDoc, id: string): SymbolsDoc;
export function setSymbol(doc: SymbolsDoc, id: string, patch: { name?: string; fit?: 'contain' | 'none' }): SymbolsDoc;
export function setState(doc: SymbolsDoc, id: string, state: SymbolState, node: SymbolNode | null): SymbolsDoc;   // null clears idle/win; clearing static resets it to the empty image
export function setStateType(doc: SymbolsDoc, id: string, state: SymbolState, type: string, keep: string[]): SymbolsDoc;   // keeps the props named in `keep`
export function nodeForDrop(pick: { type: string; prop: string; hasLoop: boolean }, path: string, state: SymbolState): SymbolNode;   // { type, props: { [prop]: path, ...(state === 'win' && hasLoop ? { loop: false } : {}) } }
```

Implementation notes:
- Service = `plugins/flow.tsx` with `symbols` in place of `flow`: frames `symbols` (`applyDoc`), boot GET `${origin}/api/symbols` (`doc`, `known`, `diagnostics`), `update` PUT → on 200 apply `doc`/`known`/`diagnostics` from the answer; `select` notifies and clears `ctx.scenes.select(null)` + `ctx.flow.select(null)`; effects: activity/document/sideRight registrations, `sideRight` shown while selected, deselect on scenes/flow selection.
- `SymbolsDocument` (`data-testid="symbols-doc"`): the list column (`symbol-row-<id>` with `symbol-name-<id>`, chips `symbol-chip-<id>-<state>` showing the type or `+`, click → `select`; ghosts `symbol-ghost-<id>` with `symbol-add-<id>`; `symbol-add-input` + Enter; `symbol-menu-<id>` → `symbol-remove`, `symbol-clear-<state>`), a centre column placeholder `symbols-canvas` (`<p>` "select a symbol" — Task 7 fills it), a status line `symbols-status` (the last refusal/diagnostic). `commit(reduce)`: one promise chain, each write reduces `ctx.symbols.doc() ?? EMPTY` at its turn and PUTs — the `flow-graph`/`SceneDocument` shape. Drop (`text/x-e8-path`): `const tree = await ctx.files.tree(); const pick = ctx.assetNodeTypes.pick(path, tree)` → `nodeForDrop` (`hasLoop` from the reported type's schema `dict.loop`? — read `ctx.scenes.nodeTypes()`/the client's node-type source for the schema JSON) → `setState`; onto a row = `static`; onto the list's empty area (`symbols-drop-new`) = `addSymbol(stem)` when the stem is a `known` id or `/^\d+$/`, else status "drop onto a symbol". Diagnostics whose `where` starts with `symbols/<id>` mark the row (`data-diagnostic`).
- `SymbolsProperties` (`side-right-symbols`): `prop-symbol-name` (input, blur commits `setSymbol`), `prop-symbol-fit` (select), `prop-state-type` (select over `ctx.scenes.nodeTypes()`-reported types with `accept`, `image` first), then `SchemaForm` over the type's schema with `pickers={{ asset, scene, node }}` committing `setState` with the merged props. A `state` absent on the def → a `Create <state>` button (`prop-state-create`) making `{ type: 'image', props: { src: '' } }`.
- `useNodePicker`: `ctx.scenes.docs().flatMap((d) => walk(d.nodes).map((n) => `${d.id}/${n.id}`))` (`walk` recursive over `children`).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/ide-client` green; typecheck. Commit `A Symbols document: rows, states, drops, Properties`.

---

### Task 7: The live canvas in the Symbols document

**Files:**
- Modify: `engine/ide/client/src/shell/SymbolsDocument.tsx` (the centre column)
- Test: `engine/ide/client/tests/symbols-document.test.tsx` (extend; the iframe's `contentWindow.postMessage` stubbed as `scene-document.test.tsx:162-180` does)

**Interfaces:**
- Consumes: `createCanvasRpc` (`shell/canvas-rpc.ts`), `useWorkspace`/`useGameComposition` (as `SceneDocument.tsx:231-236`), the wire of Task 4.

Implementation notes:
- One iframe `title="symbol canvas"` `src={`${previewUrl}/editor.html?symbol=${encodeURIComponent(selected?.id ?? '')}`}` keyed on `${reloads}:${workspace.active}:${previewUrl}` — NOT on the selection (a selection change is a `symbol` call, not a reload); sized `design.width × design.height` with the same `fit` scaling as `SceneDocument` (extract nothing; ~20 lines duplicated is fine — mark it `ponytail:`). Handlers: `ready` → `tell('replaceSymbols', { doc })` then `tell('symbol', selected)`; `ctx.symbols.subscribe` → on doc change `replaceSymbols`, on selection change `symbol` (skip when `selected === null`: the canvas keeps the last preview). `symbol-replay` button → `tell('symbol', selected)`. `error` event → `symbols-status`. "canvas unavailable: no project open" when `previewUrl === null`.
- Tests: on mount with a selection, after a simulated `ready` event (post an `e8:ide:evt` message from the iframe's window as the scene-document test does), `replaceSymbols` then `symbol` were posted in that order; a chip click posts `symbol`; a doc frame posts `replaceSymbols`; Replay posts `symbol` again.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/ide-client` green; typecheck; rebuild the IDE bundle (`npm run build -w @energy8engine/ide-web`). Commit `The Symbols document renders the selected state live`.

---

### Task 8: `@energy8engine/flow-fx` — `tween` and `sound`; the example's click

**Files:**
- Create: `engine/game/flow-fx/{package.json,tsconfig.json,vitest.config.ts}` (copy `engine/game/node-media/`'s; name `@energy8engine/flow-fx`; deps `@energy8engine/flow`, `@energy8engine/scenes`, `@energy8platform/game-engine`, `@pixi/sound`, `cordis`, `schemastery`), `src/tween.ts`, `src/sound.ts`, `src/runtime.ts` (`name = 'flow-fx'`, `inject = ['flowNodes']`, `apply`: `ctx.effect(() => ctx.flowNodes.register(createTween()), 'flow-fx:tween')`, same for `createSound()`), `src/schema.ts`, `src/index.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (`fx1` after `flow1`), `engine/templates/slot-basic/flow.yml` ≡ `engine/examples/first-slot/flow.yml` (node `{ id: click, kind: sound, props: { src: assets/spin.wav }, ui: { x: 580, y: 80 } }`; `spin` → `x: 760`, `draw` → `x: 940`; edges `idle → click`, `click → spin`, `spin → draw`, `draw → idle`, `start → base`, `base → idle`), `package.json` ×2 (`@energy8engine/flow-fx`), `README.md` ×2 (a sentence), `engine/ide/host/tests/template.test.ts` (pin `assets/spin.wav`)
- Create: `assets/spin.wav` ×2 — a Node script in your scratchpad writes a 44-byte RIFF/WAVE header + 800 samples of a 880 Hz sine at 8000 Hz mono 16-bit (amplitude 12000); same bytes in both projects
- Test: `tests/tween.test.ts`, `tests/sound.test.ts`, `tests/runtime.test.ts`; `engine/apps/web/tests/e2e/flow.spec.ts` premise (if it counts the example's nodes/edges or their `ui`, update it — read it; do not run it here)

**Produces:**

```ts
export function createTween(deps?: { to?: typeof Tween.to; kill?: typeof Tween.killTweensOf }): FlowNodeKind<TweenProps>;   // defaults to the legacy Tween
export function createSound(deps?: { from?: (url: string) => SoundLike }): FlowNodeKind<SoundProps>;                 // defaults to Sound.from({ url, preload: true })
interface SoundLike { play(o: { loop: boolean; volume: number; complete?: () => void }): unknown | Promise<unknown>; stop(): void; destroy(): void }
```

Implementation notes:
- `tween.run(p, { ctx, signal, report })`: `const [scene, ...rest] = p.target.split('/'); const node = rest.join('/')`; `const view = (ctx.reflect.get('scenes', false) as ScenesService | undefined)?.view({ scene, node })`; missing → `report(`node ${p.target} is not on stage`)` and `{ out: 'next' }`. Props map: `x`, `y`, `alpha`, `rotation` as is; `scale` → `'scale.x'` and `'scale.y'`; undefined ones dropped; none set → `report('tween has nothing to animate')`, `next`. `const done = deps.to(view, props, p.ms, Easing[p.easing])`; `wait === false` → return at once; else `await Promise.race([done, aborted(signal)])` where abort → `deps.kill(view)` and rethrow `signal.reason`. `easing` schema: `Schema.union(Object.keys(Easing).filter((k) => typeof Easing[k] === 'function'))`.
- `sound.run`: `cache: Map<string, SoundLike>` in the closure (`createSound` is called once per apply; the runtime's `ctx.effect` disposer destroys every cached sound). `action === 'stop'` → `cache.get(src)?.stop()`, `next`. `play`: `try { const s = cache.get(src) ?? deps.from('/' + src); cache.set(src, s); if (!p.wait) { void s.play({ loop, volume }); return next } await new Promise((resolve, reject) => { const instance = s.play({ loop, volume, complete: resolve }); signal abort → (await instance).stop?.() and reject(signal.reason) }) } catch (e) { report(`sound ${src}: ${message}`); }` → `next`. Import `@pixi/sound` lazily inside the default `from` (`await import`)? No — `sound.ts` imports `{ Sound } from '@pixi/sound'` statically; the row is not composed on the host. `src` schema `.extra('asset', ['mp3', 'ogg', 'wav', 'm4a'])`.
- Tests: `createTween({ to: vi.fn(() => Promise.resolve()), kill })` on a ctx with a fake `scenes.view`; `createSound({ from })` with a fake whose `play` records options and calls `complete` on demand.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/flow-fx -w @energy8engine/ide-host` green; typecheck. Commit `tween and sound as flow kinds; the example clicks before it spins`.

---

### Task 9: Prove it in a browser

**Files:**
- Create: `engine/apps/web/tests/e2e/symbols.spec.ts`, `engine/apps/web/tests/e2e/fx.spec.ts` (harness from `media.spec.ts`: `projectCopy`, `startDevHost`, `frameOf`, `readyCanvas` generalised to a selector + the `ready` event)
- Modify: premises in existing specs that the fixture changes break (`flow.spec.ts` node count/positions — if Task 8 did not already; `scenes.spec.ts`/`canvas.spec.ts` if they enumerate assets or the tree)

Cases:
- `symbols.spec.ts`: (1) Symbols tab → rows `1`..`6`, chip `symbol-chip-1-win` reads `spritesheet`, no ghosts; (2) drop `assets/coin.json` (`text/x-e8-path`) onto `symbol-chip-2-win` → `symbols.yml` matches `/id: '2'[\s\S]*?win:\n\s+type: spritesheet\n\s+props:\n\s+sheet: assets\/coin\.json\n\s+loop: false/`, then the symbol canvas (`iframe[title="symbol canvas"]`) `snapshot()` → `{ symbol: '2', state: 'win' }` with `w > 0`, and `frameOf('symbol')` changes within 1 s; (3) the Preview: `__e8.cellArt(0, 0)` is `'Sprite'` after a spin (`__e8.spin()` first — the board is empty at boot), and Properties for chip `1`/`static` shows `src` as a select with `assets/symbols/1.png`.
- `fx.spec.ts`: (1) write the project copy's `flow.yml` before the host starts: `boot → show base_game → tween { target: base_game/logo, x: 100, ms: 200 } → on ui.spin → spin → present → (back to on)`; the preview's `__e8.nodeProps('base_game', 'logo').x` reaches `100` within 5 s; (2) the example flow (unmodified copy): `__e8.spin()` resolves `{ out: 'next' }` and `__e8.flowTrace()` has an entry for node `click` with `out: 'next'`; the flow palette lists `tween` and `sound`.

- [ ] **Step 1:** write both specs. **Step 2:** `cd engine/apps/web && npx playwright test tests/e2e/symbols.spec.ts tests/e2e/fx.spec.ts` green (ports 5679–5681 free, nothing else running). **Step 3:** premise fixes; commit `Prove symbols and fx in a browser`.

---

## Self-review

- Spec coverage: §3.1 T1/T5; §3.2 T2; §3.3 T1; §3.4 T5; §3.5 T1; §4 T3; §5.1–5.2 T6; §5.3 T4+T7; §5.4 T6; §6 T8; §7 T1; §8 T5+T8; §9 all; §10 T5.
- Types: `SymbolState`/`SymbolNode`/`SymbolDef`/`SymbolsDoc` from contracts everywhere; `SymbolHandle.apply/refresh/resize/destroy` (T2) used by T4 through `SymbolsService.preview`; `checkNode` signature identical in T3's two files; wire methods `symbol`/`replaceSymbols`/`snapshot` identical in T4 and T7; `__e8.cellArt`/`nodeProps` defined in T5, read in T9.
