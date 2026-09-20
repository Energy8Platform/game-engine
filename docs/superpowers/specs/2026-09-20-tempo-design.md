# Tempo — tumble, turbo, skip, sound categories — design (slice 25)

Date: 2026-09-20. Branch: `feat/slot-webide-cordis`. Answers R8, R9 and
R12 of `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
Slices 22–24 precede; 26 (the shell, responsive layout, a build) is
designed with the user.

## 0. Where this sits

A cascade in the IDE is `remove` + `refill` = `setBoard` twice — no
gravity, no drop; the legacy `TumbleController` exists but a project can
reach it only through `board.grid` (as `reel-step` does), and the reel
row's cascade timings are invisible to a plugin. A presentation cannot be
hurried or cut short: `play.execute` has no turbo and no skip, though the
legacy `ReelSystem` has both. Sound is `play`/`stop` with no categories,
fades or ducking. Three additions on existing seams: a `tumble` step in
the vocabulary that the reels board plays through the legacy tumble; a
`turbo` flag and a `skip` carried from the page through the flow to the
board; sound categories with fades on the `fx1` row.

## 1. Goal

A cascade game's spin drops surviving symbols with gravity and refills
from above (the `cascade` mechanic emits `tumble` steps when asked); a
turbo toggle on the page halves the presentation and a second tap skips
to the result; music ducks under a big win and fades back; `first-slot`
gains a turbo checkbox and a skip on a second click of Spin.

## 2. Non-goals

- The shell's persisted volume/mute and its buttons (26); autoplay (26).
- Rewriting `TumbleController`; per-reel timings; anticipation.
- A skip that abandons the round (skip completes the presentation
  instantly — the result still lands).

## 3. `tumble` step (R8)

```ts
// @energy8engine/contracts presentation.ts
export interface TumbleStep {
  kind: 'tumble';
  winning: Cell[];                 // cells to highlight before removal
  removed: Cell[];                 // cells that leave
  drops?: { col: number; fromRow: number; toRow: number }[];  // survivor slides; omitted → gravity
  fresh: { col: number; row: number; symbol: number | string | BoardCell }[];  // what lands from above
  settled: Board;                  // the board after the tumble
}
```

Fifth known kind (`KNOWN_STEP_KINDS`, `isPresentationStep`). `BoardApi`
gains `tumble(step: TumbleStep, opts?: StepOpts): Promise<void>`;
`@energy8engine/reels` implements it through `reelSystem.cascade([{
winningCells, removedCells, drops, newCells: fresh (symbol via cellData),
settledGrid: toCellBoard(settled) }], { turbo })` — one legacy
`TumbleStep` per vocabulary step, so a chain is N steps; the board re-syncs
`reelSystem.board` after (the `remove` lesson) and `bindAll()`s. The
legacy `cascade` config (`reels1.config.cascade`: `gravity`, `timings`,
`easings`, `perStepDecel`) drives it unchanged. `ReelsBoard` also exposes
`readonly config: ReelSystemConfig` (the reel system's, read-only) so a
project step can read the same timings.

`@energy8engine/mechanic-cascade` gains config `tumble: boolean` (default
`false`, so `first-slot`'s presentation is unchanged): when `true` each
`cascade_history` round emits ONE `tumble` step instead of `remove` +
`refill` — `winning = removed`, `settled = round.grid`, `fresh` = per
column the top `k` cells of `settled` where `k` = removed cells in that
column (gravity-derived; `drops` omitted), plus a `revealWins` when the
round wins. The first response's `spinTo` is unchanged.

## 4. Turbo and skip (R9)

```ts
// @energy8engine/contracts
export interface StepOpts { turbo?: boolean }
// play-loop
execute(plan, board, registry?, opts?: { turbo?: boolean }): Promise<Diagnostic[]>;
skip(): void;   // collapses the current presentation: board.skip?.() — ReelSystem.skip() — and every registered handler's optional skip
```

`BoardApi` methods take `opts?: StepOpts`; the reels board passes `turbo`
to `spin(target, { turbo })` and `cascade(steps, { turbo })`. `revealWins`
runs at its legacy pace under turbo — amended from "halves the hold":
the only time that step spends is `SymbolCell.playWin()`, whose tween
length is `win` config and takes no per-call speed, so there is no hold to
halve and inventing one would make the NON-turbo reveal slower (a debt in
§9). `StepHandler` gains `skip?(): void`. `executePlan` forwards `opts` to
the board and handlers, and takes an optional `hooks.onStepStarted`
(called synchronously after each step is invoked) that `PlayService` uses
for the skip latch: a skip latched during a run collapses every later step
of that run as it starts, so an N-round tumble chain ends at the result
rather than skipping one round and playing the rest in full.

Flow: `present` gains `turbo` (`string` default `'$turbo'` — a literal
`'true'`/`'false'` or a `$path`; absent var → `false`) and passes it to
`play.execute`. The play-loop row subscribes leniently to the flow bus:
`ui.skip` → `play.skip()` — a skip must land DURING a run, which an `on`
trigger cannot (`busy: ignore`), so it is not a flow node. The page
(`main.ts`): a `#turbo` checkbox; `ui.spin` is emitted with `{ turbo:
checkbox.checked }` and the example flow gains `set turbo = $event.turbo`
after `idle` (before `click`); a click on Spin while the flow is busy
emits `ui.skip` instead (the button reads `flow.busy()`); `__e8.spin({
turbo? })`, `__e8.skip()`, `__e8.lastStepOpts()` (the board records the
last `opts` it was given).

## 5. Sound categories, fades, ducking (R12)

`sound` gains `category` (`union(['sfx','music'])` default `'sfx'`) and
`fade` (`number` ms default `0`): `play` with `fade` ramps the instance's
volume from 0 to `volume × category volume` over `fade` ms; `stop` with
`fade` ramps down then stops; `wait` unchanged (a faded stop resolves when
silent). A new `audio` kind: `category`, `volume` (`string` — numeric
literal or `$path`, default `'1'`), `fade` (ms) — sets the category's
volume (0..1), ramping every playing instance of that category over
`fade` ms, and applies to later plays; `outs: ['next']`. Ducking = `audio
{ music, 0.3, 300 }` … `audio { music, 1, 500 }` around a big win. The
row keeps `categories: Record<string, number>` (defaults 1) and the set of
live instances per category (pruned on `end`/`stop`); ramps run on
`requestAnimationFrame`/`setTimeout` (test-injectable clock). Persisted
mute/volume (the shell) is 26's.

## 6. IDE

Nothing per kind: `present.turbo`, `sound.category/fade`, `audio` come
through `flow-kinds` (schema-driven forms; `category` renders as a
select). The `tumble` step is a mechanic's business (no editor). The
composition form for `mechanics1` shows `tumble` on the cascade row's
config only if that row's schema carries it — `mechanic-cascade`'s
`schema.ts` gains `tumble: Schema.boolean().default(false)`.

## 7. Bundle, template, example

- `first-slot` ≡ `slot-basic`: `index.html` gains `<label><input id="turbo"
  type="checkbox"> turbo</label>` beside Spin; `main.ts` per §4; `flow.yml`
  gains `{ id: mode, kind: set, props: { name: turbo, value: '$event.turbo' }, ui: { x: 490, y: 240 } }`
  between `idle` and `click` (`idle → mode → click`); `README.md` a
  sentence. `e8.patch.yml` unchanged (`base_game: reel-step`).
- No bundle change (`tumble` is in `reels1`/`mechanics1`; `audio` in
  `fx1`; skip in `playloop1`).

## 8. Testing

- contracts: `isPresentationStep` accepts a `tumble` with every field and
  rejects a missing `settled`/`fresh`.
- reels: `tumble` calls the fake reel system's `cascade` with the mapped
  `TumbleStep` (drops passed through, `newCells` symbols via `cellData`,
  `settledGrid` mapped), `{ turbo }` forwarded; `board` re-synced; `bindAll`
  after; `spinTo`/`revealWins` get `turbo`; `skip()` → `reelSystem.skip()`;
  `config` exposed.
- play-loop: `execute(..., { turbo })` reaches the board; `skip()` calls
  the board's and handlers' `skip`; the `ui.skip` subscription (a fake
  `events`).
- mechanic-cascade: `tumble: true` emits `spinTo` + per round `tumble` (+
  `revealWins`) with the derived `fresh`; `false` unchanged; the schema
  carries `tumble`.
- flow: `present.turbo` literal/`$path`/absent → `execute`'s opts;
  the example flow validates (nine → ten nodes).
- flow-fx: `sound` with `fade` ramps up (injected clock) to `volume ×
  category`; `stop` with `fade` ramps down then stops; `audio` sets the
  category and ramps live instances; a later play uses the new category
  volume; `audio` with `$path`.
- e2e `tempo.spec.ts`: (1) a copy with `mechanics1.stages.base_game:
  cascade` and `tumble: true` on the cascade row → `__e8.spin()` → the spin
  log's plan has ≥ 1 `tumble` (poll `spins()`), `out: 'next'`; (2) the
  example with the turbo checkbox checked → after `spin()`,
  `__e8.lastStepOpts()` is `{ turbo: true }` and the trace's `present`
  duration is below the unchecked run's (two spins, compare `at`
  deltas with a margin); (3) `__e8.spin()` then `__e8.skip()` 100 ms in →
  `present` exits `next` within 1 s; (4) the flow palette lists `audio`;
  (5, added by the fix wave) case 1's fixture plus `reels1`'s inner
  `cascade.enabled: true` (a round that takes time) → `spin()` then
  `skip()` 150 ms in → the run resolves within 1.5 s of the skip AND
  `__e8.symbols()` equals the last `tumble` step's `settled` (a skipped
  round never reaches `TumbleController`'s own `setGrid`).

## 9. Debts this opens

`fresh` is gravity-derived in `mechanic-cascade` (a math that says which
cells are new is not read); `tumble` ignores `drops` semantics beyond the
legacy controller's; sound ramps are per instance, not per category bus;
`turbo` halves only what the reels board animates (a project handler
decides its own), and `revealWins` not even that (§4); `ReelSystem.skip()`
collapses a tumble to the settled grid but leaves the legacy
`TumbleController.skip()`'s alpha/scale residue on the cells it was
mid-`Tween.delay` over — the reels board re-seats `settled` after the
cascade, which fixes the DATA, not that residue.
