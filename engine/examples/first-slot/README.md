# first-slot

The reference project for the `e8-base` bundle: `e8.profile.yml` stacks that
one bundle, and `e8.patch.yml` is the delta on top of it.

## `flow.yml`

The flow document, and the only thing that drives the game: `boot → show
base_game → on shell.spin → shell { busy: true } → click → spin { betLevel:
$shell.bet } → shell { balance } → present { turbo: $shell.turbo } →
show_win → shell { win } → done → ack → shell { busy: false }`. `done` (`if
$result.roundComplete`) sends a complete round on to `ack` and the bar's
release; an incomplete one (free spins, a retrigger) goes to `step`, which
posts the open round's `roundId` and next `nextActions` entry and loops back
to `present` to draw the response — dormant on `first-slot`'s own math, where
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
to be the other one, `main.ts` supplying first-slot's coloured-square
placeholder art the same way. It isn't any more: `symbols1` reads
`symbols.yml` and supplies `assets`/`resolve` itself (see
`@energy8engine/symbols`'s `src/runtime.ts`), so `main.ts` today only ever
provides `mount`.

### Row notes

- `reels1` — NOT a typo: the row's own `config` **is** `CreateReelSystemOptions`
  (`@energy8platform/game-engine/slot`'s options for `createReelSystem`,
  `resolve` aside), and that type's own field for reel settings is also named
  `config` (`ReelSystemConfig`, holding `grid` among others). The outer key is
  the row's config; the inner one is the reel system's.
- `mechanics1` — binds `base_game` to `reel-step`, a mechanic no row in
  `e8-base` ships and nothing in the engine has heard of. That is legal:
  `MechanicsService.bind` says a binding to an unregistered id is not a
  failure, because the row that registers it may not have applied yet —
  `reelstep1` is appended after this one, and the binding resolves the moment
  it lands.
- `reelstep1` — the third mechanic, and the row this project exists to make
  possible. `reel-step` is not installed and not published: it is
  `plugins/reel-step/` in this project, a directory placed by hand, which the
  host resolves ahead of `node_modules` (`readProjectPlugin` in the IDE host's
  `resolvePackage.ts`). It brings a mechanic that emits a `reelStep` step, and
  the handler that performs one — `classic` and `cascade` needed only the
  first, because the six built-in step kinds already covered them.

## `editor.html` / `src/editor.ts`

A second browser entry, next to `index.html`: the IDE loads this one, not
`index.html`, inside a scene tab. It runs the same composed game but swaps
the `Spin` page for `@energy8engine/scene-edit`, which draws the
selection gizmo over whichever scene the tab names (`?scene=` in the URL)
and reports pointer moves back to the IDE over `postMessage` — the IDE
remains the only writer of `scenes/*.scene.yml`. `assets/logo.png` is this
project's first shipped raster asset, referenced from the new `logo` node at
the top of `scenes/base_game.scene.yml`; the `coin` node right after it is a
`spritesheet` (`assets/coin.json` + `assets/coin.png`, four frames of a
spinning disc), the `media1` row's node type. A `win` node right after
`coin` is a `text` node, empty until the flow's `show_win` node (kind
`prop`) writes `$result.win` into it after every spin.
