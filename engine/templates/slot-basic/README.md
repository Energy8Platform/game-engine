# Basic slot

A 5x3 lines game on the `e8-base` bundle with the `classic` mechanic and a
placeholder art set. `e8.profile.yml` stacks that one bundle; `e8.patch.yml`
is the delta on top of it.

## `scenes/`

Scene documents live here, one file per scene: `scenes/base_game.scene.yml`
and `scenes/big_win.scene.yml`. `flow.yml`'s `show` node puts `base_game` on
screen at boot — `base_game`'s board is a `reels` node, and `big_win` is a
nested scene it can show. `scenes1`'s row (below) sets the design resolution
these documents are laid out against.

## `flow.yml`

The flow document, and the only thing that drives the game: `boot → show
base_game → on shell.spin → shell { busy: true } → click → spin { betLevel:
$shell.bet } → shell { balance } → present { turbo: $shell.turbo } →
show_win → shell { win } → done → ack → shell { busy: false }`. `done` (`if
$result.roundComplete`) sends a complete round on to `ack` and the bar's
release; an incomplete one (free spins, a retrigger) goes to `step`, which
posts the open round's `roundId` and next `nextActions` entry and loops back
to `present` to draw the response — dormant on this template's own math, where
every round completes on the first spin. `e8-base`'s `flow1` row
(`@energy8engine/flow`) reads it from the host (`GET /api/flow`), interprets
it, and traces every node it enters and leaves; `src/main.ts` holds no spin
loop any more, and `#status` is read back off the trace.

The shell is a row — `shell1` in `e8.patch.yml` (`@energy8engine/shell-pixi`:
the bar with Spin, the bet stepper, balance, win, turbo and autoplay, drawn
over the canvas; its `features`/`gameInfo` are the row's config, the bet
ladder and balance come from the session row). The flow listens to it (`on
shell.spin`, `on shell.autoplayStart` — every shell event lands on the bus as
`shell.<name>`), reads its live state (`$shell.bet`, `$shell.turbo`,
`$shell.autoplay.*`) and drives its readouts through `shell` nodes (`busy`,
`balance`, `win`, `autoplay: tick`). Autoplay is the same chain entered twice:
after `shell { busy: false }`, `if $shell.autoplay.active → shell { autoplay:
tick } → if $shell.autoplay.remaining > 0 → wait 500 ms → back to shell {
busy: true }`. A `spin`/`present`/`step` that fails leaves by `failed`
straight into that same `shell { busy: false }`, so a refused spin never
leaves the bar disabled. The page's own `Spin` button and `#turbo` checkbox
(`index.html`) are a dev proxy for the bar's: `src/main.ts` presses the
shell's Spin and sets its turbo level, and emits `ui.spin` as well, for a flow
with no shell to listen to. A tap on the canvas during a presentation skips it
— `playloop1`'s `skipEvents: [ui.skip, ui.tap]` in `e8.patch.yml`; `scenes1`
emits `ui.tap` off the stage, and a tap on the shell's bar bubbles there too,
so any tap skips. The page's second click while the flow is busy emits
`ui.skip`, caught the same way — directly by `playloop1`, never by a node,
since a skip has to land while a run is already going.

The IDE's Flow document edits this file (`PUT /api/flow`); node
kinds come from the game's own registry (`ctx.flowNodes`), so a project
plugin can add one. The bus is `ctx.get('events')` (`ctx.reflect.get('events',
false)` from a plugin) — not `ctx.events`, which is cordis's own emitter and
hears nothing the flow emits. Fan-in: an edge into any node but `merge` runs
it once per arrival; `merge` waits for every incoming edge and passes once.
`click` (kind `sound`, `assets/spin.wav`) is `e8-base`'s `fx1` row
(`@energy8engine/flow-fx`) — the same row's `tween` kind moves a scene node
through the legacy `Tween`, unused by this flow but there for a project's
own nodes.

## `symbols.yml`

The symbol art, one entry per id: a `static` node (`image`, onto
`assets/symbols/<id>.png` — six placeholder shapes) and, on `1`, a `win`
node (`spritesheet`, onto `assets/coin.json`, `loop: false`) that plays once
on a win. `e8-base`'s `symbols1` row (`@energy8engine/symbols`) reads it
from the host (`GET /api/symbols`) and is what actually supplies `reels1`'s
`resolve` — see the patch section below for what that replaced. The IDE's
Symbols document (`PUT /api/symbols`) is the editor for this file; ids come
from `game/spec.json`'s own `symbols` list, and a mismatch between the two
is a warning there.

## `e8.patch.yml`

The patch carries everything `src/main.ts` used to pass as a JS object
straight into `createGame` — renderer size, the reel grid, `scenes1`'s design
resolution, and which mechanic `base_game` is bound to. A patch row replaces
its target row's `config` **wholesale** (not a merge) and addresses it by the
id `e8-base`'s own `e8.bundle.yml` assigns; a row that a bundle already
placed needs no `name` here. A patch row **with** a `name` inserts a row the
bundle never placed, and it lands last.

**The IDE rewrites this file on every edit of a game row** (the Composition
screen, `PUT /api/composition/rows/:id`). It is dumped from data, so comments
in it do not survive — which is why this prose lives here and not there.

### One thing has NO home in the patch, on purpose

A live DOM element. It reaches its row as a **service** the page provides
before the first row applies (`createGame({ provide })`), rather than as row
config:

- `mount` (the live `#mount` DOM element): a page-level handle, not
  composition data. Provided as the `mount` service: `renderer1` attaches its
  canvas to it, and `createGame` draws the failure screen on it.

`reels.resolve` (the `SymbolResolver` function `reels1` reads off `ctx`) used
to be the other one, `main.ts` supplying it the same way — a function is
exactly as YAML-proof as a DOM element. It isn't any more: `symbols1` reads
`symbols.yml` and supplies `assets`/`resolve` itself (see
`@energy8engine/symbols`'s `src/runtime.ts`), so `main.ts` today only ever
provides `mount`.

### Row notes

- `reels1` — NOT a typo: the row's own `config` **is** `CreateReelSystemOptions`
  (`@energy8platform/game-engine/slot`'s options for `createReelSystem`,
  `resolve` aside), and that type's own field for reel settings is also named
  `config` (`ReelSystemConfig`, holding `grid` among others). The outer key is
  the row's config; the inner one is the reel system's.

## `editor.html`

The page the IDE opens in a scene tab, not the game — it boots the same
composition through `createGame` but applies `@energy8engine/scene-edit`
instead of the `Spin` button and the `#controls` chrome, so a scene renders with
a pickable gizmo and no `Spin` button. `scenes/base_game.scene.yml` now opens
with a `logo` node (`assets/logo.png`, a small filled-circle placeholder) so
there is a real image on the board to select, not just the reel grid; next to
it, a `coin` node (`spritesheet`, `assets/coin.json` + `assets/coin.png`)
animates through four frames of a spinning disc, from the `media1` row. A
`win` node after `coin` is a `text` node, empty until the flow's `show_win`
node (kind `prop`) writes `$result.win` into it after every spin.
