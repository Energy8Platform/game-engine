# Contract holes — design (slice 22)

Date: 2026-09-19. Branch: `feat/slot-webide-cordis`. Answers R2, R3, R5,
R6, R7 and two R14 items of
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Slices
23 (sessions), 24 (text + data-bound props), 25 (tumble/turbo/sound) and
26 (the shell and a build) follow; 26 is designed with the user.

## 0. Where this sits

Porting a real game (paper-duel) into the IDE showed six holes in the
contracts that stop ANY real script, not just that one: the step
vocabulary only carries numeric symbol ids while every math emits names;
the spin node cannot name an action or a bet; the scenes runtime ignores
its own `design` in the game page; an image cannot be stretched, tinted or
anchored per axis; a spritesheet needs a generated atlas; there is no
shape or mask. Each is a small, mechanical widening. None changes a
document that exists today.

## 1. Goal

A mechanic hands the board what the math said — `'ROCK'`, `{ symbol:
'ORB', multiplier: 5 }` — and the reels show it; a flow's `spin` names an
action and a bet; a 1920×1080 design plays fitted in a 1280×720 canvas; an
image node stretches to `width`/`height`, tints, anchors per axis, masks
its parent; a grid-strip PNG animates as a `strip` node; a `shape` node
draws a rect/circle. `first-slot` is unchanged and still passes.

## 2. Non-goals

- Sessions, `step`, `roundId` (slice 23); `text`, data-bound props,
  `prop` kind (24); tumble, turbo, skip, sound categories (25); the shell,
  responsive layout, a build (26).
- Per-cell overlays drawn from cell data (needs 24) — this slice only
  CARRIES the data to `CellData`.
- A gizmo for `width`/`height` handles beyond the scale drag mapping.

## 3. Symbol ids as strings, per-cell data (R3)

```ts
// @energy8engine/contracts presentation.ts
/** A cell as the math says it: a symbol id (number or name), or a record carrying the id and whatever else the game keeps per cell. `symbol: null` is an empty cell. */
export interface BoardCell { symbol: string | number | null; [extra: string]: unknown }
export type Board = (number | string | BoardCell)[][];
/** The legacy cell shape `SymbolCell.setData` takes: `symbol` as a string (`String(n)` for a number), the extras spread through. */
export function cellData(cell: number | string | BoardCell): { symbol: string | null } & Record<string, unknown>;
export interface RevealedLine { …; symbol: number | string; … }
```

`isBoard` accepts a finite number, a string, or a record whose `symbol`
is a string, a finite number or `null`. `mechanic.ts`'s `isGrid`
(`SpinShapeRequirement` value check) accepts the same leaves;
`matchesFieldKind('grid', …)` accepts a leaf of `int | float | str |
record` (whatever `spin-parser`'s `FieldType` calls a record — the
implementer reads it). `@energy8engine/reels`' `toCellBoard`, `refill`
and the `remove` re-sync go through `cellData`. `mechanic-classic`/
`cascade`/`reel-step` need no change (the grid passes through). The
Symbols document's "drop onto the empty area" rule accepts ANY non-empty
file stem as a new id (a string id is first-class now); the host's
`known` already stringifies. `__e8.symbols()` is unchanged (reads
`data.symbol`).

## 4. `spin { action, betLevel }` (R2)

`spin`'s schema: `action: Schema.string().default('spin')` (a `$path`
reads a var), `betLevel: Schema.string()` (optional — a numeric literal
like `'5'` or a `$path`; the IDE's number field cannot hold a `$path`, so
the prop is a string and `run` converts a literal with `Number()`, a
non-numeric literal → `report` and the key omitted). `run`
resolves both through `vars` and POSTs `{ action, betLevel }` (undefined
keys omitted). `dev-game.ts`'s route reads `body.action ?? config.action
?? 'spin'` and `body.betLevel ?? config.betLevel`. `validateFlow` gains an
optional `actions: string[] | null` (from `game/spec.json`'s `actions`
keys; `null` = unknown): a `spin` whose literal `action` is not in it →
WARNING `action "<x>" is not in game/spec.json`. The host's flow plugin
reads `game/spec.json` for it the way `symbols.ts` reads `symbols`.

## 5. Design fit in the game page (R5)

`@energy8engine/scenes`' runtime calls `scenes.resize(app.screen.width,
app.screen.height)` right after `createScenes` and again on
`app.renderer.on('resize', …)` (off on dispose). `scene-edit`'s own call
stays (idempotent). The example's `renderer1` and `design` still match, so
nothing moves there.

## 6. Common props (R6 + mask)

`COMMON` gains: `width`, `height` (number, optional — when set, applied
AFTER `scale` as `view.width = …`/`view.height = …`, so one axis can be
stretched), `tint` (`'#rrggbb'` string, default `'#ffffff'`; applied where
`view.tint` exists), `anchorX`, `anchorY` (number, optional; default to
`anchor`), `mask` (boolean, default `false`: the view becomes its parent's
`mask` — the runtime sets `parent.mask = view` after `addChild` and clears
it on unmount; applies to `image` and `shape`, ignored elsewhere with no
diagnostic). `applyCommon` implements all of it. The host's common-vs-own
split (`COMMON_PROPS` in `ide/host/src/plugins/scenes.ts`) follows the
schema. The canvas gizmo: a scale drag on a node that has `width` or
`height` emits `width`/`height` multiplied by the drag factor (each only
when set) instead of `scale` — otherwise the drag would be swallowed.

## 7. `strip` node type (R7)

In `@energy8engine/node-media`, registered by `media1`:

| prop | schema |
|---|---|
| `src` | `string` required, `.extra('asset', ['png','jpg','jpeg','webp','avif'])` |
| `cols`, `rows` | `natural` default `1` |
| `frames` | `number` optional — how many cells count, row-major from the top-left; default `cols × rows` |
| `fps` | `number` default `12` |
| `loop` | `boolean` default `true` |
| `playing` | `boolean` default `true` |

`mount`: `AnimatedSprite` on `[Texture.EMPTY]`; `update` slices the loaded
base texture into `frames` `Texture`s (`new Texture({ source, frame:
new Rectangle(c * w, r * h, w, h) })`, `w = base.width / cols`) when the
asset is there and the slicing inputs changed; speed/loop/play as
`spritesheet`. `once` as `spritesheet`. `assets: [src]`, `assetProps:
['src']`, NO `accept` (a dropped PNG is an `image`; the type select in
Properties keeps `src`). A `cols`/`rows` that does not divide the texture
evenly floors the cell size.

## 8. `shape` node type and `.avif` (R14)

`@energy8engine/scenes` builtin `shape`: `kind` (`union(['rect',
'roundRect', 'circle', 'ellipse'])` default `rect`), `width`, `height`
(number default `100`), `radius` (number default `8`; roundRect corner /
circle radius), `fill` (`'#rrggbb'` or `''` = no fill, default
`'#ffffff'`), `fillAlpha` (default `1`), `stroke` (`''` = none), `strokeWidth`
(default `0`). `mount`: a `Graphics` drawn from `(0,0)` (rect) or centred
(circle/ellipse); `update` redraws. No assets. `image`'s
`IMAGE_EXTENSIONS` gains `'avif'` (pixi's loader detects it); the IDE's
derived drop registration follows; the Explorer's image viewer list gains
it.

## 9. Testing

- contracts: `isBoard`/`isPresentationStep` on numbers, names, records, a
  record without `symbol`, `null` symbol; `cellData` for all three; the
  mechanic value/type checks with a `str`/record leaf.
- reels: `spinTo` with a name board resolves `'ROCK'`; a record cell's
  extras reach `setData`; `remove`'s re-sync keeps extras.
- flow: `spin` posts `{ action, betLevel }` from literals and `$path`;
  omits `betLevel` when unset; the host route forwards both to
  `session.play`; `validateFlow` warns on an unknown action, not on a
  `$path`.
- scenes: the runtime resizes on boot (fake app `screen` 640×360 vs design
  480×288 → container scale 4/3) and on the renderer's `resize`;
  `applyCommon`: `width` alone stretches x, `tint`, `anchorX/Y` default to
  `anchor`, `mask` sets `parent.mask` and unmount clears it; `shape` draws
  each kind (bounds) and redraws on update.
- node-media: `strip` slices 4×1 (frame rects), `frames: 3` of a 2×2,
  plays/stops, `once`, placeholder before load.
- scene-edit: a scale drag on a node with `width` emits `width`.
- host: `COMMON_PROPS` split keeps the schema check green for the new
  props; the flow action warning.
- client: the Symbols drop-new rule with a name stem; the viewer list.
- e2e `contract.spec.ts`: (1) a project copy whose `flow.yml` has `spin {
  betLevel: 5 }` → after `__e8.spin()` the spin log's last request has
  `betLevel: 5` and `action: 'spin'` (`__e8.spinLog()`); (2) a project
  copy whose `e8.patch.yml` sets `renderer1` to 640×360 (design stays
  480×288) → `__e8.stageScale()` is `4/3` in the preview; (3) a copy whose
  `base_game` has a `shape` and an `image` with `width: 100, height: 50,
  tint: '#ff0000'` → `__e8.nodeProps` (extended with `width`, `height`,
  `tint`) reports them.

## 10. Debts this opens

`width`/`height` and the scale gizmo are two ways to size one node; a
future `size` handle replaces the mapping. `mask` is a boolean on the
masked view, not a reference from the masked parent.
