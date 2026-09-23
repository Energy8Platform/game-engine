# Slice 31 — plugin assets, overlapping steps, cell expressions: what was left behind

Slice: `docs/superpowers/plans/2026-09-23-plugin-assets.md`, spec
`2026-09-23-plugin-assets-and-cell-expressions-design.md` (round 3 of the
paper-duel port — the FULL migration — findings F1, F5, F3, F6, F2 and two of
F7). Commits `f2d9ac31..cb993011` on `feat/slot-webide-cordis` plus this
note's. Designed with the user from the round-3 report; run per the standing
method, three waves of parallel implementers plus one final wave.

What shipped:
- **`ScenesService.require(paths) → disposer`** — paths a ROW draws with that
  no document names (the migration needed 21 invisible `image` nodes parked at
  `-4000,-4000` to preload its plugin's art), plus a per-path `warning` at
  `assetLoader` when `get()` answers `undefined` for a path no batch requested.
- **`wait: false` on a plan step** — `executePlan` starts it, moves on, and
  awaits it at the END of the plan (the plan stays atomic); `skip()` is the
  escape.
- **A cell prop is an expression** — the resolver moved DOWN from
  `@energy8engine/flow` into `@energy8engine/contracts` (`src/expression.ts`;
  flow re-exports it, so no importer changed), `isCellBinding` is
  `/\$cell\b/`, and `cellProps` runs `resolveValue(value, { cell: data },
  report)` then the existing coercion: `'x{$cell.mv}'`, `'$cell.layer > 0'`,
  `'{$cell.mv | multiplier}'`.
- **`ScenesService.onFrame(fn) → disposer`** — the ticker's `deltaMS`, lazily
  hooked, unhooked with the last holder and with `destroy()`.
- The duplicate-id diagnostic says the rule and what became of the node, on
  BOTH surfaces (the IDE's check and the runtime).
- The example: the orb's text is a template, and `reel-step` `require`s a path
  no document names.

Unit gate: contracts 165, scenes 183, symbols 55, play-loop 73, reels 58,
flow 133, flow-fx 61, e8 6, ide-client 688, ide-host 516; typecheck 0 errors in
all eleven packages incl. `ide-web`. Full Playwright alone: 152/152 in
10.4 min, first pass (151 + the slice's `require` case), run on
`E8_E2E_HOST_PORT=5779` because the user's own `e8 dev` held 5679.

## Amendments made while running the plan

- **The plan's reels sketch was wrong**: making the board's `playState` return
  without awaiting would leave `wait: true` awaiting nothing and `executePlan`
  with nothing to await at the end. The board keeps its `Promise.all`; only its
  branch on `step.wait` went. The plan decides what holds it.
- **The plan's `$cell` predicate was wrong**: `includes('$cell')` makes
  `$cellular` a binding, which the plan's own test list forbids. `/\$cell\b/`.
- **The `require`/batch merge is gone** (the whole-branch review's ruling): a
  `require` before the first `load()` used to wait to JOIN it, so a composition
  that never shows a document — a scenes row used only for `mountCell`/symbols
  — never loaded the required paths at all. `require` now always queues its own
  batch; the queue is serial and each batch re-reads what is already loaded, so
  nothing is fetched twice. One extra `loader.load` at boot is the price.
- **A `require` disposed before its batch runs must not load** — a
  `required.has(holder)` guard the brief did not ask for, and the pre-existing
  disposer test is what proves it necessary.
- **The atomicity test was vacuous** and the fix round said so with evidence:
  both original cases passed with `await Promise.all(pending)` deleted (one
  released the gate before the await; the other's `.catch` on an
  already-rejected promise ran in the first microtask). The rebuilt cases put
  the non-blocking step LAST and assert the plan has not settled — with the
  line removed, three tests fail.
- **The duplicate-id message landed only in the runtime** at first. The IDE's
  diagnostics panel is the surface an author reads; the two said different
  things about one rule until the final wave.
- **The `wait: false` doc described an authoring surface that does not exist**:
  `PresentationPlan` is `KnownPresentationStep[]` and deliberately closed, so a
  shape that wants the field declares `wait?: boolean` on itself. Today only
  `PlayStateStep` and `EmitStep` do.
- The loader's warning splits `message` and `fix` per the repo's house style;
  the spec's quoted one-liner was amended to what shipped.
- The e2e's IDE-host port is behind `E8_E2E_HOST_PORT` (default 5679
  unchanged) — the suite could not run at all while the user's own `e8 dev`
  held the port.

## Debts

1. **Bucket B (`packages/*`)** unchanged: `ReelSystem.skip({ overlays: false })`,
   `TumbleController.skip()` residue, `PRELUDE_NUMBERS`, the SDK transport
   leak, an `i18n` hook, `SymbolCell.setData`'s unconditional re-resolve.
2. **F4 — an asset prop chosen from a declared set** (`src: { field:
   '$cell.band', of: [...] }`, all preloadable): the one round-3 request this
   slice did not take. Four orb bands are four documents today.
3. **A required path must live under `assets/`** — `e8 build` copies that
   directory wholesale and nothing else, so art kept beside a plugin resolves
   in dev and 404s in `dist`. Documented on `require`; a build-time check would
   be better.
4. **`require` returns a disposer, not a promise**, so the requiring row has no
   readiness signal and must tolerate `get() === undefined` until the batch
   lands; a `get` in that window earns one spurious `nothing loaded` warning.
5. **A `wait: false` step that never settles holds the plan open** — `skip()`
   is the escape and it works, but a registered handler with no `skip()` of its
   own has none. `flow.stop()` aborts the flow's side and leaves the
   `executePlan` promise dangling (pre-existing for any never-settling step).
6. **A late rejection from a non-blocking step fails the whole round**: the
   spin log records `[]` and `present` takes `failed`, even though everything
   else drew. Deliberate — a step that failed is a step that did not draw — but
   the blast radius of a decorative morph is now a round.
7. **The cell-expression widening's sharp edges**: a cell FIELD must be an
   identifier now (`$cell.step-win` parses as a subtraction); a string that
   mentions `$cell` without braces or a leading `$` is a binding that resolves
   to itself; `'$cell'` alone renders `[object Object]`. All documented, none
   guarded.
8. **`E8_E2E_HOST_PORT` must be set for both the fixture and vite** and nothing
   asserts they agree.
9. **paper-duel round 4**: the migration (`engine/examples/paper-duel`,
   gitignored, the user's own tree) can now drop `scenes/preload.scene.yml` and
   its generator, hook the ticker through `onFrame` instead of
   `ctx.renderer.app.ticker`, let the duel's death morphs be a `playState
   { wait: false }` step again, and move its pre-computed `label`/`badge` back
   into the orb documents. Unmeasured here.
10. **Machine**: the user's `e8 dev` holds 5679 (pid 18911, cwd
    `engine/examples/paper-duel`); the `ide-host` suite spawns its own headless
    Chromium (`compute-shot`), so it runs alone. The 2026-09-19 orphan family
    is still there.

## Method

- **A plan's sketch about existing code is the first thing to verify**: two of
  this plan's were false (the reels return, the `$cell` predicate), and both
  were caught by implementers reading the real call order rather than
  transcribing. That is now three slices in a row.
- **"The test passes" is not "the test would fail"**: the atomicity gate was
  proved vacuous by DELETING the line it was supposed to guard and watching
  nothing break. Worth doing to any test that guards a rule rather than a
  value.
- **A diagnostic has a surface**: fixing the wording where the runtime prints
  it and not where the IDE checks it is half a fix, and the half the author
  never sees. Ask which surface the reader is on.
- **A doc that describes a type must be read against the type**: the
  `wait: false` sentence was true of the READ and false of the WRITE, and only
  a reviewer who opened `PresentationPlan` noticed.
- **"Sometimes it loads" is not a contract**: the `require`/batch merge was
  correct for every composition anyone had written and wrong for the one the
  next author will write. One extra batch at boot buys a rule that holds.
- **A blocked suite is a debt, not a workaround**: the port collision was
  worked around twice (temporarily moved, reverted) before it became one
  env-defaulted constant.
