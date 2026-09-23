# Slice 32 — asset sets, and the debts slice 31 left: what was left behind

Slice: `docs/superpowers/plans/2026-09-23-asset-sets.md`, spec
`2026-09-23-asset-sets-and-debts-design.md` (F4 of the paper-duel round-3
report, plus six debts). Commits `a3e21d5a..36e8a61a` on
`feat/slot-webide-cordis` plus this note's. Designed with the user: the set is
a MAP on the node (option A), not an object on the prop. Run per the standing
method, two waves of parallel implementers plus one final wave. The session's
commit trailer changed mid-slice to `Claude Opus 5.5` (the spec commit carries
the old one; history is not rewritten).

What shipped:
- **An asset set** — `image` and `strip` gained `srcOf` (a dict of
  project-relative paths, every entry preloaded with the document) and `srcKey`
  (a plain string prop). They show `srcOf[srcKey]` when that is an own,
  non-empty key, else `src`. In a cell scene `srcKey: '$cell.band'` is resolved
  by `cellProps`, and a `bind` re-runs `update`, so the art swaps with the
  cell's data from textures already loaded. `NodeType.assetMapProps` names the
  dict props; `ide-bridge` carries it to the host in `NodeTypeInfo`; the host
  checks every entry like an asset prop (one shared `checkAsset`). The IDE
  edits `srcOf` with its existing dict widget.
- **A `$cell` prop shown without a cell warns** — at show time, not mount time
  (`replace()` mounts every declared document hidden, cell scenes included); a
  preview `show` (`opts.preview`, the IDE looking at a document) skips ONLY this
  check.
- **A bound prop resolving to an object, or a number prop to `NaN`, warns** —
  with a fix naming the likeliest cause (a non-identifier field), in scenes AND
  in a symbol's own states.
- **A `require`d path outside `assets/` warns** (`./` normalised) and is still
  requested; the fix says `move it under assets/`.
- **The plan releases after a step that never settles** — `executePlan` races
  the non-blocking steps against `pendingMs` (play-loop row config, default
  30000, `0` disables): one `error` per still-pending step, the plan returns,
  the abandoned promises' later rejections are swallowed; the race never leaves
  a timer.
- **A non-blocking step's failure does not fail the round** — it is a
  `warning`; flow's `present` fails, and records `[]`, only on an `error`, and
  its `failed` message joins only the errors.
- **One source for the e2e ports** — `engine/apps/web/e2e-ports.ts`, read by
  vite, the fixture, `playwright.config.ts` and all 27 specs that built an IDE
  URL; the e2e specs, `vite.config.ts` and `playwright.config.ts` are now
  typechecked (`tsconfig.e2e.json`).
- The example: `reel-step`'s mechanic tags every `'6'` with `band:
  BANDS[row % 4]` (demo data, not math); the orb is one document with a
  four-entry `srcOf`.

Unit gate: contracts 165, scenes 200, symbols 56, node-media 48, play-loop 81,
reels 58, flow 134, flow-fx 61, ide-bridge 77, scene-edit 54, e8 6, ide-client
688, ide-web 33, ide-host 523; typecheck 0 errors everywhere, incl. the e2e.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`, 15.2 min, load average ~8):
150/153. The three failures are timing budgets, and none is this slice's:
`headless.spec` load 2763 ms against 2500; `tempo.spec`'s two skip cases
(2.2 s, 3.3 s against 1 s / 0.7 s). The skip cases lose their skip:
`play-loop`'s idle guard (`if (!lastBoard) return`, since 2026-09-20) drops a
skip that lands before `execute` starts, and under load the spin's POST plus
`present` outlast the spec's 100 ms / 150 ms wait. Proven: the 100 ms case
with a 400 ms wait passes 3/3 on the same machine; the tumble case passed 2/2
on a rerun alone; nothing in this slice touches the path before `execute`.

## Amendments made while running the plan

- **The no-cell warning moved from mount to show** — the plan put it in
  `mountNode`, which would have warned for every correct cell scene the moment
  `replace()` mounted it hidden.
- **A preview does not report the `$cell` warning — and only that.** The first
  cut skipped all of `reportShown` on a preview, which also hid the
  unregistered-node-type error — exactly what an author previewing a document
  in the IDE wants to see. Narrowed.
- **Task 5 broke every e2e spec that starts a dev host**: `export { X } from`
  gives a module no local binding, and the fixture used the name → a
  `ReferenceError` at host start. Neither the task review nor the typecheck
  caught it, because the web app's `tsconfig.json` never included
  `tests/e2e/**`. Fixed by the Task 6 implementer, who hit it; the e2e is now
  typechecked (it found one more error, in `tempo.spec.ts`).
- **Task 6's `banded()` broke `reel-step.spec.ts`** (its plan-equality
  assertions expected the raw grid); only `symbols.spec.ts` had been re-run.
  Caught by the whole-branch review, fixed in the final wave.
- **In a symbol's own states the new warnings arrived as errors with no fix** —
  symbols' two `view.ts` call sites forwarded only the message. Threaded.
- `pendingMs` travels as a sixth `executePlan` parameter (`limits`): no
  existing options object fit (`opts` is tempo, `hooks` callbacks).
- `IDE_URL` lived in 26 specs, not the 6 the brief named.

## Debts

1. **Bucket B (`packages/*`)** unchanged: `ReelSystem.skip({ overlays: false })`,
   `TumbleController.skip()` residue, `PRELUDE_NUMBERS`, the SDK transport
   leak, an `i18n` hook, `SymbolCell.setData`'s unconditional re-resolve.
2. **An abandoned step keeps the reels board's `repaint()` deferred** for as
   long as it runs — forever, if it never settles (`tracked`'s in-flight count
   never returns to 0). A broken step's consequence, documented, not fixed.
3. **A portrait flip or a live `setProps` does not re-check the no-cell
   warning**; an override that removes a binding leaves a stale warning (nothing
   retracts it). Documented.
4. **`srcOf`'s value cell in the IDE is a text input**, not a file picker (the
   dict widget has no per-value picker).
5. **Asset sets exist only on `image` and `strip`** — `spritesheet`, `video`,
   `gif`, `text.font` when something asks.
6. **The template carries an inert showcase**: its orb has a band-keyed set, and
   nothing in the template feeds a band (both READMEs say so).
7. **`reel-step.spec.ts` imports the plugin's `banded()`**: a bug inside it
   shows only in the plugin's own unit tests (which pin literal values).
8. **`present`'s `failed` message keeps every mechanics diagnostic** (the
   plan never ran), a branch with no dedicated test.
9. **Carried from slice 30**: a cell copy never `refresh`es or flips
   orientation; from slice 29: `emit { wait }` does not race the abort signal.
10. **A skip before the plan starts is dropped** (see the Playwright line): a
    player who taps Spin twice while the spin's POST is in flight gets no
    skip. A pending-skip latch taken by the next `execute` would fix it and
    stop `tempo.spec` from racing the network. Not fixed here.
11. **paper-duel round 4**: the migration can now drop four orb documents for
    one with a `srcOf`, plus everything slice 31 enabled (`require`, `onFrame`,
    `wait: false`, `$cell` expressions). Unmeasured here.

## Method

- **A change to a shared input needs every consumer's test, not the one the
  task named**: `banded()` changed what the spin log records, and the spec that
  asserts on the spin log was not re-run. Before closing a task that changes a
  mechanic's output, grep the e2e for who asserts on plans.
- **A file outside the typecheck is a file outside the net**: two slices of
  e2e edits had no compiler behind them; the first `ReferenceError` cost a
  whole-suite breakage. Check `tsconfig`'s `include` when a package grows a new
  folder.
- **A skip flag must name exactly what it skips**: "a preview does not report"
  read as one warning and shipped as all of them. Name the check, not the
  function.
- **A reviewer's concern the implementer raised is a ruling to make, not a
  note to file**: the preview over-skip was in the implementer's own report;
  the fix was one message away.
