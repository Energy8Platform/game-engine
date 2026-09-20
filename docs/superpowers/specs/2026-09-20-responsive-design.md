# Responsive layout — design (slice 27)

Date: 2026-09-20. Branch: `feat/slot-webide-cordis`. Answers R11 of
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
Designed with the user. Slice 26 (shell, session, build) precedes.

## 0. Where this sits

The canvas is a fixed `renderer1.config.width × height`; the scenes fit
one design box into it (`fitStage`, `contain`/`cover`: one scale, centred);
every node sits at absolute design coordinates; the shell draws in canvas
pixels and reports `safeArea = { bottom: barHeight }` that nothing reads.
A game that must fill a phone in portrait and a desktop in landscape has
no way to say so: paper-duel scaled a 1920×1080 canvas with CSS and laid
its HUD out by hand from `(w, h)`. Three additions on existing seams: the
renderer follows its mount; nodes may pin to the viewport's edges and
centre, inside the shell's safe area; a scene document carries a
`portrait` variant the runtime applies when the viewport is taller than
wide, and the editor edits it by turning the canvas.

## 1. Goal

`first-slot` fills the window at any size; its `win` readout stays pinned
above the shell's bar; turned to portrait, its logo moves above the
reels and the coin hides; the scene editor shows the same on a portrait
canvas and writes the overrides; `e8 shot --viewport 390x844` renders the
portrait game.

## 2. Non-goals

- Percent/relative sizing (`width: '90%'`), constraint or auto layout,
  per-node scale modes — pins and per-orientation overrides cover the
  port's HUD; a frame that must be "90 % of the viewport" is a debt.
- Device notches (`env(safe-area-inset-*)`) — the shell's `safeArea` has
  `top/left/right` 0 today; the renderer exposes no CSS insets yet.
- More than two orientations, breakpoints by width, a tablet variant.
- Rewriting `fitStage`; a `cover` mode that crops the safe rect differently.
- The shell's own portrait bar (`layout: 'mobile'` exists; unchanged).

## 3. The renderer follows its mount

`renderer-pixi`: when `config.width`/`height` are ABSENT the row sizes the
canvas to `mount`'s box (`resizeTo: mount` plus a `ResizeObserver` on it,
`autoDensity: true`, `resolution: devicePixelRatio`), re-firing pixi's
`renderer.on('resize')` — the event the scenes and the shell already
listen to. When both are given, the canvas is that fixed size (dev, tests,
`e8 shot` without a viewport). The schema's descriptions say so; `Config`
gains nothing. A page decides `#mount`'s box by CSS: the example's
`index.html` makes `#mount` fill the window (`position: fixed; inset: 0`)
and floats the dev toolbar and `#log` above it (DEV only; hidden in a
build, as today).

`e8 shot --viewport WxH` already sets the browser viewport; with a
window-filling mount that is the canvas size. `createIdeHost`'s preview
iframe in the IDE sizes itself (§7).

## 4. The safe rect

`@energy8engine/scenes` fits the design into the viewport MINUS the safe
area: `resize(w, h)` reads a `safeArea` SERVICE when one is provided
(`ctx.reflect.get('safeArea', false)` — a page's explicit insets: the
editor page's preset band, later a notch), else the shell's
(`ctx.reflect.get('shell', false)?.safeArea`), else `{0,0,0,0}`; computes `fitStage({ width: w −
left − right, height: h − top − bottom }, design, mode)` and offsets the
container by `(left, top)`. The row re-fits when `shell` is provided
(`ctx.inject(['shell'], () => fit())` beside the existing resize
subscription), so row order does not matter; the shell's bar height is
measured, so the fit re-runs on the shell's `resize` too. `Fit` gains `viewport: { left,
top, right, bottom }` — the safe rect's edges in DESIGN units
(`left = −fit.x / scale`, `right = left + safeWidth / scale`, …), which is
what pins measure from. The scene editor page has no shell (`without:
['ui.shell']`) and draws the bar's band from a preset instead (§7).

## 5. `pin`

COMMON gains `pin: union(['', 'top-left', 'top', 'top-right', 'left',
'center', 'right', 'bottom-left', 'bottom', 'bottom-right'])` default `''`.
When set, `x`/`y` are OFFSETS from that point of the safe rect (§4), in
design units: `x_final = point.x + x`, `y_final = point.y + y`; a `''` pin
is today's absolute placement. The scenes runtime recomputes every pinned
node's position on every `resize` (it keeps each entry's merged props —
document props + `setProps` patches + the active variant, §6 — and
re-runs the common position pass; nothing else re-applies). `pin` is
meaningful only on a node whose parent is the scene root: on a child the
runtime ignores it with a diagnostic (`pin on a nested node "<id>" is
ignored`) and the host's `checkNode` warns the same at save.

`anchor` still applies (a `pin: bottom` text with `anchor: 0.5` centres on
the bottom edge; a `pin: top-left` image with `anchor: 0` hangs from the
corner). `nodeSchema`/`setProps`/`prop` see `pin` as any common prop (a
flow may `prop { pin: '' }`).

## 6. The `portrait` variant

A scene document gains an optional block:

```yaml
id: base_game
nodes: [...]
portrait:
  nodes:
    logo: { x: 0, y: 40, pin: top }
    coin: { visible: false }
```

`SceneDoc.portrait?: { nodes: Record<string, Record<string, unknown>> }`.
`scenes1.config` gains `portrait?: { width, height }` — the design size
used when the viewport is portrait (absent → the landscape `design`,
rotated: `{ width: design.height, height: design.width }`). Orientation is
the shell's rule: `portrait = h > w`, measured on the SAFE rect at every
`resize`. When it flips, the runtime re-resolves every mounted node of
every mounted document: merged props = document props ⊕ (portrait ?
`portrait.nodes[id]` : nothing) ⊕ live `setProps` patches, validated by
the node's schema as one patch (a refused override → diagnostic
`<scene>/<id>: portrait <prop>: …`, the node keeps its landscape props),
then `type.update` + the common pass — the `setProps` machinery, with the
variant as a second layer under the live patches. A type without `update`
is remounted (`unmount` + `mount`) with the merged props only when the
override touches one of the type's OWN props; a common-only override
(`x`, `y`, `pin`, `scale`, `visible`, …) takes the common pass — the
`reels` node turns without a remount. A document's roots take the variant
even when the document is embedded through a `scene` node (an embedded
`big_win` turns); a failed remount keeps the old node and reports. `refresh()`
after a load uses the merged props too. `assets()` collects both layers
(an image whose portrait `src` differs preloads both).

Only top-level nodes of a document can be overridden (`portrait.nodes`
keys are top-level ids; an unknown id → host warning at save, runtime
diagnostic once per mount). A `scene` override (swapping the embedded
document) is followed by `assets()`, the edit-refresh graph and the host's
exists/cycle checks. `symbols.yml` states carry no variant (a symbol's
look is the reels' business).

## 7. Editor

- The scene canvas (`SceneDocument.tsx`) sizes the editor iframe to a
  VIEWPORT preset, not to the design: a select in `CanvasToolbar` —
  `design` (today's: the design box, scale 1), `landscape 16:9`
  (`1280×720`), `phone portrait` (`390×844`), `phone landscape`
  (`844×390`) — plus a free `W×H` field; the iframe is `width={vw}
  height={vh}` and CSS-scaled to fit the pane as today. The editor page's
  renderer fills the iframe (§3), the scenes fit into it, pins and the
  portrait variant apply — the canvas IS the preview of that viewport.
- `scene-edit` draws two frames: the design box (as today) and the safe
  rect (§4) with the bar band hatched; the band height comes from the
  editor's own preset: the IDE appends `?safeBottom=<px>` to the editor
  URL (the shell's NOMINAL bar heights per layout — `92` wide, `142`
  mobile, from `BottomBar.ts`'s constants; the real bar scales under
  840 px, 131 px at 390×844 — a debt), `editor.ts`
  provides it as the `safeArea` service (`createGame({ provide: { safeArea
  } })`), and the scenes runtime fits into it exactly as it would into the
  shell's — the editor composes no shell. Gizmo drags on a pinned node write the OFFSET
  (pointer − pin point, design units); the Properties form shows `pin` as
  a select and `x`/`y` labelled "offset" when a pin is set.
- Orientation is the edit target — the PAGE says which: `scene-edit`
  reports `orientation` on `ready` and on every flip, and tags every edit
  with `variant`; the IDE keeps it per scene. With a portrait viewport
  every gizmo drag and every Properties edit of a top-level node writes
  `portrait.nodes[<id>][<prop>]` (creating the block), never the node's
  own props; the tree marks overridden nodes (`◐`) and a "clear portrait
  override" action removes the entry. With a landscape viewport edits go
  to the node as today. `ScenesProperties`'s write goes through the same
  `patch` device with a `variant: 'portrait' | null` argument.
- The host's `checkNode` walks `portrait.nodes` with the same rules
  (asset props, `$cell` refusal, `pin` on a child); `GET/PUT /api/scenes`
  carry the block untouched; the Symbols document is unaffected.

## 8. Bundle, template, example

- `renderer1` in `e8.patch.yml` ×2 loses `width`/`height` (fills the
  mount); `scenes1.config.portrait: { width: 288, height: 480 }`.
- `index.html` ×2: `#mount { position: fixed; inset: 0 }`, `#controls`
  and `#log` `position: fixed` above it (both at the top — a log at the
  bottom would cover the shell's bar; `#log:empty` is hidden), dark
  translucent backgrounds, DEV-only as today.
- `scenes/base_game.scene.yml` ×2: `win` gets `pin: bottom, x: 0, y: -24,
  anchor: 0.5`; `logo` stays; a `portrait` block `{ nodes: { logo: { pin:
  top, x: 0, y: 40 }, board: { pin: top, x: -112, y: 115, scale: 0.55 },
  coin: { visible: false } } }` — the reels view's origin is reel 0's
  column centre and row 0's centre, so the 5×3 grid (504×300 design px)
  scaled to 277×165 sits 16 px under the logo, inside the 288-wide design.
- `README.md` ×2: a paragraph (the mount, pins, the portrait block, the
  viewport presets).
- `e8.bundle.yml`: nothing (no new row).
- `template.test.ts` pins hold (`index.html` modulo `{{id}}` + the
  select; `scenes/*.scene.yml` byte-pinned — check).

## 9. Testing

- renderer-pixi: without `width/height` the canvas follows a fake mount's
  box (a `ResizeObserver` stub) and fires `resize`; with both it is fixed.
- scenes: `fitStage` with insets → `Fit.viewport` edges in design units
  (contain and cover); `resize` reads `shell.safeArea` and offsets the
  container; a pinned node's position for each of the nine pins at two
  viewport sizes; `pin` on a child → diagnostic and no move; the portrait
  variant: merged props on a portrait `resize`, a refused override keeps
  the landscape props, an `update`-less type remounts, `setProps` patches
  survive a flip, `assets()` includes both layers; `resize` back to
  landscape restores.
- scene-edit: a gizmo drag on a pinned node emits the offset; the safe
  rect frame drawn; edits under a portrait viewport emit `variant:
  'portrait'`.
- client: the viewport preset select sizes the iframe; the tree's `◐`
  mark; `ScenesProperties` writes into `portrait.nodes` under a portrait
  preset; JSON round-trip of a doc with `portrait`.
- host: `checkNode` on `portrait.nodes` (asset props, unknown id, `pin`
  on a child); `PUT /api/scenes` keeps the block; `e8 shot --viewport
  390x844` renders portrait (the PNG's size).
- e2e `responsive.spec.ts`: (1) the example at `page.setViewportSize`
  1280×720 then 800×600 (a non-16:9 size, so the safe rect's `bottom`
  differs from the design's) — the canvas follows (`__e8.stageScale()`
  changes) and `win.y === fit().viewport.bottom − 24` at both, the two
  values differing; (2) 390×844 → `orientation() === 'portrait'`, the
  grid's top (`board.y − 48·scale`) ≥ 16 px under the logo's bottom, the
  grid inside the design width, `coin` invisible, a spin still completes;
  back to 1280×720 → visible; (3) the scene editor: pick `phone portrait`,
  drag `logo`, the file gains `portrait.nodes.logo` and `nodes[logo]` is
  unchanged; pick `design`, drag `logo`, `nodes[logo]` changes and the
  override stays; (4) a `pin: bottom` node dragged under `design` writes
  the offset, not the absolute.

## 10. Debts this opens

Percent sizing; notches; a single `portrait` variant (no breakpoints);
the editor's bar band is a preset, not the real shell; `cover` with a
safe rect crops symmetrically; pins on nested nodes; the reels node's
cell size does not adapt to orientation (the grid scales with the design).
