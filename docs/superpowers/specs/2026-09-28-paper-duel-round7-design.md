# What paper-duel round 7 found — design (slice 42)

Date: 2026-09-28. Branch: `feat/slot-webide-cordis` at `0871b879`.
Source: `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`,
round 7 (F15–F20) — the port's session measured each on the running game.
Decided with the user: F15 by `view()` + `views()`; F16 by a public `load`
and a narrow refresh; F17 by documenting and testing what already works;
F19 as `scenes1.fonts`; F18 and F20 as below.

## 1. Rules

- `packages/*` is not edited. No `@energy8platform/game-engine` under
  `engine/`. Every change carries a test in its package.
- Existing documents and patches keep working unchanged (every new field has
  a default that means "as before").

## 2. F15 — `view()` answers the copy on screen

A `scene` node mounts the referenced document again as its own subtree
(nesting by copy). `setProps`/`once` act on every copy (`entriesOf`);
`view(ref)` answers `entryOf` — the document's OWN top-level mount, which
for a nested document is the copy nobody sees. A tween on it moves numbers,
not pixels.

- `scenes.view(ref)` answers the copy whose HOST document is currently
  shown, preferring the most recently shown host; when none is shown, the
  document's own mount (today's answer). "Host" is the top-level document a
  copy's mount lives in (the document itself for its own mount).
- New `scenes.views(ref): Container[]` — every mounted copy, in the order
  `entriesOf` walks them.
- flow-fx's `tween` and every other `view()` caller get the visible copy
  with no change of their own.

## 3. F16 — load, pose, show

`show(id)` loads the document's art and `loadPaths` ends with `refresh()`,
which re-runs EVERY node's `update` from its document props — a pose set on
a view before `show` is wiped, and so is any pose anywhere whenever any
document loads.

- `scenes.load(id): Promise<void>` becomes public (it exists inside the
  runtime): loads what `id` (and any row) needs, without showing. A `show`
  after it has nothing to load and re-runs nothing.
- New flow kind `load { scene }` (the scene picker), `next` when the load
  settled (a failed path is the loader's diagnostic, the branch goes on).
- `refresh()` after a load re-runs `update` only on the nodes that use one
  of the paths that batch loaded (a node's `type.assets?.(props)`
  intersecting the batch); every other node — and its pose — is untouched.

## 4. F17 — `emit { wait: true }` already waits for plugins

The events bus settles `emit`'s promise once every listener's returned
promise has — flow runs AND a plugin's `events.on` handler that returns a
promise. The `wait` field's description says only "every run the event
started", so a plugin author writes an ack event instead.

- `wait`'s description: "hold this branch until every run the event started
  has ended and every plugin handler's returned promise has settled".
- A flow test: a plugin listener returning a promise holds `emit { wait:
  true }` until it resolves; `wait: false` does not.
- A line in the flow package README under `emit`.

## 5. F18 — text spacing, line height, fit to width

The `text` node type gains:

- `letterSpacing` — px, default `0`;
- `lineHeight` — px, default `0` = the renderer's own;
- `fitWidth` — design px, default `0` = off: when the laid-out text is wider,
  the font size is reduced so it fits (never enlarged), re-measured on every
  `update` (a changed `text`/`size`/`fitWidth`). Font size, not `scale`
  (`scale` is a common prop the author owns). Works for web and bitmap
  text.

## 6. F19 — web fonts in the composition

The `scenes1` row gains `fonts: { family, src, weight?, style? }[]`,
default `[]`:

- `src` is a project-relative file (`.woff2`, `.woff`, `.ttf`, `.otf`),
  offered by the IDE's asset picker; `weight` default `'normal'`, `style`
  default `'normal'`.
- Each becomes a `FontFace(family, url(src), { weight, style })`, added to
  `document.fonts` and loaded BEFORE the first document mounts —
  `scenes.ready` settles after them — so document text and a plugin's own
  `Text` draw in the face from the first frame.
- A font that fails to load is one diagnostic naming `src`; the text falls
  back to the family's fallback.
- `e8 build` already copies `assets/` whole; a font under it ships.

## 7. F20 — the shell bar can be hidden, and gives its height back

- The flow `shell` kind gains `visible: '' | 'true' | 'false'` (`''` =
  leave as is).
- The `shell-pixi` row provides a handle whose `setVisible(v)` hides the
  bar AND makes `barHeight` and `safeArea.bottom` answer `0` while hidden
  (the shell in `packages/` flips only its root's `visible`). Scenes re-reads
  `safeArea` on every fit, so the screen comes back without a project
  shadowing the `safeArea` service.

## 8. Tests

- `scenes`: `view()` of a nested document answers the copy inside the shown
  host, falls back to the own mount; `views()` lists every copy; public
  `load()`; a pose set after `load` survives `show`; a load of document B
  leaves a pose on document A; `refresh` re-runs only nodes using a loaded
  path; text `letterSpacing`/`lineHeight`/`fitWidth` (a long string fits,
  a short one keeps its size, `fitWidth: 0` off); fonts: a `FontFace` per
  entry added and awaited before mount (a fake `FontFace`/`document.fonts`),
  a failing one reported.
- `flow`: `load` kind; `emit { wait: true }` waits for a plugin listener's
  promise.
- `flow-fx`: `tween` on a nested node moves the visible copy.
- `shell-pixi`: `setVisible(false)` → `barHeight` and `safeArea.bottom` 0;
  back on → the real height; the flow `shell { visible }` calls it.
- e2e (alone): a pose set between `load` and `show` is on screen in the
  first frame after `show`; a tween on a node of a nested document moves
  it on screen; a `fonts` entry's family is what a document text node
  renders with (`document.fonts.check`); `shell { visible: false }` gives
  the bar's height back (the scenes fit grows); `fitWidth` shrinks a long
  caption. Full Playwright alone.

## 9. Not here

- A `rope`/`mesh` node type (the cords' sag), i18n hooks, a mobile asset
  tier, pulsing text — round 7's "still not the original" list.
- Changing `setProps`/`once` (they already act on every copy).

## 10. Amendments made while running the plan

- **A loaded host is a pending host** (the final review found the load →
  pose → show workflow missed nested documents: with nothing shown yet,
  `view()` answered the hidden own mount). `view()` answers shown hosts
  (latest first), then hosts `load` readied (latest first, dropped by
  `hide` and by a `replace` that no longer declares them), then the own
  mount. `load` of an undeclared id is `show`'s `notDeclared`. A `hide`
  keeps the art of pending hosts (it unloaded everything no shown document
  needed, undoing a `load` before its `show`).
- **`hide` refreshes narrowly too**: after unloading, `update` re-runs only
  on nodes using the unloaded paths (types without `assets()` stay in
  every sweep, as for a load). `remount` is the only blanket refresh left.
- **`fitWidth` is measured before the node's `scale`**, the fitted size is
  floored to a 0.5 px step (≥ 1), and a wrapped text scales its wrap
  width, `lineHeight` and `letterSpacing` by the same factor as the font
  (at most 3 passes) — the single-shot shrink let re-wrapping undo the fit.
- **Fonts load alongside the boot GET** (only `replace` waits for both);
  a font URL is quoted and never doubles a leading slash; the faces are
  removed from `document.fonts` on dispose.
- **The flow package has no README**: `emit.wait`'s description and the
  `emit`/`load` doc comments carry §4's note. `load` with no `scenes`
  service is a warning and `next` (it prepares; `show` is where a missing
  renderer fails).
- **The shell handle is a `Proxy` of the Pixi shell** with every method
  bound to the real instance (a prototype wrapper let `setBalance`'s
  `this` writes land on the wrapper). No `refit()`: the scenes' per-tick
  inset check re-fits when `safeArea.bottom` changes.
- **The e2e reads every copy on its own** (`__e8.nodeCopies`) and a text's
  family (`__e8.nodeFontFamily`), in both `main.ts` copies.
