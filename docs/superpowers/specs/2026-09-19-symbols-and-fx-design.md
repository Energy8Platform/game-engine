# Symbols as data + `tween`/`sound` flow kinds — design (slice 21, D2+D3)

Date: 2026-09-19. Branch: `feat/slot-webide-cordis`. Builds on slice 17
(node types), 18 (the canvas, `editor.html`), 19 (the flow), 20 (media
node types, the asset contract). Closes sub-project D.

## 0. Where this sits

The board's art is the one thing a project still holds as CODE: `main.ts`
and `editor.ts` each carry a `resolve(symbolId)` function drawing coloured
squares and hand it to `createGame` as the `assets` service. Everything
else — scenes, node types, the flow — is a `.yml` file the IDE edits and
the game hot-loads. This slice makes symbols data too (`symbols.yml`, a
Symbols document, a `symbols1` row that builds `SymbolView`s out of scene
nodes), and gives the flow two presentation kinds it lacks: `tween` (move
a scene node) and `sound` (play a file).

## 1. Goal

Open Symbols in the IDE, see the six symbols of `game/spec.json`, drop
`assets/symbols/3.png` from the Explorer onto symbol 3's `static` slot and
`assets/coin.json` onto its `win` slot; the document renders the symbol
live, the Preview's board repaints with the new art, a win on the board
plays the coin once. In Flow, add `sound` before `spin` and `tween` after
`present`; the run plays the file and moves the logo. `main.ts` and
`editor.ts` hold no art.

## 2. Non-goals

- Symbol badges (multiplier/bonus), per-reel cell sizes, symbol weights or
  paytable (the mechanic's business), writing `game/spec.json`.
- Audio bus, global mute, music ducking, sound preloading before the first
  play (debt), sound sprites.
- Tween chains/timelines (sequence nodes instead), tweening symbols on the
  board, tweening flow vars.
- Idle animations on the legacy grid: `ReelGrid` never calls
  `SymbolCell.playIdle`, so `idle` here is "the resting look when present"
  (see §3.2), not a state the grid drives.
- Lottie, After-Effects, a real Spine symbol in the example.

## 3. `symbols.yml`

### 3.1 Shape

```yaml
version: 1
symbols:
  - id: '1'
    name: cherry
    fit: contain            # contain (default) | none
    static: { type: image,       props: { src: assets/symbols/1.png } }
    idle:   { type: spritesheet, props: { sheet: assets/symbols/1_idle.json } }   # optional
    win:    { type: spritesheet, props: { sheet: assets/coin.json, loop: false } } # optional
```

```ts
// @energy8engine/contracts
export interface SymbolNode { type: string; props: Record<string, unknown> }   // a SceneNode without id/children
export interface SymbolDef { id: string; name?: string; fit?: 'contain' | 'none'; static: SymbolNode; idle?: SymbolNode; win?: SymbolNode }
export interface SymbolsDoc { version: 1; symbols: SymbolDef[] }
```

`id` is the string the board's `Board` (`number[][]`) maps to with
`String(id)` — `'1'`..`'6'` for the example. A state is any registered
node type with its own props; the common props (`x y anchor scale rotation
alpha visible`) apply inside the state's wrapper (§3.2), so a symbol can
be nudged without new art.

### 3.2 `@energy8engine/symbols` — row `symbols1`

`inject = []` (see §3.4 for why), config `{}`. Provides TWO services:

- `assets: { resolve(symbolId): SymbolView }` — the legacy contract
  `reels1` and `reel-step` already read off `ctx`. Unchanged consumers.
- `symbols: SymbolsService`:

```ts
interface SymbolsService {
  replace(doc: SymbolsDoc | null): void;   // hot; loads every state's assets, refreshes live views, repaints the board
  doc(): SymbolsDoc | null;
  ready: Promise<void>;                     // the boot GET landed (or failed)
  /** A fresh view of one state for the Symbols document's canvas (§5.3); `null` when the symbol or state is absent. */
  preview(id: string, state: 'static' | 'idle' | 'win', size: { width: number; height: number }): Container | null;
}
```

**A `SymbolView`** (`resolve(id)`) is a `Container` centred on `(0, 0)`
— the legacy `SymbolCell` draws its frame from `-w/2` and calls
`resize({ width, height })` with the cell size — holding one *state
wrapper* at a time:

- *wrapper* = `Container` → `nodeTypes.get(state.type).mount(props, ctx)`
  as its child, with `applyCommon(child, props)` (exported from
  `@energy8engine/scenes`), then `type.update?.(child, props, ctx)` (the
  slice-20 placeholder rule: the view fills once the asset is loaded).
- *fit*: after every `update` and every `resize`, `fit: contain` scales
  the wrapper by `min(w / bounds.width, h / bounds.height)` and pivots it
  to the bounds' centre (`getLocalBounds()` of the child; a zero-size
  placeholder is skipped); `fit: none` only centres.
- at rest the view shows `idle ?? static`. When the def has `win`, the
  view defines `playWin()`: hide the rest wrapper, mount a `win` wrapper,
  `await type.once?.(child, props, ctx)` (§3.3) — a type without `once`
  holds 600 ms — then unmount `win` and show the rest wrapper again.
  Without `win` the view defines NO `playWin`, so the legacy
  `SymbolCell.playWin` falls through to its own scale pop. `showStatic()`
  unmounts a `win` in flight.
- `destroy()` unmounts every wrapper (`type.unmount?.`) and drops the
  view from the runtime's live set.
- **unknown id** (not in the doc, or no doc yet): the coloured box with
  the id as text that `main.ts` draws today, moved here as the fallback,
  plus one diagnostic per id per doc (`symbols/<id>`: `no symbol "<id>" in
  symbols.yml`). The example keeps working with no art.
- **unknown node type** in a state: the wrapper stays empty; diagnostic
  `symbols/<id>/<state>`: `unknown node type "<type>"` once per replace.

**Live set + refresh.** The runtime keeps every resolved view in a `Set`
(removed on `destroy`). `replace(doc)`:
1. `assetLoader.load(all states' type.assets?.(props))` (lenient
   `ctx.reflect.get('assetLoader')` — the scenes row provides it; a load
   failure is one diagnostic and the state stays a placeholder);
2. for each live view: remount its wrappers from the new doc (a symbol
   whose def is JSON-equal keeps its wrappers — an animation in flight
   is not restarted), refit;
3. `ctx.reflect.get('board', false)?.repaint?.()` (§3.5) so the Preview
   shows the new art on the cells that exist now, not on the next spin.
`replace(null)` clears the doc; live views fall back to the box.

**Boot**: `GET /api/symbols` (same fetch as the scenes' boot GET; `ready`
resolves after) and `replace(doc)`; a `replace` from the bridge or the
canvas parent that lands first wins (the GET's answer is dropped — the
scenes rule).

### 3.3 `NodeType.once`

```ts
// @energy8engine/scenes
export interface NodeType<P> {
  …
  /** Plays the node's animation once from the start; resolves when it ends. Absent on a type with nothing to play. */
  once?(view: Container, props: P, ctx: Context): Promise<void>;
}
```

`spritesheet`: `loop = false; gotoAndPlay(0)`, resolve on `onComplete`
(a sheet with one frame resolves at once). `spine`: `state.setAnimation(0,
animation, false)`, resolve on the track's `complete` listener. `gif`:
`loop = false; currentFrame = 0; play()`, resolve on `onComplete`.
`video`: `currentTime = 0; play()`, resolve on `ended`. `image`,
`container`, `scene`, `reels`: no `once`. A view not yet filled (asset not
loaded) resolves at once. `once` is runtime-only — not in `NodeTypeInfo`.

### 3.4 Composition

`e8.bundle.yml`: `symbols1` between `spine1` and `reels1`. `reels1` reads
`assets` at apply time and throws without it, so `symbols1` provides both
services synchronously in `apply` — no `ctx.inject`; `nodeTypes`,
`assetLoader`, `board` are read leniently per call (all three rows are
earlier or later in the same bundle and present at run time).

`main.ts` and `editor.ts` drop `resolve`, `COLORS`, `CELL` and `provide:
{ assets }` (both files in `slot-basic` and `first-slot`, byte-identical,
pinned). `createGame({ mount })` only. `reel-step`'s own `assets` check
is unchanged.

### 3.5 `reels` additions

`ReelsBoard` gains `repaint(): void` — `reelSystem.setBoard(reelSystem.board)`
(measured synchronous; `SymbolCell.setData` destroys and re-resolves every
view) — and `cellSize: { width: number; height: number }` from the reel
system's `config.grid.cellSize` (a number; `cellSizePerReel` is out of
scope). Both on the guarded board; `repaint` after `destroy` is a no-op.

## 4. Host

`plugins/symbols.ts`, the shape of `flow.ts`:

- `GET /api/symbols` → `{ doc: SymbolsDoc | null, known: { id: string;
  name: string }[], diagnostics }` — `known` from `game/spec.json`'s
  `symbols` (`[]` when absent). `doc: null` when the file is missing (not
  an error: a project without symbols draws boxes).
- `PUT /api/symbols` `{ doc }` → validates, writes `symbols.yml`, answers
  `{ diagnostics }`; refused (400 + diagnostics) on an error-level check.
- **Checks** (`plugin: symbols`, `where: symbols/<id>[/<state>]`):
  `version` is `1`; `id` non-empty string, unique; `static` present;
  every state's `type` is a reported node type (gated on the game's
  `node-types` report, as scenes are) and its props pass the type's
  schema; every `assetProps` prop names a file in the tree, `sibling`
  derived — the SAME check `checkScenes` runs per node, extracted into
  `checkNode(where, node, info, hasFile)` in `scenes.ts` and imported;
  WARNING `symbol <id> (<name>) has no entry` for each `known` id absent
  from the doc; WARNING `symbol <id> is not in game/spec.json` for the
  reverse (spec present only).
- `files/written` of `symbols.yml` → re-read, re-check, and the bridge's
  `symbols` frame (`{ type: 'symbols', doc, diagnostics }`) to every
  client; the game side `replace`s (ide-bridge accepts `symbols` next to
  `flow`/`scenes`). The IDE's `GET /api/symbols` at open; the frame keeps
  it current.

## 5. IDE

### 5.1 `plugins/symbols.tsx` — `ctx.symbols`

```ts
interface SymbolsClientService {
  doc(): SymbolsDoc | null;
  known(): readonly { id: string; name: string }[];
  diagnostics(): readonly Diagnostic[];
  selected(): { id: string; state: 'static' | 'idle' | 'win' } | null;
  select(sel: … | null): void;             // mutual deselect with scenes/flow, as flow does
  update(doc: SymbolsDoc): Promise<Diagnostic[]>;   // PUT; reducer-chained like flow-graph (each write reduces the latest doc)
  subscribe(fn: () => void): () => void;
}
```

Activity entry `Symbols` (`order: 37`, icon `symbol-misc`), document
`symbols` (not closable, like Flow), `shell.sideRight` `symbols` shown
while a selection exists.

### 5.2 `SymbolsDocument.tsx`

Three columns, the Flow/Scene document's chrome:

- **Left — the list.** One row per symbol in the doc: id, name, three
  state chips (`static` `idle` `win`; filled = present, showing the
  node's type). Click a chip selects `{ id, state }`. Below: the `known`
  ids not yet in the doc as ghost rows with **Add** (creates `{ id, name,
  static: { type: 'image', props: { src: '' } } }`); an **Add symbol**
  input for a free id; a row's **⋯** → Remove symbol, Clear state.
- **Drop from the Explorer** onto a chip: `ctx.assetNodeTypes.pick(path,
  tree)` → the state becomes `{ type, props: { [accept.prop]: path } }`
  (no `x/y`), `win` adds `loop: false` when the type's schema has `loop`.
  Drop on a symbol row = its `static`. Drop onto empty space below the
  list = a new symbol whose id is the file's stem when it is a `known`
  id or numeric, else refused with a status line ("drop onto a symbol").
- **Centre — the canvas.** `editor.html?symbol=1` in the same iframe
  chrome as the scene canvas (`canvas-rpc`); §5.3. A **Replay** button
  re-shows the selected state.
- **Right — Properties** (`shell.sideRight`): the symbol's `name` and
  `fit`; then the selected state's node: a `type` select over the
  reported types with `accept` (`image` first) and the type's
  `SchemaForm` (asset fields as file selects — slice 20). Changing the
  type keeps props the new schema also has.

Diagnostics for `symbols/*` paint the row/chip, as the scene tree does.

### 5.3 The canvas in symbol mode — `@energy8engine/scene-edit`

`editor.ts` (both projects) passes `symbol: params.get('symbol') ?? ''`
next to `scene`. With `config.symbol` set, `scene-edit`:
- shows no scene, arms no gizmo, no grid, no keyboard;
- `wire.handle('symbol', { id, state })` → `ctx.symbols.preview(id,
  state, board.cellSize ?? { width: 96, height: 96 })` (lenient reads),
  placed at the design centre inside a cell outline (`roundRect` stroke of
  the cell size, the legacy idle frame's look) — the previous preview
  destroyed; `{ shown: boolean }` back;
- `wire.handle('replaceSymbols', { doc })` → `symbols.replace(doc)`, then
  re-shows the current `{ id, state }`;
- emits `ready` after `symbols.ready`, `snapshot` answers `{ symbol: id,
  state, w, h }` of the preview's bounds (the e2e reads it);
- `__e8edit.frameOf('symbol')` reaches the preview's `AnimatedSprite`.

The IDE side: on `ready`, `replaceSymbols` with the current doc (the
parent is the source after the boot GET — the scene rule), `symbol` on
every selection change and after every `replaceSymbols`.

### 5.4 Pickers

`Pickers` gains `node(): string[]` — every `<scene>/<node>` of every scene
doc, nested nodes included, for `pick: 'node'` (used by `tween.target`).

## 6. `@energy8engine/flow-fx` — row `fx1`

`inject = ['flowNodes']`, config `{}`, after `flow1`. Two kinds:

**`tween`** — `target` (`string` required, `.extra('pick', 'node')`,
`"<scene>/<node>"`), `x y scale rotation alpha` (`number`, each
optional; only the set ones animate; `rotation` in radians, the
scene's unit), `ms` (`number` default `300`), `easing` (`union` of the legacy
`Easing` keys, default `easeOutQuad`), `wait` (`boolean` default `true`).
`run`: `target` split on its first `/` → `scenes.view({ scene, node })`
(extended to find nested nodes — §7); a missing view → `report('node <target> is not on stage')` and
`next`; `Tween.to(view, { x, y, 'scale.x', 'scale.y', rotation, alpha }, ms,
Easing[easing])` from
`@energy8platform/game-engine/animation`; `wait: true` awaits it, `false`
returns at once; `signal` abort → `Tween.killTweensOf(view)`. `outs:
['next']`.

**`sound`** — `src` (`string` required, `.extra('asset', ['mp3', 'ogg',
'wav', 'm4a'])`), `action` (`union(['play', 'stop'])` default `play`),
`loop` (`boolean` default `false`), `volume` (`number` default `1`),
`wait` (`boolean` default `false`). `run`: `@pixi/sound`'s `Sound.from({
url: '/' + src, preload: true })` cached per `src` in the row (disposed on
row dispose); `play` → `sound.play({ loop, volume })`, `wait: true` awaits
the instance's `end`; `stop` → `sound.stop()`. A load/play failure (no
`AudioContext`, autoplay refused, 404) → `report(...)` and `next` — a
silent game is not a stopped game. `signal` abort while waiting → stop
the instance. `outs: ['next']`.

Both reach services leniently (`ctx.reflect.get`), like the built-ins.
The IDE needs nothing per kind: the palette, node, Properties (`pick:
'node'` §5.4, `asset` select) come from `flow-kinds`.

## 7. `scenes.view` finds nested nodes

`ScenesService.view(ref)` answers any node of a mounted scene by id
(top-level first, then the depth-first entries) — today it answers
top-level only. Node ids are unique per document (the host checks).

## 8. Bundle, template, example

- `e8.bundle.yml`: `symbols1` (`@energy8engine/symbols`) after `spine1`,
  before `reels1`; `fx1` (`@energy8engine/flow-fx`) after `flow1`.
- `first-slot` ≡ `slot-basic`: `symbols.yml` with ids `1`..`6` (names
  from `spec.json`), `static` = `assets/symbols/<id>.png` — six 64×64
  script-generated PNGs (distinct colour and shape per id), `win` on `1` =
  `{ type: spritesheet, props: { sheet: assets/coin.json, loop: false } }`;
  `flow.yml` gains `{ id: click, kind: sound, props: { src:
  assets/spin.wav } }` between `idle` and `spin` (`assets/spin.wav`: a
  script-generated 100 ms 880 Hz sine, 8 kHz mono 16-bit); `main.ts` and
  `editor.ts` per §3.4; `package.json` adds `@energy8engine/symbols`,
  `@energy8engine/flow-fx`; `README.md` names the two files.
  `template.test.ts` pins `symbols.yml`, the six PNGs, `spin.wav`.
- `ide-bridge` accepts the `symbols` frame; the preview `/ide` accept
  list gains `symbols`.

## 9. Testing

- `symbols` (headless pixi, fake `nodeTypes` with `image`/`spritesheet`
  and a fake loader): `resolve` before a doc = box + one diagnostic; after
  `replace` = the `static` wrapper, fitted to `resize`; `idle` wins at
  rest; `playWin` mounts `win`, awaits `once`, restores; no `playWin`
  property without `win`; `replace` keeps an equal def's wrapper,
  remounts a changed one, calls `board.repaint`; `preview` returns a
  fitted container and `null` for an absent state; unknown type
  diagnostic once; `destroy` leaves the live set.
- `scenes`: `once` on `spritesheet`/`gif`/`video` (node-media) and
  `spine` (node-spine) resolve on completion; `view` finds a nested node.
- `reels`: `repaint` re-resolves every cell (fake reel system counts
  `setBoard`); `cellSize` from config; both refuse after `destroy`.
- `flow-fx`: `tween` moves a fake view over fake ticks and resolves;
  `wait: false` returns before; abort kills; missing node reports and
  passes; `sound` with a fake `Sound` (injected factory) plays with
  `loop/volume`, `wait` awaits `end`, `stop` stops, a throwing factory
  reports and passes.
- host: GET shape with/without the file, `known` from `spec.json`; each
  check; PUT refused on error, written on warning; `files/written` →
  `symbols` frame; `checkNode` shared with scenes (scenes tests unchanged).
- client: `symbols` service (frames, update chain, mutual deselect);
  document renders rows/chips/ghosts; drop → state via `pick`; type
  change keeps shared props; `Pickers.node` lists nested ids.
- e2e `symbols.spec.ts`: open Symbols → six rows; drop `assets/coin.json`
  onto symbol 2's `win` chip → `symbols.yml` has it, the canvas `snapshot`
  shows `{ symbol: '2', state: 'win' }` with non-zero bounds and
  `frameOf('symbol')` moves; the Preview's board shows PNG art (a cell's
  child is a `Sprite`, read through `__e8`). e2e `fx.spec.ts`: a flow with
  `tween` on `base_game/logo` (`x: 100, ms: 200`) after `boot` → the
  logo's `x` reaches 100 in the preview; the example flow's `sound` node
  appears in the trace with `out: next` (no audio assertion).

## 10. Debts this closes

Slice 17's "art lives in `main.ts`" (the `assets` service note in
`reels`' runtime doc — "tomorrow it can be an `assets` ROW"); slice 19's
D3 placeholder; the `editor.ts`/`main.ts` duplicated placeholder art.
