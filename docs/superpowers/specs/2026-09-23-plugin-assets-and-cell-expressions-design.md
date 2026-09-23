# Plugin assets, overlapping steps, cell expressions — design (slice 31)

Date: 2026-09-23. Branch: `feat/slot-webide-cordis` at `58436972` (slice 30).
Source: round 3 of the paper-duel port — the FULL migration
(`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`), findings
F1, F5, F3, F6, F2 and two of F7. F4 (an asset prop chosen from a declared
set) is the next slice; i18n and a mobile asset tier stay product.

## 0. Rules

- `packages/*` is not edited.
- Every new prop keeps the existing rule: a string prop refuses an unquoted
  YAML scalar; `''` means "untouched".
- Every fix carries a unit test in its package; the browser proof is the e2e
  suite plus §7.
- A value that cannot be resolved is a diagnostic on the node that owns it;
  the render continues with the prop's empty value.

## 1. F1 — a row declares the assets it draws with

### 1.1 The problem

The scenes row preloads exactly what the DOCUMENTS name (`assetsOf`). A step
handler's textures are named in TypeScript, so every sheet the paper-duel
plugin draws with resolved to nothing until the migration added
`scenes/preload.scene.yml`: 21 invisible `image` nodes parked at `-4000,-4000`
purely to make the loader fetch them.

### 1.2 `ScenesService.require`

```ts
/**
 * Paths a ROW draws with that no document names — a step handler's sheets,
 * a plugin's number font. Loaded with the documents' own assets and held for
 * as long as the registration lives; the disposer releases them (the loader
 * keeps a path any other holder still names).
 */
require(paths: string[]): () => void;
```

- The scenes row folds the required set into `load()`'s batch: a `require`
  before its boot load simply joins it; one after it triggers a load of what
  is new and a `refresh()`/`redraw()` when that lands.
- The disposer removes this holder's claim. A path no holder names any more is
  NOT unloaded (the loader's `unload` stays for a document leaving the stage);
  it is simply no longer re-loaded on a later batch. Say so in the doc.
- A caller registers through `ctx.effect(() => scenes.require([...]))`, so the
  claim dies with the row — the `BoardStepRegistry` precedent.
- No `scenes` service (a composition without one) → the caller's own lenient
  read, as everywhere else.

### 1.3 The diagnostic when nothing loaded a path

`AssetLoader.get(url)` answering `undefined` is the failure F1 describes, and
today it is silent. The scenes row's loader reports, ONCE per path, a
`warning` at `assetLoader`:

> `nothing loaded "<path>" — a document must name it, or a row must
> `require` it`

Only for a path no batch ever requested (a path that WAS requested and failed
already has its own error from `load()`), and only after the first batch has
settled (a `get` during boot is the ordinary "not yet" — `image.mount` draws an
empty sprite and `update` fills it in).

### 1.4 The example

`scenes/preload.scene.yml` and its generator go away; the paper-duel plugin
calls `scenes.require(FX_PATHS)` in its `apply`. (The example is gitignored —
the change is the user's to make; this spec ships the seam and the first-slot
e2e proves it.)

## 2. F5 — a step that does not hold the plan

### 2.1 The problem

`executePlan` awaits every step. paper-duel fires its death morphs from inside
the duel beat and never waits for them; expressed as a `playState` step, the
beat cost 600 ms twice and a spin went from ~20 s to ~30 s. The fix in the port
was to move the work OUT of the vocabulary — a plugin's handler doing what a
step should say.

### 2.2 `wait: false` on any step

`PresentationStep` gains the optional field on the two shapes that carry it
(`PlayStateStep` already has `wait`; the rest take it through
`UnknownPresentationStep`'s index signature — so this is an `executePlan`
rule, not a per-kind one):

- `executePlan` reads `step.wait === false` for ANY step, known or registered.
  The board method / handler is called, its promise is NOT awaited there, and
  the plan moves to the next step.
- **The plan is still atomic**: every non-blocking promise is awaited at the
  END of `executePlan`, before it returns its diagnostics. A rejection lands in
  the same `step "<kind>" failed` diagnostic, naming the index it was started
  at.
- `skip()` reaches them unchanged (the board and the handlers are the same
  objects; the play loop's latch already re-fans on each later step's start).
- `PlayStateStep.wait` keeps its current meaning, which is exactly this one —
  the reels board's `Promise.all` becomes redundant and is removed in favour of
  the generic rule. The step's doc says so.

Not here: a step that outlives its plan (a beat still playing when the next
spin starts) — the plan awaits its own.

## 3. F3 — a cell prop is an expression

### 3.1 The problem

`$cell.<field>` takes a bare field and nothing else, so the paper-duel mechanic
computes view strings (`label: 'x64'`, `badge: 'x5'`) that belong in the
document. Slice 29's resolver — templates, formats, arithmetic — exists one
layer up, in `@energy8engine/flow`.

### 3.2 The move

`flow` depends on `scenes`, so the resolver moves DOWN, not sideways:
`expr.ts` and `value.ts` become `@energy8engine/contracts`'
`src/expression.ts` (pure TS, no cordis, no pixi — the package already holds
`spin-schema.ts` and `scene-rounding.ts` in that spirit).
`@energy8engine/flow` re-exports `readPath`, `evaluate`, `evaluateValue`,
`resolveValue` and `formatValue` from its own index, so every importer and
every test in the repo keeps working unchanged.

### 3.3 Cell props

`cellProps(type, raw, data?)` (`@energy8engine/scenes`' `common-schema.ts`):

- **Bound** is now "the string mentions `$cell`" — a bare `'$cell.mv'`, an
  expression (`'$cell.layer > 0'`), or a template (`'x{$cell.mv}'`,
  `'{$cell.mv | multiplier}'`). `isCellBinding` keeps its name and widens to
  that test; `cellField` goes (nothing outside this file used it).
- **No data** (a mount before the first `bind`): the prop stands at
  `emptyProp(entry)`, exactly as today — the expression is not evaluated.
- **With data**: `resolveValue(raw, { cell: data }, report)`, then the existing
  coercion by the prop's schema type (`number` → `Number()` or 0 on NaN,
  `boolean` → the string `'true'` or `Boolean`, `string` → `String`).
- The vars are `{ cell }` only. `| currency` therefore has no `$session` and
  falls back to `toFixed(2)` without a symbol — its documented behaviour.
- A `SyntaxError` (a malformed expression, an unknown format) reports on the
  node and the prop stands at its empty.

### 3.4 The host

`checkNode`'s cell-binding rule (`only a cell scene … reads a cell`) tests the
same widened predicate, so `'x{$cell.mv}'` is refused outside a cell scene for
the same reason `'$cell.mv'` is. An asset prop bound to `$cell` stays refused
everywhere.

## 4. F6 — a row can hook the ticker

`ScenesService.onFrame(fn: (dt: number) => void): () => void` — registers
against the ticker the scenes row already holds (`options.ticker`), passing
the ticker's `deltaMS`; the disposer unhooks. No ticker (a headless
composition) → the registration is accepted and never fires, and the disposer
is a no-op. A throwing `fn` is unhooked and reported once (`scenes`,
`onFrame`), the way a throwing listener is handled everywhere else.

This is the one place the paper-duel migration reaches `ctx.renderer.app`
directly; with `onFrame` a project plugin never touches pixi's application.

## 5. F2 — a duplicate node id says what to do

The rule (ids are unique per DOCUMENT, not per parent) stays — a `SceneRef`
is `{ scene, node }` and every consumer reads it that way. What changes is the
diagnostic:

> `node id "bar" is declared twice in "meters" — ids are unique per document,
> not per parent`, fix: `prefix them, e.g. "rock_bar" and "paper_bar"`

and one sentence in the scene document's own schema doc (`SceneDoc.nodes`)
saying the same.

## 6. F7 — the two smaller ones

- **`count` on a node in a hidden scene still counts.** Documented on the
  kind: a count writes the node's `text` whether or not its scene is shown;
  show the scene first, or accept that the value is already final when it
  appears.
- **`strip` finishing.** `loop: false` already holds the last frame; what a
  document cannot do is REACT to the finish outside a symbol state. Out of
  this slice: it wants a `once`-shaped flow node (`play { target }`), which is
  a kind, not a fix. Recorded as a debt.

## 7. Tests

- contracts: `expression.ts` keeps every existing `expr`/`value` test (they
  move with it); `@energy8engine/flow`'s re-exports resolve.
- scenes: `require` joins the boot batch, a late `require` loads and refreshes,
  the disposer drops the claim; `onFrame` fires per tick with `deltaMS`,
  unhooks, survives no ticker, unhooks a thrower; `cellProps` with a template,
  an arithmetic expression, a format, a malformed expression (reports, empty),
  and no data (empty, not evaluated); the duplicate-id message.
- play-loop: a `wait: false` step does not hold the plan, its promise is
  awaited at the end, a rejection becomes a diagnostic naming the index, and
  `skip()` still reaches it.
- reels: `playState`'s `wait: false` path now comes from `executePlan` — the
  board always starts every cell and the step's own `Promise.all` is gone.
- ide-host: the widened `$cell` predicate refuses a template outside a cell
  scene and accepts it inside one.
- e2e: the example's `orb` cell scene shows `'x{$cell.multiplier}'`-shaped
  text (still empty in `first-slot`'s math — the case proves the template
  mounts and resolves, as slice 30's does); a `require`d path that no document
  names is loaded (`__e8` hook reading the loader).

## 8. Not here

- F4 — an asset prop chosen from a declared set (next slice).
- Ids scoped to their parent.
- i18n, a mobile asset tier, the bitmap-font readouts (product).
- A beat that outlives its plan.
