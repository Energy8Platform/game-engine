# Slice 28 — debts: what was left behind

Slice: `docs/superpowers/plans/2026-09-21-debts.md`, spec
`2026-09-21-debts-design.md` (the triage of slices 21–27's debts: bucket A
fixed here, B = `packages/*`, C = product). Commits `a2af271..ec3270dd` on
`feat/slot-webide-cordis` plus this note's. The user asked for the debts to
be fixed; run per the standing method, tasks in parallel on disjoint
packages. Thirty-odd fixes: diagnostic retraction, a `step` loop cap,
re-arm after a bare `stop()`, `present.turbo`/`step.roundId` guards, no
flow on the editor page; `once` never hangs; `COLOUR` function forms, a
union's empty value, `setProps` on a `scene` host remounts, one rounding
table, pin-aware grid snap, mask pick, the safe area re-read per frame,
`SAFE_BOTTOM.mobile` 131, `checkNode` memo; `known` on the `symbols`
frame, one queued symbols write chain, the flow palette drops at the pane
centre, `ide-web` typechecks clean; `dev-game`'s dead `action`, `.e8/shots`
readable, `e8 check` without a `schema` on a spec error, the tumble/cascade
pair warning, `e8 shot` without the dev chrome, `session-sdk`'s
`handshakeMs` and Artube fields, a persisted dev wallet; the board is
measured by a region hash. Full Playwright alone: 147/148 on the second pass (the one failure a fixture the slice itself made stale — tempo.spec case 1 tripped the new tumble-pair warning; fixed, 5/5 alone); the first pass took an hour at 142/148 because the machine had no internet and the IDE's Google Fonts link blocked `load` for 30 s per page — fixed in the same wave.

## Amendments made while running the plan

- **The fx sweep once per latch is bucket B**: `ReelSystem.skip()`
  (`packages/*`) bundles the per-round tween kill — needed per step for a
  tumble chain — with the `fx` overlay destroy; it needs
  `ReelSystem.skip({ overlays: false })`. (Task 2's first commit title
  claimed it; the fix-round commit says otherwise.)
- **A queued `once` after a destroy must not run**: `AnimatedSprite.destroy()`
  empties its textures and `gotoAndPlay(0)` throws inside the executor —
  the second promise rejected; guarded on `s.destroyed`.
- **`emptyProp` takes the schema entry** (a union's first literal) — and the
  symbols runtime had to follow, or the host would accept a `$cell`
  binding on `text.align` the runtime refused.
- **`mountNode` under a REFUSED portrait override dropped the validated
  live patch** yet `setProps` answered `true`; it re-validates `live`
  alone.
- **`COLOUR` as two whole syntaxes per function** (comma form / space
  form) — mixed separators passed the first regex and threw in pixi's
  `Color`; `hsl` S/L require `%`.
- **`.e8/shots` is LIST + READ only** — the first cut folded the exemption
  into every verb (write/remove into `.e8/shots` were allowed).
- **`currencyMinimalUnit` is a rounding STEP**, not a decimals count:
  `ceil(−log10(unit))`.
- **The symbols write chain moved into the service** (`update(reducer)`,
  queued) — which exposed a lazy `e.target.value` read in
  `SymbolsProperties`'s `fit` handler (a re-render reset the select before
  the deferred reducer ran); captured eagerly like its siblings.
- **The board-region hash must exclude the top row**: it sits under the
  floating dev toolbar and the animated `coin` (8 fps), so a full-grid
  hash differed even on a refused spin (the same vacuity, relocated); the
  bottom row alone is mutation-checked both ways.
- **`symbols.spec:96`'s flake was a test premise, not the write chain**:
  `reportNodeTypes` waited for `#status` — which reads `ready` BEFORE the
  dev bridge's socket opens (slice 26's `void import().then(apply)`) —
  and navigated to `#/doc/symbols`, whose canvas (`editor.ts`) never
  applies the bridge: under load the IDE had no node types, `pick()`
  found none, no PUT. Reproduced alone under synthetic load with a trace.
  It now polls the host's node types.
- **`refresh` in the host's document plugins was re-entrant**: a
  `game/node-types`-driven refresh that read OLD bytes could finish after
  a PUT's refresh and broadcast the pre-write doc; a generation guard —
  and since the `files/written` event's refresh is always the OLDER of a
  PUT pair, every refresh broadcasts (one frame per write still).
- The dev wallet writes its store after a RESPONSE (a thrown fetch charges
  the tab, not `sessionStorage`); `.e8` shows only when `.e8/shots`
  exists; a `$path` turbo resolving to a negative/NaN number warns (the
  spec's letter said numbers are fine).
- **The IDE's Google Fonts `<link>` blocked `load`**: with no route to
  `fonts.googleapis.com` every IDE page load waited 30 s — the first full
  run took an hour at +30 s per test and console-clean tests saw
  `ERR_TIMED_OUT`. A `media="print"` link still holds `load`; the sheet is
  appended after `load` now (`index.html`). The IDE runs offline on the
  system stacks.
- **The new tumble-pair warning made `tempo.spec` case 1's own fixture
  stale** (`tumble` without `cascade.enabled` → "composition has
  warnings" instead of `ready`); the fixture enables the cascade.

## Debts

1. **Bucket B (`packages/*`, the standing rule)**: `ReelSystem.skip({
   overlays: false })` (the fx sweep per step destroys the overlay's
   children on every skipped tumble step); `TumbleController.skip()`'s
   alpha/scale residue; `PRELUDE_NUMBERS` into `validate.ts`; the SDK
   transport leak on a failed `ready()`; an `i18n` hook in
   `ShellController`.
2. **Bucket C (product)**: session bet accounting; modals/replay/recovery/
   persisted volumes/resume; percent sizing/notches/breakpoints; `prop` as
   a map + `format`; the paytable derived into `gameInfo`; the double-tap
   skip; `text.font` swap through an override; the un-pin jump; `--base`
   other than `/`; a fresh clone's dist prerequisite.
3. **The editor page reports no node types** (it never applies
   `ide-bridge`); the palette relies on the game page/preview — a symbols
   canvas alone leaves the IDE typeless. Applying the bridge on the
   editor page is one line in `editor.ts` if wanted.
4. **A route can answer the pre-write state** when a frame-driven refresh
   started after it (the guard drops the older); the client corrects on
   the frame microtasks later. `known` is one `GET` of `spec.json` per
   `symbols` frame — carrying `known` on the frame would delete
   `readKnown`.
5. **Centre snap is off for a pinned node** (no safe-rect analogue); a
   live-pointed `scene` (`prop { scene }`) is outside `assetsOf`/`refsOf`
   ("live is not a document" — a live `src` is the same); an ok response
   whose `res.json()` throws writes no wallet store.
6. **A document broken by both a cycle and a missing kind** is "stuck"
   until the next `replace` (the stale `unknown kind` stays that long).
7. **Machine hygiene**: an orphaned Playwright `chrome-headless-shell`
   (PID 23252, since 2026-09-19 22:00, 619 CPU-minutes) sat on the
   machine through slices 26–28 — load average 12–15 and every
   load-sensitive e2e flake with it. Not this session's process; the
   user was told.

## Method

- **An hour-long suite is a symptom, not load**: +30 s on EVERY test is a
  timeout, and a `requestfailed` probe named it in one run (a blocking
  external stylesheet with the network down). Check the per-test delta
  against the last green log before blaming the machine.
- **A new diagnostic is a fixture change**: the tumble-pair warning turned
  a test's deliberately half-configured copy into a "warnings" boot; grep
  the e2e fixtures for the state a new warning names.
- **A flake gets a trace before a fix**: the suspicion (the new write
  chain) was wrong; the trace showed no PUT at all and a page that never
  reported its types — two slices of "load-sensitive" guesses ended in
  twenty minutes of `--trace on` under a CPU burner.
- **A fix that widens a rule needs its negative test**: `.e8/shots`
  readable became `.e8/shots` writable because the exemption sat in the
  one gate every verb shares; the reviewer wrote to it to find out.
- **A ruled behaviour can be right and still lie**: "the fx sweep once
  per latch" survived into a commit title after being dropped; the ledger
  is the record, but a title is what `git log` shows — say what shipped.
- **Moving a call from sync to queued exposes lazy reads** (`e.target.value`
  inside a deferred reducer) — the existing test caught it; the rule:
  capture event fields before deferring.
- **Regex "accept" lists need the library's own refusals as the oracle**:
  `COLOUR` was pinned against pixi's `Color` throwing/not throwing, which
  is what found the mixed-separator forms.
- **Parallel tasks on disjoint packages**: five implementers and four
  reviewers overlapped without a conflict; the shared-file rule and
  "commit on top of HEAD" held. One `EDUPLICATEWORKSPACE` blip from a
  transient `engine/examples/e8-compose-*` copy — a test fixture leaking
  into the workspace glob; agents waited it out.
