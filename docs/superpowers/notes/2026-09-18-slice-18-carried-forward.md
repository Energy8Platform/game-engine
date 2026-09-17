# Slice 18 — scene canvas: what was left behind

Slice: `docs/superpowers/plans/2026-09-17-scene-canvas.md`, spec
`2026-09-17-scene-canvas-design.md`. Commits `a2b846b..92e8c80` on
`feat/slot-webide-cordis` (fifteen) plus this note's. The scene tab is a
canvas: the project's `editor.html` (`src/editor.ts` = the game's
composition + `@energy8engine/scene-edit`) runs in an iframe inside the
tab; `scene-edit` owns picking, the transform gizmo (a port of
`feat/slot-ide-ir`'s), grid and snap, keys, and the drop target, and
speaks `e8:ide:req/res/evt` over `postMessage` to the IDE; the IDE's
`SceneDocument` has a toolbar (zoom, fit, grid), a collapsible tree pane,
the iframe, and `canvas-rpc.ts`; every gesture ends in one write through
`ctx.scenes.update`; `ctx.assetNodeTypes` turns a dropped file into a
node (`image` built in); the example carries its first real image
(`assets/logo.png`), which also closes slice 17's "pixi `Assets`
unproven" debt. Sub-project B is closed; C (the flow editor) and D
(`spine`/`gif`/`video` node types) remain.

## Amendments made while running the plan

- Device presets and rotate (spec §5.1) were dropped: the renderer is
  fixed-size, the canvas' intrinsic size is the design size, the toolbar
  zooms with a CSS transform. The old `ViewportBar` code stays on
  `feat/slot-ide-ir` if a responsive renderer ever needs it.
- A fourth wire method, `replace { docs }`, was added: the editor page
  composes no `ide-bridge`, so nothing else could deliver document
  changes to the canvas. Composing `ide-bridge` there would also have
  wired `scene-preview` to the canvas, hijacking it from the sidebar.
- The RPC attaches on the iframe's ref callback, not `load`, so a `ready`
  emitted before `load` is not dropped.
- The example's `logo` node moved after `board`: a full-design reels view
  drawn above it made the only image unpickable.
- `scene-edit` applies an edit locally (`scenes.replace`) before telling
  the IDE, keeps un-acknowledged edits as `pending` and lays them back over
  an incoming `replace` that reflects an older one; the gizmo keeps a
  gesture across a re-target of the same node. Without this, the echo of
  each edit remounted the view mid-gesture and a held arrow key moved at
  half speed.

## Debts

1. **A full-design view masks everything beneath it** — `pick.ts` takes the
   topmost AABB, so a node behind the reels board is reachable only from
   the tree or after `[`. The old `ideBridge` had click-again-drills-in
   (`lastPick`); the port dropped it. That is the fix, not a heuristic.
2. **Press-and-drag on an unselected node needs a second press**
   (port-faithful: the first press selects). The standard gesture is
   select-and-drag in one.
3. **Scale about the view origin**: with `anchor: 0.5` the dragged corner
   moves at half the cursor's rate; scale-only edits carry no `x,y`
   compensation. `designPerPixel` is root-only (wrong under a scaled
   non-root parent). Handles sit on the AABB of a rotated view.
4. **A held arrow key is a PUT per repeat** (~30/s), each re-read by the
   host and echoed to every `/ide` client including the Preview. Coalesce
   nudges into one write per key-up, or debounce in the IDE.
5. **`dropAsset` writes `x, y` unrounded** (the `edit` path rounds to 2 dp).
6. **Value-based acks in `pending`** are ambiguous when a value repeats
   within one round trip (right, right, left) — one transient snap-back,
   self-healing. A sequence number is the upgrade.
7. **`parentOrigin` from `document.referrer`** is not a boundary — a dev
   tool on 127.0.0.1 whose child holds nothing and writes nothing; the
   comment says so. Do not treat it as security.
8. **`scenes` (client) hard-injects `files`** for the desktop-drop path
   alone; `ctx.get('files')` lazily would shrink the blast radius.
9. **`asset-node-types` is a per-id stack with restore-on-dispose** nobody
   asked for; `createRegistry` (last-wins) as `viewers`/`languages` would
   be twenty lines.
10. **Drop coordinates assume canvas CSS size == `app.screen`** — true today
    (the IFRAME is scaled, not the canvas); breaks with `resolution: 2`
    without `autoDensity`.
11. **`scenes.ready` rejects on a failed boot GET** and a later `replace`
    cannot revive a canvas that emitted `error`; an iframe remount recovers.
12. **Small**: `on` Set dedup in `canvas-rpc`; `delta: 0` maps to previous;
    the stage's `pointerdown` focus covers the margin only; a remount
    mid-drag on a DIFFERENT node still cancels; `commit`'s no-op check vs a
    stale render doc; `ide-web` typecheck's six `TS7016` (slice 14).
13. **Tests**: the e2e drop is dispatched inside the frame (Playwright's
    drag cannot cross origins); test 2 hardcodes the logo centre; the
    Preview iframe's ticker stalls while hidden (`spin()` needs its tab in
    front); `diagnostics.spec.ts:440` flakes after its siblings (passes
    alone — vite module cache after a reload; pre-existing).

## Method

- **A port that changes the identity model is not a port.** The old gizmo
  keyed on a node id and re-resolved its view every redraw; the port keyed
  on a view object and needed a per-frame re-resolve plus `drag = null` on
  attach — exactly where the final review's Important lived. When a port
  swaps id for object, ask what the id gave for free.
- **Echo loops need a test with the echo in it.** Nine task reviews and
  110 e2e cases passed because every test let the echo settle before the
  next gesture. The failing test was thirty lines on the existing harness:
  gesture, gesture, echo of the first, frame, gesture.
- **An e2e that mutates the fixture to reach its assertion is reporting a
  bug.** `canvas.spec.ts` pressed `[` before "click the logo" and said why
  in a comment; the comment was the finding.
- **Validate the wire on both ends, unconditionally.** The parent-side
  source check was skipped while unattached; the child-side unknown-method
  answer bypassed the async path. Both were one-line gates found by
  asking "what if the other end is not there yet".
- **A "deferred minor" needs its path, not just its name.** Float noise
  landed in the user's YAML on every zoomed drag; the drop-coords item had
  no reachable path. Write the path when deferring.
- **cordis re-activates a paused plugin when its dependency provides** —
  verified against rc.8 by a reviewer with a script, so a widened `inject`
  composed before its provider is safe; still, a test for the real boot
  order would make it an invariant instead of a re-derivation.
