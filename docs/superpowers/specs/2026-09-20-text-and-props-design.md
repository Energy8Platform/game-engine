# Text, live props and taps — design (slice 24)

Date: 2026-09-20. Branch: `feat/slot-webide-cordis`. Answers R4 and two R14
items (a tap to continue; symbol-cell overlays from cell data) of
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
Slices 22 (contract holes) and 23 (sessions, prelude) precede; 25
(tumble/turbo/sound) and 26 (shell, build — with the user) follow.

## 0. Where this sits

Nothing on the canvas can show a number: no node draws text, no flow node
changes a node's prop while the game runs, a symbol's look cannot react to
the data its cell carries (an orb's ×N, a champion's crown), and a flow
cannot wait for a tap. Four additions, each on an existing seam: a `text`
node type; `scenes.setProps` (a live, unsaved patch of a mounted node's
props) driven by a `prop` flow kind; `$cell.<field>` bindings in a symbol
state's props, applied when the reels land; `ui.tap` emitted by the scenes
runtime on a stage pointerdown.

## 1. Goal

A `win` text node on `base_game` shows the spin's win after `present`
(`prop { target: base_game/win, prop: text, value: $result.win }`); a
`free_spins` counter shows `$result.spinsRemaining`; an orb symbol state
with `text: '$cell.multiplier'` shows ×N on the board; a `wait { event:
ui.tap }` holds an intro card until the player taps. The IDE edits all of
it through the existing Properties forms and the flow palette; `first-slot`
gains the `win` readout.

## 2. Non-goals

- A binding language in scene documents (`text: '$result.win'` in a
  `.scene.yml`) — the flow owns run-time data; the `prop` kind is the one
  bridge. Templates/formatting beyond `String(value)` (a `format` prop with
  `{value}` is 26+).
- Rich text, HTML text, text input; localisation (26).
- Symbol overlays beyond a state's own props (badges as separate layers
  come with the symbol editor's next round).
- Persisting a live prop into the document (an `edit` is the IDE's; `prop`
  is the run's).

## 3. `text` node type

A `@energy8engine/scenes` builtin (no assets when `font` is empty):

| prop | schema |
|---|---|
| `text` | `string` default `''` |
| `size` | `number` default `24` |
| `family` | `string` default `'sans-serif'` |
| `fill` | colour string default `'#ffffff'` |
| `weight` | `union(['normal','bold'])` default `'normal'` |
| `align` | `union(['left','center','right'])` default `'left'` |
| `stroke` | colour string default `''` (none) |
| `strokeWidth` | `number` default `0` |
| `wrap` | `number` default `0` (0 = no wrap; else `wordWrapWidth`) |
| `font` | `string` `.extra('asset', ['fnt', 'xml'])` default `''` — a bitmap font; when set, a `BitmapText` with `fontFamily` = the loaded font's name |

`mount` → `new Text({ text, style })` (or `BitmapText`); `update` sets
`text`/`style` in place; common `anchor`/`anchorX`/`anchorY` apply (both
classes have `anchor`); `assets` → `[font]` when set; `assetProps:
['font']`; no `accept`. `once`: none. `__e8edit.frameOf` unaffected; the
canvas picks a text by its bounds like any view.

## 4. Live props — `scenes.setProps` and the `prop` flow kind

```ts
// ScenesService
/** Patches a mounted node's props for THIS mount (not the document): the type's schema re-validates the merge, `update` re-applies, common keys go through `applyCommon`. Cleared by a remount (a document edit, a hot re-apply). Unknown node → false. */
setProps(ref: SceneRef, patch: Record<string, unknown>): boolean;
```

The runtime keeps `live: Map<Entry, Record<string, unknown>>`; `setProps`
merges `patch` over the entry's document props + earlier patches, runs the
type schema (a failure → diagnostic `<scene>/<node>` `prop <k>: <error>`
and `false`), then `type.update?.(view, merged, ctx)` and, for common
keys, `applyCommon(view, merged, type)` (the slice-22 rule: a type's own
`width`/`height` win). `refresh()` uses the merged props too. A remount
drops the entry's patches.

`prop` kind (in `@energy8engine/flow`, built in):

| prop | schema |
|---|---|
| `target` | `string` required `.extra('pick', 'node')` — `<scene>/<node>` |
| `prop` | `string` required — the prop name |
| `value` | `string` default `''` — a literal or a `$path` |

`run`: resolves `value` (a `$path` reads `vars`; a literal string is
coerced by the TARGET's schema: a `number` prop takes `Number(value)`, a
`boolean` takes `'true'`/`'false'`, else the string); `scenes.setProps({
scene, node }, { [prop]: value })`; a missing node or a refused patch →
`report(...)`, `next` (a readout that cannot be set does not stop the
round). `outs: ['next']`. `validateFlow`: a literal `target` naming a node
no scene document has → WARNING (the `sceneIds` list gains node ids: the
host passes `<scene>/<node>` pairs; `null` skips).

## 5. Symbol states bound to cell data

A symbol state's props may hold `'$cell.<field>'` strings (`'$cell.multiplier'`,
`'$cell.symbol'`). `@energy8engine/symbols`: `SymbolView` gains
`bind(data: Record<string, unknown>)` — resolves every `$cell.*` prop of
every mounted wrapper against `data` (missing field → `''`/`0` by the
target prop's schema type, as §4 coerces) and re-runs `type.update`; unbound
at `resolve()` time the placeholders show the schema defaults (a `'$cell.x'`
string is replaced by the default before the first `update`). Bindings are
resolved by the symbols runtime, never by node types.

`@energy8engine/reels` calls it: after `spinTo`, `refill` and `repaint`
settle, for every cell `grid.getCell(col, row).view?.bind?.(cell.data)`
(`GridLike` gains `cols`/`rows` from the reel system's config; `CellLike`
gains `readonly view: SymbolView | null` and `readonly data: CellData`).
Tape symbols during a spin are unbound (the resolver has no data) — the
default look, which is what a spinning reel wants.

## 6. `ui.tap`

The scenes runtime (`@energy8engine/scenes` `runtime.ts`) sets
`app.stage.eventMode = 'static'`, `app.stage.hitArea = app.screen` (kept in
step with `resize`), and on `pointerdown` emits `ui.tap` with `{ x, y }` in
DESIGN units on the flow bus (`ctx.reflect.get('events', false)?.emit`) —
lenient: no flow row, no emit. `scene-edit`'s own `pointerdown` handling
stays (it stops propagation for gizmo hits already; a tap on empty canvas
in the editor also emits — harmless, the editor page runs no `wait`). A
flow waits with `wait { event: ui.tap }`; `on { event: ui.tap }` is a
trigger.

## 7. IDE

- `text` appears in the scene node palette (schema-driven); its `font` is
  an asset select; the Symbols document's `prop-state-type` lists it.
- `prop` appears in the flow palette; `target` uses the existing `node`
  picker; `prop` is a text field (a select over the target type's schema
  keys is a follow-up); `value` a text field.
- The scene canvas: a `text` node's `snapshot` bounds come from pixi's
  text bounds — nothing to add. The Properties form for a symbol state
  shows the state's props as strings; a `$cell.multiplier` value is typed
  by hand (the state form's schema is the node type's — a `text` prop is a
  string, fine; a `number` prop holding `'$cell.multiplier'` fails the
  host's schema check — the host's `checkNode` and the symbols runtime's
  schema pass treat a string that starts with `$cell.` as VALID for any
  prop type, the way the flow's `$path` strings are).

## 8. Bundle, template, example

- `first-slot` ≡ `slot-basic`: `scenes/base_game.scene.yml` gains `{ id:
  win, type: text, props: { text: '', size: 28, fill: '#ffd166', x: 240,
  y: 260, anchor: 0.5, align: center } }` after `coin`; `flow.yml` gains
  `{ id: show_win, kind: prop, props: { target: base_game/win, prop: text,
  value: $result.win }, ui: { x: 940, y: 240 } }` between `draw` and
  `done` (`draw → show_win → done`; `step → draw` unchanged); `README.md`
  one sentence each. `template.test.ts` pins hold (both files pinned).
- `e8.bundle.yml`: nothing new (`text` is a scenes builtin; `prop` a flow
  builtin; the tap is the scenes row's).

## 9. Testing

- scenes: `text` mounts a `Text` with the style, `update` changes text and
  fill in place, `font` → `BitmapText` (a fake loader answering a loaded
  bitmap font — or `assets()` + the `BitmapText` branch guarded by a
  registered font name), `anchor` applies; `setProps` merges, validates,
  re-updates, applies common keys, refuses an unknown node and a bad value
  with a diagnostic, and a remount clears the patch; `ui.tap` emitted on a
  fake stage's `pointerdown` in design units, none without an `events`
  service.
- flow: `prop` resolves a `$path`, coerces to the target's schema type
  (number/boolean/string), reports and passes on a missing node/refusal;
  `validateFlow` warns on an unknown literal target, not on a `$path`.
- symbols: a state `{ type: text, props: { text: '$cell.multiplier' } }`
  shows `''` unbound and `'5'` after `bind({ multiplier: 5 })`; a `number`
  prop bound to a missing field takes `0`; `bind` twice re-updates.
- reels: after `spinTo`/`refill`/`repaint` every cell's view gets
  `bind(cell.data)` (fake grid with `view`/`data`).
- host: `checkNode` accepts `'$cell.x'` for a number prop; `validateFlow`'s
  node-target list from the scene tree.
- client: `prop`'s Properties form renders `target` as the node select and
  `value` as text (the real kind schema, JSON round-trip).
- e2e `text.spec.ts`: (1) the example's `win` text is empty at boot and
  after `__e8.spin()` equals `String(spins().at(-1).result.win)`
  (`__e8.nodeText(scene, node)` hook); (2) a flow copy `boot → show →
  wait { event: ui.tap } → prop { target: base_game/win, prop: text,
  value: tapped }` → the text stays empty, a click on the preview canvas →
  `tapped` (proves the tap reaches the flow); (3) a scene copy with a
  `text` node `{ text: hello, size: 40 }` → `nodeProps` bounds `w > 0` and
  `nodeText` `hello`.

## 10. Debts this opens

`prop` sets one prop per node; a `props` map variant and a `format` come
with the first real HUD. Bitmap fonts ship no example asset. The symbol
form types `$cell.*` by hand.
