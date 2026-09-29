# Can paper-duel be ported to the WebIDE? — feasibility report and requests

Date: 2026-09-19. Branch `feat/slot-webide-cordis` at slice 21. The attempt
lives in `engine/examples/paper-duel` (gitignored by the `/engine/examples/*`
rule; nothing in the `paper-duel` repo was touched — its files were read and
copied). Every claim below marked *measured* was run, not read.

## Verdict

**Partially, today. The math ports as-is; the board, the art, the static
layout and the spin loop port as documents plus one project plugin; the
game's own presentation and its whole session/shell layer do not.**

- The SpinML math runs unchanged on the IDE's `e8-server` (*measured*:
  `e8 check` parses it with zero diagnostics, `e8 spin` plays it, the page
  spins it through the flow).
- The board with paper-duel's art, the duel holes, the anywhere-pay
  cascade with paper-duel's stay-aware gravity, the backdrop/frame/meters/
  logo/multiplier sign, a big-win banner and a spin sfx run in the IDE's
  preview (*measured*: 8 consecutive spins through the real page, every
  `present` left by `next`, no diagnostics, no console errors; screenshots in
  `engine/examples/paper-duel/shots/`).
- What does NOT port: the Tournament Bonus (a session the runtime cannot
  step), the four buy modes (the flow cannot name an action), everything
  the shell provides (balance/bet/win readouts, buy cards, autoplay, turbo,
  game info, i18n, disclaimer), every piece of presentation that needs
  text or per-cell state (multiplier orbs' ×N, layer badges, champion
  crowns, cluster win floats, the cascade multiplier plaque, meter fills,
  boss HP), and the ~2,500 lines of bespoke VFX in `GameScene.ts` (duel
  lunges and death morphs, dominance strikes, rule-breaker sweep, confetti,
  orb flights, curtain intro/outro, retrigger banner, board recoil). The
  VFX is not a format gap — it is plugin code either way — but nothing in
  the format reduces it, and several runtime gaps (below) stop even a
  plugin from doing it correctly.

Effort reading: the port that exists took a few hours and is ~250 lines
(plugin + documents). Making it *paper-duel* would be re-hosting
`GameScene.ts` inside a project plugin as custom step kinds — the same code,
moved — and it would still lack sessions, buy actions, text and the shell
until the requests below land.

## What was built, and what each layer proved

| Layer | File(s) | Result |
|---|---|---|
| Math | `game/script.spin` = paper-duel's `.e8gen/script.spin` (prelude + script) | `e8 check`: 0 diagnostics; actions `spin/tournament/carton_t24/onepunch/dragoon/free_spin`, stages `base_game/free_spins`, `opens/extends/ends when` all parsed. `e8 spin --n 300`: plays; `1 of 300 rounds did not complete on the first response (nextActions: free_spin)`. `e8 spin --action tournament --n 20`: `20 of 20 rounds did not complete` — the CLI can name a buy action, the browser route cannot. |
| Spec | `game/spec.json` | Descriptive only (id, betLevels[0] = the bet the page plays at). Symbol ids had to be numeric to satisfy the IDE (`Board = number[][]`, the Symbols document's `known` list) while the math emits `"ROCK"`. |
| Symbols | `symbols.yml` (11 + hole) | Static art works; `fit: contain` per state. Nothing for a symbol whose look depends on data (orb value, layer). |
| Scene | `scenes/base_game.scene.yml`, `big_win.scene.yml` | Renders. The frame art needs a non-uniform stretch (paper-duel sets width and height separately); one uniform `scale` misaligns it with the grid. |
| Flow | `flow.yml` | `boot → show → on → sound → spin → present → if win ≥ 20 → show/wait/hide` runs. A branch on `result.roundComplete == false` fires on a bonus trigger and can only `set` a var. |
| Plugin | `plugins/paper-duel` (mechanic + `pdHoles` + `pdTumble`) | The mechanic maps `init`/`cascades[].after/removed/losers/clusters` to `spinTo` + custom steps; `pdTumble` drives the legacy `TumbleController` with explicit `drops` (a port of `normalize.ts`'s `deriveTumble`). 3 unit tests on a captured spin. |
| Page | `src/main.ts` | first-slot's page, trimmed. The canvas had to be made 1920×1080 and CSS-fitted (see R5). |

Spin duration through the page: 5–11 s per spin at the legacy default
tumble timings (7 cascade rounds is normal for this game); no turbo, no
skip.

## Requests (what the WebIDE needs before this game can be correct)

Ordered by how much of paper-duel each one unblocks.

### R1 — Session play: step a round to completion (free spins)

`POST /api/spin` → `ctx.session.play()` → gRPC `StartRound` only
(`session-dev/src/e8server.ts`); `RoundResponse.next_actions` /
`spins_remaining` come back in `SpinResult` and nothing consumes them. paper-duel's Tournament Bonus,
retriggers, boss fights, the ×5 finale, ONEPUNCH and TOURNAMENT buys are all
`free_spin` steps of one round. Needed: `Step(round_id, action)` in
`session-dev`, a `step` flow kind (or `spin` with `action: $result.nextActions[0]`)
that carries `roundId`, and `present` bound per stage (the `free_spins`
stage data has the same `init`/`cascades` shape plus boss fields). The IDE's
own `e8 spin` already warns `a later e8 spin will step rounds to completion`.

### R2 — An action on the spin node (buy / feature / ante)

`spin` has an empty schema and the route hardcodes
`action: config.action ?? 'spin'` (`dev-game.ts`), and `project-scope`
never sets `config.action`. Needed: `spin { action, betLevel }` props (both
`$path`-resolvable), the route forwarding them. e8-server already accepts
them (measured through the CLI). This is also the only way to test a buy
mode's presentation in the IDE.

### R3 — Symbol ids as strings, and per-cell state in the step vocabulary

`Board = number[][]` (`contracts/presentation.ts`), `isPresentationStep`
rejects a non-numeric board, the board resolves art by `String(id)`. The
math emits `{ s: 'ROCK', l, ch, st, mv, dm }` per cell: the symbol name,
won-duel layer, champion flag, sticky/blocked marker, orb value, damage.
The legacy `CellData` already carries `symbol: string`, `multiplier`,
`sticky` and paper-duel augments it (`layer`, `champion`, `damage`), and
`SymbolResolver` is keyed by string — the restriction is only the
vocabulary's. Needed: `Board = (number | string | CellData)[][]` (or a
`cells` variant of `spinTo`/`refill`), so a mechanic can hand the board
what the math said and a symbol state can react to it (an orb showing its
×N, a layered symbol showing its badge). Today the plugin maps names to
indices and drops everything else.

### R4 — A `text` node type, and data-bound props

No node type draws text (`container/image/scene/reels/spritesheet/video/
gif/spine`). paper-duel's readouts that live on the canvas: the cascade
multiplier plaque, orb ×N, per-cluster win floats, the spin total, the
free-spins counter, boss HP, big-win count-up tiers. Needed: `text` (with a
bitmap-font/`PaperText`-style option) whose `text` prop can bind to a flow
var (`$result.data.cascades[i].casc_mult`) or be set by a flow `set`-like
node (`prop` kind: `target: <scene>/<node>, prop, value`). The same node
would drive the meters (`meters.rock` → a fill width) and the boss bar.

### R5 — Design fit in the GAME page (bug)

`scenes.resize()` is called only by `scene-edit` (`scene-edit/src/index.ts:90`);
`@energy8engine/scenes`' runtime never calls it, so `scenes1.design` is
ignored in the preview: a 1280×720 renderer with a 1920×1080 design showed
the design 1:1, clipped (*measured*, `shots/boot-1280x720-clipped.png`). first-slot hides
it because its design equals its canvas. Workaround in the example: a
1920×1080 canvas + CSS `width: 100%`. Fix: call `resize` from the scenes
runtime on the renderer's size (and on a renderer resize).

### R6 — `image` sizing: width/height (non-uniform), tint, anchor x/y

Common props are `x y scale rotation alpha visible anchor` (one number
each). paper-duel stretches `reels.webp` to the grid's inner area, tints
symbol outlines per tier, mirrors the right cloud (`scale.set(-cs, cs)`),
sizes the logo by height. Needed: `width`/`height` (or `scaleX`/`scaleY`),
`tint`, `anchorX`/`anchorY`.

### R7 — Grid-strip spritesheets

`spritesheet` takes a pixi JSON atlas (`sheet`). Every paper-duel sheet is
a raw grid strip sliced in code (`sliceGrid(alias, cols, rows)`: seven
death morphs, confetti 5×5, boss/king/knight idles at 2400×4320). Needed:
`spritesheet { src, cols, rows, frames?, fps }` so a strip is a node
without a generated atlas.

### R8 — Board access and a real tumble for mechanics

The built-in `cascade` mechanic's `refill` is `reelSystem.setBoard(...)`
— synchronous, no gravity, no drop (`reels/src/index.ts`). A tumble needs
the legacy `TumbleController`, which a plugin can reach only through
`board.grid` (the way `reel-step` does); the `ReelSystem` itself (its
`cascade`, `skip`, `fx` layer, `featureContext`, `config.cascade` timings)
is closed over inside `createReelsBoard`. Needed: either a built-in
`tumble` step (winning/removed/drops/fresh/settled, timings from the
`reels1` row) or `ReelsBoard.system` exposed to step handlers. Also: the
`reels1` row's `cascade.timings` are not visible to a plugin, so the
example carries its own copy.

### R9 — Turbo and skip

`play.execute(plan, board)` has no abort/turbo; `ReelSystem.skip()` and
`spin(..., { turbo })` exist in the legacy system but are unreachable.
paper-duel reads `ctx.turbo` at every pacing point and collapses on a
double-tap (`onSkip`, `ctx.signal`). Needed: a `turbo` flag on the
board/execute and a `skip` signal (a flow `on ui.skip` → `play.skip()`).

### R10 — The shell, the host and a production build

The IDE preview is a page with a Spin button. paper-duel's chrome is
`@energy8platform/shell` driven by `createSlotGame`: balance, bet ladder
and default bet, WIN readout with `reportWin` count-up, buy-bonus cards
with two-step confirmation, autoplay, turbo, Game Info with paytable and
illustrated sections, i18n (1,500 lines of copy), social-mode vocabulary,
the legal disclaimer, the fatal-error modal, the Stake bridge and the
`dist-stake` build. None of it has a home in a project yet, and there is
no build/export command in `engine/apps/cli`. Needed (the biggest item):
a decision on how a composed project becomes a shippable game — the
composition running inside the existing host (`createSlotGame` with the
flow as the scene controller), or the host's pieces becoming rows
(`shell1`, `stake1`) plus an `e8 build`.

### R11 — Responsive layout and the safe area

Scenes are laid out in fixed design units with `contain`/`cover`.
paper-duel lays out from `(w, h)` on every resize: portrait vs landscape
(`layoutMobileHud`), the shell's `safeArea.bottom`, the frame sized to
90 % of width / 72 % of height, the logo height-bound on desktop and
width-bound on phones, desktop-only theatre sheets. Needed at minimum:
per-node anchoring to screen edges/centre and a portrait variant of a
scene (or a second scene document picked by orientation), plus a
`safeArea` inset the design can reserve.

### R12 — Sound: categories, fades, ducking

`sound { src, action: play|stop, loop, volume, wait }` covers sfx and
music start/stop. Missing: music vs sfx categories with persisted volumes
and mute, cross-fade between loops, ducking under a big win — what the
host `AudioManager` gives paper-duel via `api.audio`.

### R13 — Spec derivation: `game.spec.ts` → prelude and `spec.json`

The IDE loads `game/*.spin` as-is. paper-duel's script needs the prelude
`buildSpinScript` prepends from `game.spec.ts` (SPEC/SYMBOLS/SYM/PAY_*).
The example ships the assembled file; a change to the paytable then has
two sources of truth. Needed: either `spec.json` grows the paytable and the
host prepends the prelude, or the IDE accepts a `game.spec.ts` and derives
`spec.json` + prelude from it (the platform's `defineGame`).

### R14 — Small ones

- `wait` on a pointer tap / a `tap` node: paper-duel holds the intro and
  outro cards for a tap (`waitForTap`).
- Symbol-cell overlays: a state layer drawn OVER a cell from its data
  (badge, crown, crack) — falls out of R3 + R4.
- Scene-level `mask`/`graphics` nodes (the rope cords, the boss HP clip,
  the dim-non-winners layer are `Graphics`).
- The `image` node has no `.avif`; `.webp` works (measured).
- Mobile asset tier: one `src` per node; paper-duel picks `assets/` or
  `assets-m/` by viewport at boot.
- `flow` has no per-run vars view for a test to read (`FlowService` has
  `trace()`, not `vars()`); the example's probe reads the trace.

## What needs no request

- `.spin` dialect: paper-duel's script (records, tagged enum, `opens ...
  count`, `extends`, `ends when`, `session = true`, `feature { spins }`)
  parses and runs on the repo's e8-server (a different binary from the
  one paper-duel's `node_modules` carries — sha differs — same result).
- `reels1` config passthrough: `cellSize`, `gap`, `frameStyle`, `motion`,
  `cascade` reach the legacy `ReelSystem` untouched (measured against the
  row's schemastery schema), and the composition form spreads unknown keys
  on edit (`fields.tsx:122`), so an IDE edit of `cols` does not drop them.
- Project plugins: the `plugins/<name>` convention (mechanic + step
  handlers, `ctx.inject` on `mechanics`/`steps`) was enough for the
  holes + tumble presentation; nothing in the engine had to change.
- Flow expressions over `result` (`result.win >= 20`,
  `result.roundComplete == false`) and `show`/`hide`/`wait` for a banner.

---

# Round 2 — 2026-09-21, after slices 22–28

Branch at `a95e7d6` (slice 28). The example was re-done on the new seams;
everything below marked *measured* was run through the real page in headless
Chromium (`scripts/probe-page.ts`), the CLI, or `e8 build`. Screenshots:
`engine/examples/paper-duel/shots/v2-*.png`, `v2p-*.png` (portrait).

## Verdict, round 2

**The game now plays end to end in the IDE: buy → bonus intro → free spins
stepped through the flow → back to base, through the Pixi shell, on
paper-duel's own math and art — with a project plugin that is a 150-line
pure mechanic and nothing else.** R1–R14 are closed as far as this game
can tell. What is still not paper-duel is its *presentation*: the layer
that reacts per cascade round (meters, the climbing plaque, per-cluster
floats, duel strikes, dominance FX, orb flights, boss fights). The flow
sees a `present` as one atom, a symbol state is one node, and a prop value
is one `$path` — those three are the round-2 requests.

Measured, in one run (`probe-page.ts 1 tournament`):

- base spin under turbo: 4.2 s (7 cascade rounds); balance charged 0.2,
  win credited, bar readouts updated;
- `selectBuyBonus('tournament')` → `spin { action: '$event.id' }` →
  intro card (tap / 4 s) → `shell mode: freeSpins` → **11 free spins
  stepped** (8 + a retrigger; `shell.freeSpins` total followed `fs_total`),
  the sign showed `mult_running` (48 at the end), the counter `fs_remaining`,
  a 20×+ segment raised the big-win banner with the amount and ducked the
  music, the round completed, `ack`, mode back to base, base music back.
  61 s without turbo. Zero errors; one warning (`HOLE` not in spec.json —
  by design).
- portrait 390×844: fit 0.361, the `portrait` block re-laid the board,
  sign, meters, logo; the bar went mobile.
- `e8 build` (default and `--target platform`): clean, one `game` chunk,
  5.5 MB dist; the default dist boots to the full game screen over a
  static server and reports `session-host: /api/session 404` (no host —
  expected).
- math: `e8 spin --n 20000` twice — `incompleteRounds: 0`, ~800 free spins
  per run, **rtp 1.28 / 1.44** (hit 0.36, max 937× / 1197×). paper-duel's
  spec declares 0.967. Either the working-tree `script.spin` (its repo has
  an untracked `math.repro.config.ts`) or the CLI's per-round bet
  accounting (slice 23 debt 1) — check against the game's own
  `npm run sim` before trusting either number. Not an IDE gap.

## R1–R14 against the example

| # | Request | Round 2 |
|---|---|---|
| R1 | Session `Step` | ✔ `step` loop drains the bonus (11 spins, retrigger included) |
| R2 | `spin.action` | ✔ buys via `$event.id`; features via `$shell.activeFeature.id` (`FEATURE=dragoon` probe: `feat:true → spinF:result`) |
| R3 | String ids + cell state | ✔ `BoardCell` all the way to `symbols()`; `$cell.<field>` exists — but see N1 |
| R4 | `text` + data binding | ✔ five `text` nodes driven by `prop`; see N3 for what a value cannot be |
| R5 | Design fit in the page | ✔ scale 0.656 / 0.361, safe rect excludes the bar |
| R6 | `width`/`height`/`tint`/anchors | ✔ the frame is stretched over the grid |
| R7 | Grid-strip sheets | ✔ `strip` exists (unused here — the sheets belong to per-step FX, N2) |
| R8 | Tumble / board access | ✔ built-in `tumble` with explicit `drops`; the plugin lost its two handlers |
| R9 | Turbo / skip | ✔ 4.2 s vs ~7 s; `ui.skip`/`ui.tap` |
| R10 | Shell / session / build | ✔ `shell-pixi`, dev wallet, `e8 build` both targets |
| R11 | Responsive | ✔ pins + `portrait` block |
| R12 | Sound categories / duck | ✔ music loop, `audio` duck under the banner, mode switch with `fade` |
| R13 | Spec prelude | ✔ raw logic `.spin` + `GameSpec` `spec.json`, same sha256 as the game's own assembly |
| R14 | tap wait, shape, … | ✔ `wait { event: ui.tap, ms }`, `shape` dim |

## New requests (round 2)

### N1 — Composite symbol states

`SymbolNode` is `{ type, props }` — one node per state, no children, and an
asset prop cannot bind. paper-duel's orb is star art **plus** its ×N
(`$cell.mv`), a layered symbol is art plus a tier badge (`$cell.layer`),
a champion adds a crown, a damaged cell a crack. Today the choice is the
art without the number, or a bare `text` state without the art.
Needed: children on a state (a `container` state with an `image` and a
`text` under it, bindings reaching every child), or a `scene` state whose
document's nodes may read `$cell.*`. Workaround for orbs alone: 14
pre-rendered images, one symbol id per value (`MULT#64`) — which the
mechanic can emit today.

### N2 — Per-round steps that reach the scene, the shell and the bus

Everything paper-duel does *between* cascade rounds is invisible to the
flow: `present` is one node, `on` cannot fire while a run is busy, and a
plan step can only be a board step or a plugin's handler. Meter fills,
the plaque climbing `casc_mult`, per-cluster win floats, `reportWin`
climbing with the floats, a `sound` per removal, a beat before the duel —
all of it is `GameScene.onSpin`'s loop, and the only home for it today is
a project `StepHandler` in pixi.
Needed: built-in **presentation step kinds that are not board steps** —
`prop` (`scenes.setProps`), `shell` (a readout), `sound`, `wait`, `emit`
— so a mechanic emits `[spinTo, prop meter_rock…, revealWins, sound,
tumble, …]` and the documents keep the look. Equivalently: `present`
emitting `present.step { index, kind, step }` on the bus with a run-local
`on` that may fire while busy. Either closes most of §"what does NOT
port" without a line of pixi in the project.

### N3 — Value expressions and formatting

`prop.value`, `shell.*`, `tween.*` take one literal or one `$path`. The
sign shows `48` (not `x48`), the float shows `4.604` (not `$4.60`), the
counter cannot show `current/total` (`fs_total − fs_remaining`), and
`shell.freeSpins` cannot be given `{ current, total, totalWin }` (so the
bar's TOTAL WIN stays 0.00 through the bonus — `v2-bigwin.png`).
Needed: a template string (`'x{$result.data.mult_running}'`), a
`format` (`currency`, `multiplier`, `int`), arithmetic in `$`-expressions
(the `if` evaluator already parses comparisons), and object-valued props
or scalar siblings (`freeSpinsCurrent`, `freeSpinsTotalWin`).

### N4 — Named symbol states and a state-on-cells step

Symbol states are `static`/`idle`/`win`. paper-duel plays a per-type
**death** sheet on a duel loser (`strip` art per symbol) and a scatter
celebration on `BONUS` — states the mechanic wants to trigger on chosen
cells at a chosen beat, not on a win. Needed: arbitrary named states in
`symbols.yml` (`death: { type: strip, … }`) and a `playState { cells,
state }` step (or `revealWins { state }`), awaited like `once`.

### N5 — Count-up and number tweens

`tween` moves x/y/alpha/rotation/scale. The banner's amount and the bar's
WIN count up in paper-duel; a `text` node's number cannot be tweened.
Needed: `tween { prop: text, from, to, format }` on a `text` node (ties to
N3's `format`).

### N6 — The static default build's session

`e8 build` freezes `composition/flow/scenes/symbols` but not
`/api/session`; the default-target dist boots with `balance 0` and a
`session-host … 404` warning. Expected without a host, but the warning
reads like a defect. Either freeze a `session` document too (a dev wallet
for a static preview) or say "this build needs a host or
`--target platform`" once, at build time.

### N7 — Smaller

- `session-host`'s dev wallet charges `betLevel` for every action: buying
  TOURNAMENT (100× in the spec) moved the balance by −0.2 + the win. The
  spec's `actions[*].cost` is not applied — a dev-only accounting gap, but
  the one number a designer watches while tuning a buy.
- The reels node's origin is reel 0's cell centre: the scene author has to
  know `cellSize`/`gap` to centre a board (`x: 565, y: 224` here). A
  `reels` prop `origin: center` would spare the arithmetic.
- `gameInfo` paytable from the spec (round-1 R10 debt 4) — `sections: []`
  here; the spec has every pay row.
- `shell.freeSpins` as a bare number shows the total only; with N3 this
  goes away.
- `e8 spin`'s `rtp` line should say whether free spins were charged
  (slice 23 debt 1) — the 1.28/1.44 above cannot be read without it.
- The example's `bonus_intro` uses the desktop-tier 1254² card sized by
  `width`/`height`; a mobile tier per node is still one `src` (round-1 R14).

## What was not attempted (plugin code either way)

Duel lunges and contact-timed death morphs, dominance strikes (tape / cut
/ cover), the rule-breaker sweep, wild-glue splash, confetti, orb flights
into the sign, board recoil and rope swing, the curtain intro/outro, the
retrigger banner, the boss theatre and HP bar, Game Info art, i18n. With
N1–N5 most of the *data* half of these (which cell, what value, when)
becomes a plan step and a document; the *motion* half stays a plugin's
`StepHandler` — the same split the reel-step plugin already lives in.

---

# Round 3 — 2026-09-22, the full migration

Branch at `76c7bd00` (slice 30). The user asked for a FULL migration rather
than another reduced example: the whole game, its art, its presentation.
`engine/examples/paper-duel` is now that. Measured through the real page in
headless Chromium unless stated; screenshots in `shots/v3-*.png`.

## What the migration is

| | |
|---|---|
| assets | 33 MB, 112 files — paper-duel's whole DESKTOP tier, plus the two theatre halves `scripts/cut-halves.mjs` cuts (a scene `image` has no frame/crop, and `theatre.ts` slices them out of one sheet) |
| math | `game/script.spin` — the authored, logic-only file, byte for byte; `game/spec.json` is a real `GameSpec`, so the host assembles the prelude itself |
| documents | `symbols.yml` (16 entries, `death` strips, four orb cell scenes), 12 scene documents (theatre, board rig, intro, big win, bonus intro/outro, retrigger, preload, four orbs), `flow.yml` 109 nodes — 835 lines total |
| plugin | 1,835 lines: the mechanic (a plan per segment), eleven `pd*` step handlers, the opening, the ambient stage, `paperFont.ts` and `symbolContours.ts` ported as they were |
| shell | `e8.patch.yml`: four buy cards, turbo 2, autoplay, and the ten Game-Info sections paper-duel's `main.ts` authored |

Everything the original draws now draws, with these exceptions, listed under
"What is still missing" below.

## Measured

- **A spin plays the original's beats.** One plan per segment, in
  `GameScene.onSpin`'s order: `spinTo` → per round `pdSign`, `pdRuleBreaker?`,
  `pdWilds?`, `pdDuels` (lunges, trails, and each loser's `death` state on the
  contact frame), `refill` (the scar), `pdTiers`, `pdClusters?` (spotlight, per
  group float, the WIN readout climbing), `pdConfetti`, `tumble` (stay-aware
  drops), `pdTiers`, `pdDominance?`, `pdMeters`, `pdOrbs?` → `pdBoss?` →
  `playState(scatters,'win')`. Sounds ride `emit` steps and land on parallel
  `on { busy: parallel }` branches in the flow.
- **Timing**: 9.4 s turbo / 20–27 s plain for a base spin — these are 7–9 round
  cascades, and the pacing constants are the original's (`DUEL_HOLD_MS` 600,
  cluster beat 320, the legacy tumble's own ~1.5 s). A bought TOURNAMENT ran
  191 s across 11 free spins (with a retrigger), every segment stepped by the
  flow.
- **The Layered Winners overlay is right**: `shots/v3-tiers.png` — the bronze
  halo, the electric outline tracing the symbol's own contour, and the
  papercraft `×2` badge, on a cell whose data reads
  `{"symbol":"ROCK","layer":1,"badge":"x2"}`.
- **The meters fill and carry** across spins (`rock 7 / scissors 4 / paper 1`
  after one spin, `8/8/7` after the next), the sign reaches `x80` in a bonus,
  the counter reads `SPIN 8 / 11`, the boss trough drains and the boss on stage
  swaps in for the king.
- **The opening plays**: the wall lights, castles and veils slide in, the
  parapet rises, king and knight sail in, three captioned cards come down on
  cords and settle with a swing; a tap hauls them up and the rig drops in on
  its ropes.
- **Game Info** renders all ten sections (`shots/v3-info-*.png`); the paytable
  is derived from `game/spec.json` by the shell row.
- **Portrait** (390×844) re-lays the board, meters, sign and counter, and shows
  one intro card instead of three.
- **`e8 build`**: clean, 121 files, 38 MB; the dist boots to the opening.
  `e8 spin --n 5000`: `incompleteRounds: 0`, rtp 1.39 (see round 2's note — the
  declared 0.967 is the game's own math question, not the IDE's).
- Unit: 5 plan tests on a captured spin; `npm run typecheck` clean in both
  packages.

## What slices 29–30 changed for the port

Everything round 2 asked for is in use here: `emit` steps (the whole mix),
value templates and formats (`SPIN {…} / {…}`, `{…|currency}`), `count` (the
big-win amount), cell scenes (the orbs' `×N`), named states (`death` per
symbol type, `win` on the scatter), `playState`, `reels.origin: center`, the
spec-derived paytable, the dev wallet's per-action cost. Two of them changed
the shape of the port rather than just enabling it: the plan can now carry
BEATS (`emit`), so the flow owns the mix without knowing the cascade, and a
symbol can be a document, so the orb needed no plugin code at all.

## New findings (round 3)

### F1 — A plugin's own art is loaded by nobody

The scenes row preloads exactly what the DOCUMENTS name (`assetsOf`), and a
step handler's textures are named in TypeScript. Every sheet the plugin draws
with — the duel FX, the dominance art, the cluster frame, the crown, the
glows, the number font — silently resolved to nothing until a
`scenes/preload.scene.yml` was added: 21 invisible `image` nodes parked at
`-4000,-4000` purely to make the loader fetch them. Needed: a way for a row to
declare its assets (`e8.runtime.assets` in the manifest, or an `assets` service
a plugin can push paths into) — or, at minimum, a diagnostic when a handler
asks the loader for a path no document names.

### F2 — Node ids are unique per DOCUMENT, and nothing says so until it breaks

Three meters, each a `container` with a `bar` child and ten cells, produced
`node "bar" is declared twice — the later one is skipped`, at ERROR level, for
a document that is otherwise perfectly ordinary. The ids had to become
`rock_bar`/`rock0`… Either scope ids to their parent (a `SceneRef` would then
be a path, which `scenes.view` already half-supports through `where`), or say
so in the schema-level docs; today the rule is discoverable only by tripping it.

### F3 — `$cell.<field>` takes a bare field, so the mechanic pre-computes the view

A cell scene's prop can read one field and nothing else — no `x{$cell.mv}`, no
`$cell.layer > 0`. So `toLeaf` emits `label: 'x64'`, `badge: 'x5'`,
`champion`, `damaged` — view strings computed in the mechanic because the
document cannot compose them. Slice 29's `resolveValue` (templates, formats,
arithmetic) exists one layer up, in the flow; the same resolver on `$cell`
would remove that whole class of pre-computation.

### F4 — An asset prop still cannot vary with the cell

`image.src` cannot bind, so four orb bands are four documents plus four symbol
ids the mechanic swaps in. It works, and it is the right trade for preloading —
but a symbol whose ART varies by value (a 14-step orb ladder, a per-tier frame)
pays for it in documents. A `src` chosen from a declared SET (`src: { field:
'$cell.band', of: [...] }`, all preloadable) would cover every case this game has.

### F5 — The plan is serial, and the original overlapped

`executePlan` awaits every step. paper-duel fires the death morphs from a
`Tween.delay` inside the duel beat and never waits for them; expressed as a
`playState` step, that beat cost 600 ms twice and a spin went from ~20 s to
~30 s. The fix here was to play the state from inside `pdDuels` — i.e. to move
work OUT of the vocabulary to get the timing right. A step that declares
itself non-blocking (`wait: false`, as `emit` already has) would let a plan say
"start this, keep going".

### F6 — A row cannot hook the ticker through a service

The tier overlay follows falling cells, so it needs a per-frame callback. The
plugin reaches `ctx.renderer.app.ticker` directly — fine for a project plugin,
but it is the one place the migration touches pixi's application object rather
than a service. An `onFrame(fn)` on the scenes or renderer row would keep that
contained (and would let the runtime stop it with the row).

### F7 — Smaller

- `shell.i18n` is still reserved (slice 26 debt 4): every string in the
  documents is English, and paper-duel's 1,561-line `i18n.ts` has nowhere to go.
- No mobile asset tier: one `src` per node, so the migration ships the desktop
  tier at 33 MB (the original picks `assets-m/` at boot by viewport).
- `strip` has no "play once then hold" — `knight_attack` is shown/hidden by the
  plugin on a timer because a strip cannot report that it finished (its `once`
  is reachable only through a symbol state's `playState`).
- The boss's on-stage HP bar and its rope/sway are not ported (the HUD trough
  is); `IntroCards`' MeshRope cords and pendulum integration are a tween-based
  swing here; `flashFieldBorder`'s animated lightning border and the per-symbol
  drop shadows are not ported.
- A `count` on a node inside a hidden scene still counts (the big-win amount is
  fine because the scene is shown first) — worth a note in the kind's docs.

## What is still missing from the game

Ranked by what a player would notice: the bitmap-font readouts elsewhere (the
sign and the counter use web text), the boss's on-stage HP bar + rope,
`flashFieldBorder`, per-symbol shadows, the mobile tier, i18n, and the intro's
real cord physics. Everything else the original draws, this draws.


---

# Round 4 — 2026-09-23, after slices 31–32

Branch at `f23e90d8`. Slices 31 and 32 answered F1–F6 of round 3; this round
puts them to work in the migration and ports what round 3 had left out.
Measured through the real page in headless Chromium unless stated.

## What the new seams changed in the game

| seam | what it replaced here |
|---|---|
| `scenes.require(paths)` | the `preload` document — 21 invisible `image` nodes parked at `-4000,-4000` — is GONE; the row declares its 25 paths (`PLUGIN_ART` in `steps.ts`) and the loader fetches them |
| `srcOf`/`srcKey` | the four orb documents collapsed into ONE (`scenes/orb.scene.yml`), its art keyed by `$cell.band`; `symbols.yml` lost three ids and `game/spec.json` four |
| `$cell` expressions | the orb's number is `text: 'x{$cell.mv}'` — the mechanic stopped composing view strings (`label`, `badge`) and now emits only what the math says (`mv`, `band`, `layer`, `mult`, `champion`) |
| `wait: false` | the death morph is a `playState` step again (round 3 had to fold it into `pdDuels` to stop paying for its beat twice); `pdMeters` and `pdConfetti` are non-blocking too |
| `scenes.onFrame` | the tier overlay's per-frame sync, and the new field border, no longer reach `ctx.renderer.app.ticker` |

## Ported this round (round 3 left these out)

- **The boss on stage**: he comes down on his own cord with a decaying swing
  (`dropBoss`), carries the per-boss trough over his head with the HP bar
  clipped by a mask node, takes the impact star on a hit, and goes back up when
  defeated — the king returns. The HUD trough still mirrors him (portrait).
- **The Rule Breaker's field border**: the lightning ring around the board,
  charge → hold → fade, drawn per frame through `onFrame`.
- The king/knight "show" flourish (slice 30's strips, swapped on a timer).

## Measured

- Base spin, plain: **2.4–2.6 s per cascade round** (19.0 s / 7 rounds, 20.8 s /
  8, 12.3 s / 4) — the original's own constants are ~2.5 s/round. Turbo halves
  it (12.1 s / 7 rounds, 7.6 s / 4).
  An earlier reading of 4.3 s/round was a loaded machine (load average ~19),
  not the code: the same plans re-measured at 2.6 s with nothing changed that
  touches them. Reported here because the first number was in my own notes.
- A bought TOURNAMENT plays the whole bonus: intro card, 11 free spins with a
  retrigger, boss drop + HP drain, sign to ×80, `SPIN 8 / 11`, the big-win
  ladder, outro, back to base music. `freeSpinsTotalWin` now feeds the bar's
  TOTAL WIN (round 3 used `bonusTotalWin` and warned).
- `npm test` 5, `npm run typecheck` clean, `e8 build` 121 files / 38 MB,
  `e8 spin --n 5000` `incompleteRounds: 0`.

## New findings (round 4)

### F8 — A document that is mounted but not yet shown warns about its own art

`replace()` mounts every declared document (hidden); `load(id)` runs on
`show(id)`. So every `image` in a document that has not been shown yet calls
`assetLoader.get()` before anything loaded its art, and — once the first batch
has settled — each one reports `nothing loaded "assets/…"`. In this migration
that is `big_win`, `bonus_intro`, `bonus_outro`, `retrigger` and, while the
opening is up, all of `base_game`: eight to twelve warnings per boot, every one
of them false (the art loads when the scene is shown, and draws). The check
wants to know whether a path is reachable AT ALL, not whether it is loaded yet:
either count the paths of every declared document as "asked", or defer the
verdict to the first `show` of the document that named it.

### F9 — A full-board `refill` is the most expensive step in the vocabulary

`SymbolCell.setData` destroys and re-resolves a cell's view unconditionally
(slice 30 debt 1), so a `refill` rebuilds thirty symbol views — and this game's
plan has one per cascade round (the duel's scar beat) plus the tumble's own
settle. It is the step to diff first (only cells whose data changed), and until
then a mechanic pays for a beat the player cannot see. The migration now skips
the scar `refill` when the duel changed neither a hole nor a layer, which is
the same rule stated in the plan rather than in the board.

### F10 — Smaller

- `require` is per ROW, so a plugin lists its art twice: once in TypeScript
  (where it draws) and once in the `PLUGIN_ART` array. A `require` that took
  the same map a node's `srcOf` does would let one table serve both.
- An asset SET is per node (`srcOf` + `srcKey`), so the boss trough's three
  variants live on the node while the plugin still names the same three files
  for the HUD trough's plain `src` — two spellings of one set.
- The bitmap number font is still plugin-side (`PaperText`): a `text` node's
  `font` prop wants a pixi `BitmapFont`, and paper-duel's is a raw atlas with
  measured glyph boxes. A `text` node that could take a glyph MAP would put the
  sign, the counter and the floats in the game's own font.
- Still open from round 3: i18n has no hook in the shell row; there is no
  mobile asset tier (one `src` per node, so the migration ships the desktop
  tier at 33 MB); `strip` cannot report that it finished (the knight's attack
  is hidden on a timer).


---

# Round 5 — 2026-09-25, on the engine's own reel system

Branch at `18bee13a`. Slices 35–36 replaced the legacy
`@energy8platform/game-engine/slot` with `@energy8engine/reel-core` plus four
rows (`reels1`, `motion1`, `anticipation1`, `cascade1`) and a fifth
(`features1`) carrying nine feature steps. This round moves the migration onto
them and uses what fits.

## What changed in the project

- **`reels1` is flat.** The old `config.config.{grid,cascade,motion}` became
  `reels1 { grid, win }` + `motion1 { style: cascade-drop, squash }` +
  `cascade1 { gravity, timings }`. The "two switches" of slice 25
  (`mechanics1.tumble` AND `cascade.enabled`) are gone: `cascade1`'s presence
  IS the switch, and nothing in the patch says `tumble` any more.
- **`win` is a row field now**: `highlightScale: 1.12, glow: false` — this game
  paints its own papercraft cluster frame, so the board only pops the symbol.
- **A nested copy of the legacy engine was resolving.** The example pinned
  `@energy8platform/game-engine: ^0.41.0`, which 0.x semver does not satisfy
  with the workspace's 0.44.1, so npm had nested a 0.41.0 under the project —
  the plugin's `Tween` was a DIFFERENT module from `reel-core`'s, with its own
  registry (a `killTweensOf` in one could never reach the other's). Now `"*"`,
  and the nested copy is gone. Slice 35 hit the same trap inside `reel-core`;
  it is worth a line in the plugin docs, because a project written against
  `0.41` looks perfectly reasonable.
- **One of the nine features earned its place.** ROCK's dominance LOCKS the
  cells it reinforced (`sticky_layer`), which is exactly `sticky { cells, on }`:
  a persistent ring on the row's own overlay layer that outlives the tumble and
  the plan. The mechanic emits it with `wait: false`, remembers what it locked,
  and takes the rings off at the top of the next segment. The game's own tape-X
  art still plays on the same beat — the ring says the lock is still on, the
  tape says it just happened. *Measured*: `shots/v5-sticky.png`, two rings up
  (`__e8.featureOverlays()` → `{ sticky: 2 }`) beside this game's own ×3/×5/×10
  badges.

## Measured

- **Faster than the legacy system**: a plain base spin is **~2.0 s per cascade
  round** (14.4 s / 7 rounds, 15.3 s / 8, 11.1 s / 5) against ~2.5 s on the
  legacy one, same timings in the config; turbo ~1.1 s/round (8.2 s / 7,
  7.6 s / 7 in portrait).
- The bonus is unchanged end to end: intro, 11 free spins with a retrigger,
  boss drop and HP drain, ×80 sign, `SPIN 8 / 11`, big-win ladder, outro
  (191 s, the same as round 4's).
- `npm test` 5, `npm run typecheck` clean, `e8 build` 121 files,
  `e8 spin --n 3000` `incompleteRounds: 0`, portrait unchanged.
- Nothing in the project imports `@energy8platform/game-engine/slot` any more;
  the one legacy import left is `animation`'s `Tween`/`Easing`, which the
  engine's own rows (`reels-features`, `reels-cascade`) still use too.

## Findings (round 5)

### F11 — Eight of the nine feature steps do not fit this game, and that is the finding

`sticky` fits exactly. `multipliers` looks like paper-duel's orbs and is not:
an orb is a SYMBOL carrying its value (drawn by its own document), not a
multiplier stamped on a cell, and the collection beat is a flight into the sign
— the game's `pdOrbs`. `reveal` looks like the scatter celebration and is not:
the original plays a per-symbol sheet, which is a symbol STATE (`playState`),
not a board feature. `expandWild`/`walkWild`/`dropWilds`/`transform`/`giant`/
`nudge` have no counterpart here at all. So a real game used 1 of 9 — worth
knowing before the set grows: the nine are a library to pick from, not a
checklist, and the two near-misses (`multipliers`, `reveal`) are near-misses
because the game keeps that state on the SYMBOL rather than on the CELL.

### F12 — A feature's overlay outlives the plan, so the mechanic owns its lifetime

`sticky` rings live on the row's own layer and survive the board, the plan and
a skip — which is what makes them usable, and also what makes a plan
responsible for taking them off. This mechanic now keeps module state (the
cells it locked) between calls, which a "pure mechanic" otherwise never needs
(`giant { clear: true }` is slice 36's own version of the same debt). A
`sticky { clear: true }`, or a sweep on the next `spinTo`, would keep the
mechanic pure.

### F13 — The row's schema is where a game's reel tuning lives now, and that is a better home

Round 3 had to carry `frameStyle`, `motion`, `cascade` and `evaluation` inside
one opaque `reels1.config.config` blob because the row's schema described only
`grid.cols/rows`; every knob was invisible to the IDE. The flat shape plus the
three sibling rows puts all of it in the schema-driven form — the migration's
patch is now readable as data rather than as a legacy config object, and the
tumble timings are editable in the IDE without touching the project.


---

# Round 6 — 2026-09-25, off the legacy platform engine

Branch at `3da3978c`. Slice 37 took `@energy8platform/game-engine` out of the
engine: what it actually used was one module, and `Tween`/`Easing` are now
`@energy8engine/tween` (`SpriteAnimation` forked into `reel-core`). Its own
guard walks `engine/` and skips `paper-duel`, which slice 37 listed as debt 1
— this round closes that debt from the project's side.

## What changed in the project

- **The plugin tweens through `@energy8engine/tween`.** One import in
  `fx.ts`; the dependency in both `package.json`s is now `@energy8engine/tween`
  and the legacy package is gone from the project entirely (no source, no
  manifest, no nested copy — round 5 removed a 0.41.0 that npm had restored).
  This matters beyond tidiness: the plugin's tweens and the board's are now the
  same module, so a `killTweensOf` on either side reaches the other's — the
  case round 5 could only describe.
- **`sticky { clear: true }`** (slice 37) replaced the module-level `locked`
  list F12 named: every segment opens with one clear step instead of a
  mechanic remembering what it locked. The mechanic is pure again.

## Measured

- `sticky` still goes up and now demonstrably comes off: 2 rings survive their
  spin (`__e8.featureOverlays()` → `{ sticky: 2 }`), the next spin's first step
  clears them — 0 mid-spin and 0 after (`scripts/probe-sticky-clear.ts`).
- Base spin ~2.0 s per cascade round (14.5 s / 7 rounds, 15.1 / 8, 11.0 / 5),
  the same as round 5 — the tween fork is byte-identical behaviour, as slice
  37 claimed.
- The bonus end to end: 188.8 s, 11 free spins with a retrigger, boss, ×80
  sign, big-win ladder, outro. `npm test` 5, `npm run typecheck` clean,
  `e8 build` 121 files, no console errors.

## Finding (round 6)

### F14 — A project pinning a version the workspace cannot satisfy gets a silent second copy

Round 5 found the nested `@energy8platform/game-engine@0.41.0` under this
project (the pin was `^0.41.0`, the workspace ships 0.44.1, and 0.x semver
does not match across minors). Deleting `node_modules/@energy8platform` fixed
it — and npm put it back at the next install, because the manifest still asked
for it. The lesson is not about that package: ANY project dependency that also
exists in the workspace can nest a second copy, and a module with
module-level state (a tween registry, an asset cache, a service singleton)
then exists twice with nothing saying so. The engine could notice: a boot
check that compares the identity of what the rows loaded against what the
project's own plugin loaded (`ctx.reflect.get('tween')`-style, or simply a
`console`-level warning when two copies of a known engine package are
present) would turn a silent class of bug into one line. Slice 37's guard
covers `engine/`; a project is exactly where this happens.


---

# Round 7 — 2026-09-26, the user looked at it and it was wrong

The user ran the port and listed seven things: no theatre assembly in the
opening, the opening ending by itself, a board with no symbols on it, crooked
cards on the wrong ropes, broken fonts, a broken hand-off into the bonus.
All seven were real. This round is the investigation, the fixes, and the one
engine finding underneath four of them.

Every claim below was measured on the running game (`scripts/probe-intro.ts`,
`probe-stage.ts`, `probe-ambient.ts`, `probe-curtain.ts`, `probe-idle.ts`),
not read off the source.

## F15 — `scenes.view()` answers a copy nobody can see

**This is the one that matters.** A `scene` node mounts the referenced
document AGAIN as its own subtree: nesting is by copy. `setProps` and `once`
know this and act on EVERY copy — the code says so in as many words
(`entriesOf`: "`show()` of it flips the EMBEDDED copy, so patching only
`entryOf`'s would write to the copy nobody can see"). `view()` does not: it
answers `entryOf`, the document's OWN top-level mount, which for a nested
document is exactly the copy nobody can see.

So a plugin that reaches for a `Container` to tween gets the wrong one, in
silence. Nothing warns, nothing throws, the numbers move.

Measured before the fix, while the opening played (`probe-intro.ts` samples
`__e8.nodeProps`, which reads the same `view()`):

```
 750 ms  castle_left.x=630      ← screenshot: castle at home
1000 ms  castle_left.x=86       ← screenshot: castle at home
1250 ms  castle_left.x=600      ← screenshot: castle at home
1500 ms  castle_left.x=630
```

The castle slid 630 → 86 → 630 in the numbers and never moved on screen. The
whole diorama assembly, the king's and the knight's ambient flourishes, the
knight's attack, the boss dropping in on his cord and his HP bar draining —
every one of them was animating an off-screen copy for four rounds of this
port. The parts that DID work were the parts written with `setProps`, which
is why the boss looked like it worked: he appeared (a `setProps` visible) and
never moved (a `view()` tween).

Three ways the engine could close it, in the order we'd want them:

1. **`view()` answers the copy that is on screen** when there is one — i.e.
   prefer an entry whose mount is visible over the document's own mount.
   That makes the asymmetry with `setProps` go away and breaks nothing that
   is right today.
2. **`views(ref)`** — the plural, next to `entriesOf`, so a caller can drive
   all copies the way `setProps` does.
3. **Say something.** If (1) is too sharp a change, `view()` on a document
   that some visible scene nests could report a diagnostic once. A silent
   wrong answer is the worst of the three.

The project's own way out, which is what this round did: **do not nest the
diorama.** `theatre` is now its own top-level document, shown by the flow
before `intro` and `base_game`, exactly as `theatre.ts` was one object shared
by `IntroScene` and `GameScene`. One mount, `view()` finds it, and the
portrait cover-fit lands on the document's own root instead of on an
embedded copy where a `pin` is inert anyway. `bonus_intro`/`bonus_outro`
came out of `base_game` too — a nested document is drawn INSIDE its host, so
a card nested in `base_game` can never be over a curtain shown after it.

After the change, the same probe:

```
 148 ms  [theatre,intro]  back.a=0.00  castle.x=-410  veil.x=-560  panel.y=1189  king.x=-720
 278 ms  [theatre,intro]  back.a=0.59  castle.x=-410  …
1344 ms  [theatre,intro]  back.a=1.00  castle.x=28    …
1880 ms  [theatre,intro]  back.a=1.00  castle.x=630   veil.x=-560  …
2276 ms  [theatre,intro]  back.a=1.00  castle.x=630   veil.x=217   …
```

and on screen: house lights up on a bare wall → castles slide in → veils →
the parapet rises → king and knight sail in. `probe-ambient.ts` now sees
`king_show` and `knight_show` play; `probe-stage.ts` across a bought
TOURNAMENT sees `boss_rock`, `boss_cord`, `boss_bar`, `knight_attack` and the
HP bar draining to 0.05 of its channel.

## F16 — A `show` re-applies the document's props, so a pose set before it does not survive

The opening has to pose the diorama BEFORE it is seen (`resetForIntro`). The
poses are set through `view()`, which works — every document is mounted at
boot, so its views exist long before `show`. But `show(id)` loads the
document's art, and `loadPaths` ends with `refresh()`, which re-runs every
node's `update` from its document props. The pre-assembly pose is wiped by
the load, and the first frames on screen are the fully assembled stage:

```
  25 ms  []                 castle.x=630   ← not shown yet
 213 ms  [theatre,intro]    castle.x=630   ← ON SCREEN, assembled  ← the flash
 344 ms  [theatre,intro]    castle.x=-410  ← the pose finally lands
```

~130 ms of the wrong picture, every boot. There is no "mount but do not
show" step a project can pose into, and no hook between the load and the
reveal.

The way out, which works but is a trick: the flow sets
`theatre/stage.visible = false` with a `prop` node before `show`, and the
plugin's own reset turns it back on through `setProps` (not through the
view — a `prop` patch is live on the mount, so the next refresh would put
`visible: false` back). Measured after: at 148 ms the scenes are on screen
and already dark and offstage. No flash.

What would make this unnecessary: a `show(id, { before })` hook, or simply
`scenes.load(id)` as its own call so a project can load, pose, then show.

## F17 — `emit` is fire-and-forget, so a flow cannot wait for a plugin's animation

The opening is "assemble, lower the cards, THEN listen for a tap" — the
original only builds its tap catcher after `playIntro()` resolves. A flow
`emit` returns at once, so the flow's `wait { event: ui.tap }` was armed
while the assembly was still playing, and a tap during it ended the opening
half-built. The project's answer is an ack event the plugin emits when its
handler's promise settles (`pd.introReady`), and a second `wait` node for it.
That works, and every project doing set-piece work through `emit` will write
the same two nodes. An `emit { await: true }` — settle when the last
listener's returned promise settles — would be the engine's version of it.

## F18 — A `text` node has no `letterSpacing`, no `lineHeight`, and no shrink-to-fit

The intro captions are laid out by the original inside a measured cream
plaque: `letterSpacing: 1` on the title, `lineHeight: 26` on the subtitle,
and `fitWidth(t, cw * 0.76)` — shrink the text if it overruns the plaque.
None of the three exists on a `text` node, so the port drops the first two
and relies on the copy happening to fit at 40 px. A longer translation would
run out of the plaque with nothing to stop it. `wrap` is there; the missing
piece is a max-width that SCALES rather than wraps.

## F19 — Nothing in a composition can load a web font

`text.family` names a font; `text.font` loads a BITMAP font. There is no way
for a row, a document or a project manifest to say "load this .woff2 before
you mount text". The whole game was drawing in the system sans — the
theatrical condensed face that IS the brand was simply absent, in the
documents and in the plugin alike (which had been asking for
`'Oswald, sans-serif'` in its own `Text` styles all along and getting the
fallback).

The project's way out is the page: `@font-face` in `index.html` plus a
`document.fonts.load('700 40px Oswald')` awaited before `createGame`, because
pixi rasterises canvas text at mount and a face that lands later leaves the
caption drawn in the fallback until something re-sets its `style`. `e8 build`
carries it through (vite hashes the url). But "the project's own HTML page"
is exactly the place the composition was supposed to replace: a font is art,
and art belongs with the rows. An `assets1`-style `fonts: [...]` — loaded
with the rest of the preload, awaited before the first mount — would put it
back where the rest of the art lives.

## F20 — The shell bar cannot be hidden, and hiding it does not give its height back

The user's eighth item, after the seven above: the control bar is on screen
over the opening. The legacy host scoped it to the slot scene in one line —
"show only when a `SlotSceneController` scene is current (hidden over the
intro / non-slot scenes)", `shell.setVisible(!!gameScene())` plus the same on
every scene change. Here nothing does: the `shell` flow kind has no `visible`
prop, and `shell-pixi` exposes no wrapper for it. The handle the row provides
IS the full `Shell`, so a project plugin can reach `setVisible` — which is
what this one now does, from `pd.intro` and back on `pd.introOut` after the
cards are up (the original un-hides on `goto('game')`, not on the tap).

Half a fix, though, because `setVisible` only flips the bar's `visible`:
`barHeight` — and with it `safeArea.bottom` — stays where it was, so the
scenes keep reserving a strip for a bar that is not there. `scenes` prefers
an explicit `safeArea` SERVICE over the shell's own and re-reads it every
frame, so the project provides one whose getters answer zero while the
opening runs. Two workarounds for one idea.

What would close it: `visible` on the `shell` flow kind, and `barHeight`
answering 0 while the bar is hidden (or `safeArea` doing so), so a project
never has to shadow the service to get the screen back.

While measuring this, one more thing came out of the original:
`createSlotGame` took `scaleMode: ScaleMode.FILL` and paper-duel used it.
`scenes1.config.mode` has `cover`, which is the same idea, and the port had
been running on the default `contain` for seven rounds — the diorama's layers
are cover-fitted to the design box by `theatre.ts`'s own arithmetic, so
`contain` letterboxed a picture that was built to be cropped. `mode: cover`
is in the patch now. It changes nothing in portrait (the portrait variant
cover-fits the diorama itself, and everything else is pinned).

And the legacy host had a `fonts: ['700 24px "Oswald"']` option — F19 above
is a capability the engine this port replaces already had.

## The other three, which were ours and not the engine's

- **The opening ended by itself** — `wait { event: ui.tap, ms: 9000 }`.
  `ms` is optional next to `event`; dropping it waits for the finger, the way
  `IntroScene` does. The same `ms` was on the two bonus cards
  (4000 / 3500) and is gone from them too.
- **The board had no symbols before the first spin** —
  `GameScene.fillInitialBoard` was never ported. It is eight lines against
  `board.refill` (a synchronous `setBoard`), now run from `pd.stage`, which
  the flow moved ahead of the rig drop so the reels come down already full.
- **The cards were crooked on the wrong ropes** — `intro.scene.yml` was the
  one document typed by hand rather than generated, and its numbers were
  invented: 517×517 and 740×740 squares for art that is 973×1362, captions at
  guessed offsets with a `scale: 1.2`, three single cords from one point.
  It is generated now, from `introCards.ts`'s own constants — `CARD_H 740`,
  the aspect-derived 528.6 width, `SPREAD 610`, `SIDE_TILT 0.08`, the plaque
  bands at 0.772/0.885 — as three `container` cards with two cords each,
  hung from the `CEILING_Y -60` line at `ANCHOR_HALF 150`. The damped
  pendulum (`PEND_K 6.0`, `PEND_DAMP 1.15`, `PEND_BANK 0.22`, two breeze
  terms) is integrated on `scenes.onFrame` and each cord is rotated and
  stretched to its attach point per frame, so the cords bend with the swing.
  Not a `MeshRope`: a straight sprite cannot sag, so the cords are straight
  where the original's droop by `ROPE_SAG 14`. A `rope`/`mesh` node type is
  the only thing that would close the gap; it is cosmetic.
- **The bonus hand-off** — `GameScene.playCurtain` was never built at all
  (the generated `bonus_intro` even carried a comment claiming the plugin
  split a curtain over it; nothing did). The halves were already cut to
  files by `scripts/cut-halves.mjs` from round 3 and simply unused. There is
  now a `curtain` document with the two halves parked off each side, and the
  flow runs the ceremony with `tween` nodes: shut (380 ms `easeOutCubic`) →
  the card on the shut curtain → tap → part (480 ms `easeInCubic`) → the
  knight strikes. The bonus ends the same way, the boss leaving behind the
  shut curtain. The cards are three lines of text on the curtain now, as
  `buildIntroTitle`/`buildOutroCard` are — the dim rect and the plate the
  port had invented are gone.

## Two project documents had been damaged by an IDE round-trip

`symbols.yml` had lost ROCK's `src` and its `death` strip, and SCISSORS'
`death` had become a `spritesheet` with no sheet — three boot errors, a blank
ROCK and no death morph for either. `flow.yml` carried an orphan `step-1`
node with no incoming edge, and had been rewritten from its authored compact
form into expanded YAML with all ~30 section comments gone. Both were
regenerated / cleaned.

We could not reproduce the damage: booting the host, loading the preview page
and running a spin all leave both files byte-identical (checked by md5 across
three runs), so this happened during editing in an earlier session and we
cannot say from what. Worth recording anyway, because the failure mode is
nasty: a document the IDE writes back with a field cleared costs a symbol's
art and says so only as a boot diagnostic that a busy screen hides.

## Measured after the round

- Opening: dark → assembly (back fade 900 ms, castles 600, veils 680, parapet
  660, king/knight 640) → three cards down on their cords → `TAP TO START`
  fades in at ~3.2 s and waits.
- `__e8.symbols()` before the tap is 30 nulls; after it, a full board.
- Base spins: 7 rounds in 8.2 s, 5 in 6.3 s. Bought TOURNAMENT with the
  curtain: 69.9 s for 8 free spins (the cards are tapped through at once —
  the old 190 s number included their 4 s timeouts).
- Portrait: one card centred on two cords, Oswald throughout, the diorama
  cover-fitted.
- No bar over the opening, and the diorama full-bleed while it plays.
- `npx e8 check` — `"diagnostics": []`, `"gaps": []`. `e8 build` 38 MB, the
  built page boots (`scenes visible: ["theatre","intro"]`) with the font
  inlined by vite. `npm test` 5/5, typecheck clean, no console errors in any
  probe.

## What is still not the original

- The cords are straight; the original's sag on a `MeshRope`.
- Portrait shows the middle card and does not cycle the three every 5 s.
- The boss drops in on the first free spin rather than behind the shut
  curtain (the curtain ceremony is the flow's, the boss drop is the
  mechanic's plan step; wiring the second to the first means a second drop
  path).
- `TAP TO START` does not pulse.
- Portrait's game screen leaves a wide empty parapet under the board — the
  original lays GameScene out against the live viewport, the port against a
  1080×1920 design box. Pre-existing, unrelated to `cover`.
- Still open from earlier rounds: i18n has no shell hook, there is no mobile
  asset tier (one `src` per node, the 33 MB desktop tier ships), and the
  bitmap number font is still the plugin's own.


---

# Round 8 — 2026-09-28, the port comes off its own workarounds

Slice 42 (`8f0e44aa..d4b3eff3`) took round 7's six findings and shipped all
six. This round is the other half of the loop: delete the workarounds the
project had written around them, and check that what replaces each one
actually holds.

## What the project deleted

| Round 7 wrote | Round 8 uses |
| --- | --- |
| `prop { target: theatre/stage, visible: false }` before `show`, then a `setProps` reveal inside `reset()` | `load { scene: theatre }` + `load { scene: intro }`, the pose between load and show, nothing to hide |
| a `pd.introReady` ack the plugin emitted, and a `wait` node for it | `emit { event: pd.intro, wait: true }` |
| `@font-face` in `index.html` + `await document.fonts.load(...)` before `createGame` | `scenes1.config.fonts: [{ family: Oswald, src: assets/fonts/oswald.woff2, weight: '700' }]` |
| `shell.setVisible` from the plugin **and** a `safeArea` service with four getters shadowing the shell's | `shell { visible: 'false' }` / `'true'` in the flow |
| captions with no letter spacing, no line height, and a hope that the copy fits | `letterSpacing: 1`, `lineHeight: 26`, `fitWidth: 401.8` — the original's own `fitWidth(t, cw * 0.76)` |

The plugin lost 25 lines (the chrome helper and the shadow service), the page
lost its font block and its await, and `steps.ts`'s `ShellLike` is back to the
three members it actually uses.

## Measured

- **The opening, on `load` → pose → `show`.** Nothing on screen until 351 ms,
  and by then the diorama is already dark and offstage
  (`back.a=0.00 castle.x=-410 veil.x=-560 panel.y=1189 king.x=-720`), then
  back fades up, castles 1.7→2.3 s, veils 2.5→3.2 s, parapet, king and
  knight, cards. No flash of the assembled stage — round 7 needed a hidden
  container for that, and now the `load` is enough.
- **`emit { wait: true }` arms the tap at the right moment.** The prompt's
  alpha only leaves 0 after the last card has settled; the ack event and its
  node are gone. Note for anyone copying this: `wait` is a real boolean, so
  `wait: 'true'` in YAML is refused and the emit does not wait — the opening
  silently never assembled until the quotes came off.
- **The font comes from the composition.** No `@font-face` in the built
  `index.html` (grep: 0) and `assets/fonts/oswald.woff2` in the 121 shipped
  files; the captions render in Oswald in dev and in `dist`.
- **`fitWidth` does what the original's `fitWidth` did.** "TOURNAMENT BONUS"
  sits a step smaller than "THE DUEL" inside the same plaque instead of
  overrunning it.
- **The bar.** Hidden across the whole opening and back before the rig drops
  (`shell { visible }` is ordered ahead of the pose, per slice 42's debt 1 —
  it triggers a re-fit, and a re-fit re-places pinned nodes).
- **Unchanged from round 7:** spin 1 seven cascade rounds, spin 2 five in
  7.5 s; a bought TOURNAMENT 95 s (the machine was at load average ~16, so
  this is not comparable with round 7's 70 s); boss on his cord, HP bar to
  0.05, both ambient flourishes, sticky rings cleared by the next segment,
  curtain ceremony, portrait one card on two cords.
- `npx e8 check` `diagnostics: []`; `e8 build` 121 files / 38 MB and the
  built page boots; `npm test` 5/5; typecheck clean; no console errors in any
  probe.

## F15 had a fourth victim, and it is fixed too

Round 7 listed the diorama assembly, the ambient flourishes and the boss.
The big-win emblem was the fourth: `createEvents.bigWin` reaches it with
`scenes.view({ scene: 'big_win', node: shown })` and pops its scale from 0.3,
and `big_win` is a document nested in `base_game` — the exact case. The
emblem was on screen (its document makes it visible) and never moved.

Measured now (`scripts/probe-bigwin.ts`, across a bought TOURNAMENT): the
emblem's width goes 720 → 641 → 753 → 720, the `easeOutBack` overshoot and
all. The measurement proves the pop runs; that it used to run on the
invisible copy is the same mechanism round 7 measured directly on the castle.

## F21 — `scenes.visible()` cannot see a nested document that is on screen

Six probe runs went into the paragraph above, and five of them were the
probe's fault: it gated on `scenesVisible()` containing `big_win`, which
never happens. `show(id)` of a document some visible scene nests adds it to
`shownNested` and flips the host's node visible; `visible()` returns
`[...visibleIds]`, which is top-level mounts only. So the one read a test, a
probe or a project has for "what is on screen" is blind to precisely the
nesting case `view()` was just taught about — and it does not say it is: an
absent id reads as "not shown", not as "not answerable".

`__e8.scenesVisible()` is that call, so every e2e that asserts what is up has
the same blind spot.

Either `visible()` includes `shownNested` (they ARE on screen — that is what
`show` means), or it gains a companion that does. The asymmetry is the same
one F15 was: two functions that look like they answer the same question, one
of which quietly ignores nesting.

## Still not the original

Unchanged from round 7: straight cords instead of a sagging `MeshRope`;
portrait shows the middle card without cycling the three; the boss drops on
the first free spin rather than behind the shut curtain; `TAP TO START` does
not pulse; portrait's game screen leaves a wide empty parapet under the
board. Open from earlier rounds: i18n has no shell hook, there is no mobile
asset tier, and the bitmap number font is still the plugin's own.
