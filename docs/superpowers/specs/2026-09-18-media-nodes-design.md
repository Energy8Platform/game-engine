# Media node types — design (slice 20, sub-project D1)

Date: 2026-09-18. Branch: `feat/slot-webide-cordis`. Builds on slice 17
(node types, `@energy8engine/scenes`), 18 (the canvas, `assetNodeTypes`),
19 (the flow). D2 (symbols as data) and D3 (`tween`/`sound` flow kinds)
follow.

## 0. Where this sits

A scene can hold `container`, `image`, `scene`, `reels`. The user's UC5:
symbols and animations — spine, spritesheets, After-Effects exports —
"through plugins". This slice adds four animated node types as two
plugin packages and makes the asset side of a node type DATA that
travels with the type: which files it accepts, which props hold paths.
The canvas, Properties, the host checks and the drop mapping then work
for any type a plugin registers, with no IDE-side code per type.

## 1. Goal

Drop a `.skel`, a spritesheet `.json`, an `.mp4` or a `.gif` from the
Explorer onto the canvas → the right node appears and animates there and
in the game; its animation/loop/fps are edited on the right; the host
reports a missing file. A project replaces any of the four by
registering the same type id (last-wins), or removes the row.

## 2. Non-goals

- Symbols (D2), `tween`/`sound` (D3), Lottie/After-Effects JSON.
- Spine events/mixes/skins editor (only `skin` as a string).
- Audio on `video` (always `muted` unless a project plugin says otherwise
  — browsers refuse autoplay with sound).
- Generating a real Spine asset for the example (unit-tested on a minimal
  hand-written skeleton; the example ships a spritesheet).

## 3. Node types

### 3.1 `@energy8engine/node-spine` — row `spine1`

`inject = ['nodeTypes']`, config `{}`, registers `spine`:

| prop | schema | meaning |
|---|---|---|
| `skeleton` | `string` required, `.extra('asset', ['skel', 'json'])` | project-relative `.skel` or Spine `.json` |
| `atlas` | `string` (empty → same stem + `.atlas`) `.extra('asset', ['atlas'])` | |
| `animation` | `string` (empty → the skeleton's first) | |
| `loop` | `boolean` default `true` | |
| `skin` | `string` (empty → default skin) | |
| `speed` | `number` default `1` | `timeScale` |

`mount`: `Spine.from({ skeleton, atlas })` (the `spine-pixi-v8` asset
parsers are registered by importing the package; `Assets.load` of both
paths happens in `scenes.show` through `assets()`), then
`state.setAnimation(0, animation, loop)`, `skeleton.setSkinByName(skin)`.
`update`: animation/loop/skin/speed in place. `assets(props)` →
`[skeleton, atlas || stem + '.atlas']`. `accept: { extensions: ['skel',
'json'], prop: 'skeleton', sibling: 'atlas' }`, `assetProps: ['skeleton',
'atlas']`.

### 3.2 `@energy8engine/node-media` — row `media1`

`inject = ['nodeTypes']`, config `{}`, registers three:

**`spritesheet`** — `sheet` (`string` required, `.extra('asset', ['json'])`),
`animation` (`string`, empty → the sheet's first `animations` key; a sheet
with no `animations` → all frames in name order), `fps` (`number` default
`12`), `loop` (`boolean` default `true`), `playing` (`boolean` default
`true`). `mount`: `Assets.get(sheet)` is a `Spritesheet`; `new
AnimatedSprite(frames)`, `animationSpeed = fps / 60`, `loop`, `play()` when
`playing`. `update`: swap textures / speed / loop / play-stop. `assets` →
`[sheet]` (pixi loads `meta.image` beside it). `accept: { extensions:
['json'], prop: 'sheet' }`, `assetProps: ['sheet']`.

**`video`** — `src` (`.extra('asset', ['mp4', 'webm'])`), `loop` default
`true`, `muted` default `true`, `autoplay` default `true`. `mount`:
`Sprite` from `Assets.get(src)` (a `VideoSource` texture; set
`source.loop/muted/autoPlay` before `play()`). `assets` → `[src]`.
`accept: { extensions: ['mp4', 'webm'], prop: 'src' }`.

**`gif`** — `src` (`.extra('asset', ['gif'])`), `loop` default `true`,
`speed` default `1`. `mount`: `import 'pixi.js/gif'`; `new GifSprite({
source: Assets.get(src), loop, animationSpeed: speed })`. `accept: {
extensions: ['gif'], prop: 'src' }`.

Every `mount` that finds no loaded asset (`Assets.get` undefined) returns
an empty `Container` and the `image` rule applies: `show` reported the
load failure already; `update` re-runs after `refresh()` (slice 17) and
fills the view in when the asset lands.

### 3.3 `image` joins the mechanism

`image` gets `accept: { extensions: ['png','jpg','jpeg','webp'], prop:
'src' }`, `assetProps: ['src']`, and `.extra('asset', ['png','jpg','jpeg',
'webp'])` on `src`. The IDE's hard-coded `image` registration and the
host's `node.type === 'image'` special case go.

## 4. The asset contract on a node type

```ts
// @energy8engine/scenes
export interface NodeType<P> {
  …
  /** What a dropped file becomes: a node of this type with `prop` = the path. `sibling`: the drop also needs `<stem>.<sibling>` in the project (spine's atlas). */
  accept?: { extensions: string[]; prop: string; sibling?: string };
  /** Props that hold project-relative paths — the host checks they exist. */
  assetProps?: string[];
}
// @energy8engine/contracts
export interface NodeTypeInfo { type: string; schema: unknown; accept?: …; assetProps?: string[] }
```

`ide-bridge` forwards both fields in `node-types`. Schema meta
`asset: string[]` (extensions) is declared on `Schemastery.Meta` next to
`pick`.

## 5. Host

`checkScenes` replaces the `image.src` case with: for every node whose
type reports `assetProps`, each such prop that is a non-empty string must
name a file in the tree (error `<scene>/<node>`: `<type>.<prop>
"<path>" is not in the project`); an empty string → `<type> has no
<prop>` (the current wording generalised). For `spine`, an empty `atlas`
resolves to `<stem>.atlas` before the check. The `unknown type` check and
the schema check are unchanged.

## 6. IDE

- `assetNodeTypes` registrations are DERIVED from the reported node
  types: on every `node-types` change, for each type with `accept`,
  register `{ extensions, node: (path, at) => ({ type, props: { [prop]:
  path, x, y, anchor: 0.5 } }), sibling }`; the built-in `image` entry is
  gone. `pick(path, tree)`: among the registrations whose `extensions`
  match, prefer one whose `sibling` exists beside the path (same stem),
  else one with no `sibling`; `.json` with a `.atlas` beside it → `spine`,
  without → `spritesheet`. `AssetNodeTypesService.pick` gains the tree
  (`ctx.files.tree()` cached from the Explorer's last fetch) — the
  `SceneDocument` drop handler already has `ctx.files`.
- `SchemaForm`: a string field whose meta has `asset: string[]` renders a
  `<select>` of project files with those extensions (`Pickers` gains
  `asset: (exts: string[]) => string[]`, supplied by `PropertiesSidebar`
  from `ctx.files.tree()`), plus the current value and an empty option —
  the same shape as the `scene` pick.
- The canvas needs nothing: the editor page composes `spine1`/`media1`
  from the same bundle, so a dropped spritesheet animates on the canvas.
- `moveNode` (flow) and the scene canvas' `edit` round `ui`/positions to
  integers.

## 7. Bundle, template, example

- `engine/bundles/e8-base/e8.bundle.yml`: `media1` and `spine1` after
  `scenes1` (they inject `nodeTypes`; order is not load-bearing).
- `first-slot`/`slot-basic`: `assets/coin.json` + `assets/coin.png` — a
  4-frame 32×32 spritesheet generated by a script (four coloured discs
  with a highlight moving), `meta.image: coin.png`, `animations.spin:
  [coin0..coin3]`; `scenes/base_game.scene.yml` gains `{ id: coin, type:
  spritesheet, props: { sheet: assets/coin.json, x: 40, y: 40, fps: 8 } }`
  after `logo`. `package.json`: `@energy8engine/node-media`,
  `@energy8engine/node-spine`. `template.test.ts` pins the two files.

## 8. Testing

- `node-media` (headless pixi; a fake `Assets` with a `Spritesheet` built
  from a `Texture.EMPTY` base and a hand-written frames map; a fake
  `VideoSource`-like texture; the gif source faked): each `mount`'s view
  shape and props, each `update` in place, `assets()`, `accept`,
  the empty-view fallback.
- `node-spine` (headless): `mount` on a minimal skeleton JSON (one bone,
  one slot, one attachment, one animation) + an atlas text referencing a
  1×1 PNG — measured in a spike before the plan; if `Spine.from` needs a
  renderer, the test asserts the registration, `assets()` (atlas
  derivation) and `accept`, and the mount is proven by the e2e only.
- scenes: `accept`/`assetProps` on `image`; contracts + ide-bridge forward
  the new fields.
- host: the generic `assetProps` check replaces the image test; spine
  atlas derivation; the `unknown type` path unchanged.
- client: derived `assetNodeTypes` from a `node-types` frame (sibling
  rule, `.json` disambiguation, last-wins on re-report); `asset` picker
  in `SchemaForm`; drop of `coin.json` → a `spritesheet` node.
- e2e `media.spec.ts`: drop `assets/coin.json` from the Explorer onto the
  canvas → `spritesheet-1` in the file, the canvas' `__e8edit.snapshot()`
  lists it, and after 500 ms the frame index moved (`__e8edit` gains
  `frameOf(node)` for `AnimatedSprite` views); Properties shows `fps`;
  the Preview shows the coin on `base_game`.

## 9. Debts this closes

Slice 17 debt 2 (the pixi `Assets` adapter, already closed by `logo.png`)
gains a second real asset kind; the fixture's dirty `ui` floats (rounding).
