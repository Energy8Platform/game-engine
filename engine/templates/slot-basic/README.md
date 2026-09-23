# Basic slot

A 5x3 lines game on the `e8-base` bundle with the `classic` mechanic and a
placeholder art set. `e8.profile.yml` stacks that one bundle; `e8.patch.yml`
is the delta on top of it.

## `scenes/`

Scene documents live here, one file per scene: `scenes/base_game.scene.yml`,
`scenes/big_win.scene.yml` and `scenes/orb.scene.yml`. `flow.yml`'s `show`
node puts `base_game` on screen at boot — `base_game`'s board is a `reels`
node, and `big_win` is a nested scene it can show. `orb` is neither: it is a
CELL scene, named by symbol `6`'s `static` state in `symbols.yml`, so a
private copy of it is mounted inside every cell that lands a `6` and its
`'x{$cell.multiplier}'` text resolves against that cell's own data — a
`$cell` prop is a whole expression, so a template, a format pipe and
arithmetic over the cell are all allowed.
`scenes1`'s row (below) sets the design resolution these documents are laid
out against.

## `flow.yml`

The flow document, and the only thing that drives the game: `boot → show
base_game → shell { busy: false, autoplay: stop } → on shell.spin → shell {
busy: true, win: 0 } → click → spin { betLevel: $shell.bet } → present {
turbo: $shell.turbo } → show_win → shell { win } → shell { balance } → done →
ack → shell { busy: false }` — WIN clears as the spin starts, and the win and
the balance land after the reels do, not before. The boot run's `reset`
node frees the bar on every re-arm: a flow edit in the IDE while a spin is
live aborts the run before its own `shell { busy: false }`, and this is what
puts Spin back. `done` (`if
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
tick } → if $shell.autoplay.remaining > 0 → wait 500 ms → if
$shell.autoplay.active → back to shell { busy: true }` (the second gate is
for a Stop pressed during the wait). A `spin`/`present`/`step` that fails
leaves by `failed` into `shell { autoplay: stop, balance: $session.balance }`
and then that same `shell { busy: false }`: a failure ends an autoplay
rather than retrying against a dead host, shows the wallet as the session
row now has it (a failed play is still charged), and never leaves the bar
disabled. The page's own `Spin` button
and `#turbo` checkbox (`index.html`) are a dev proxy for the bar's:
`src/main.ts` presses the
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
on a win. `6` is the exception and shows the other two things a state can
be: its `static` is `{ type: scene, props: { scene: orb } }` — a whole
scene document mounted as a private copy inside every cell that lands a
`6`, whose `text` reads `'x{$cell.multiplier}'` off that cell's own data (a
`$cell` prop is a whole expression: a template, a format pipe and
arithmetic over the cell are all allowed). Its `image` is one document for
every orb, picking its art from a four-entry asset set (`srcOf`) keyed by
`srcKey: $cell.band` — but nothing in this template feeds a `band`, so the
orb shows its `src` fallback until a mechanic or the math carries one — and
under `states:` it declares `pop`, a NAMED state. A named state is not one
of the three built-ins and nothing plays it on its own: a mechanic asks for
it by name, with a `{ kind: 'playState', cells, state: 'pop' }` step. The
`classic` mechanic this template binds never does, so `pop` sits there as
the shape to copy.
`e8-base`'s `symbols1` row (`@energy8engine/symbols`) reads it
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
node (kind `count`) runs it up to `$result.winAmount` over 400 ms after
every spin, writing the exact credited amount last, as currency.

## The window, pins and portrait

`renderer1` names no `width`/`height` in `e8.patch.yml`, so the canvas is
whatever box the page gives `#mount` — `index.html` and `editor.html` both
make it `position: fixed; inset: 0`, the whole window (or the whole iframe
the IDE sized). A page's CSS decides, not the composition; give the row both
numbers back and the canvas is that fixed size again. `scenes1` fits its
`design` (480×288) into that box minus the shell's bar, `contain`, centred —
the SAFE rect — and every node still sits at design coordinates. A node with
a `pin` (`top-left`, `top`, `top-right`, `left`, `center`, `right`,
`bottom-left`, `bottom`, `bottom-right`) reads its `x`/`y` as OFFSETS from
that point of the safe rect instead: `base_game`'s `win` is `pin: bottom, x:
0, y: -24`, 24 design px above the bar at any window size. A pin on a nested
node is ignored (a diagnostic says so), and a `pin` on a symbol state in
`symbols.yml` is inert — the reels place their cells. Un-pinning a node
(`prop { pin: '' }`, or clearing the field) reads its `x`/`y` as absolutes
at once — the offset numbers become the position, a visible jump unless the
same patch also sets `x`/`y`. When the safe rect is
taller than wide the scenes switch to `scenes1.config.portrait` (288×480
here; absent, the design rotated) and apply the scene file's `portrait:
nodes:` block over the named top-level nodes — `logo` pins to the top,
`board` pins under it at `scale: 0.55` (the 5×3 grid, 277 design px wide,
fits the narrow design; its `x`/`y` are offsets of the reels view's ORIGIN,
reel 0's column centre and row 0's centre, not of the grid's corner) and
`coin` hides; landscape puts them back. The scene tab's viewport select
(`design`, `1280×720`, `390×844`, `844×390`, custom) sizes the canvas to that
viewport, with the bar's band hatched: under a portrait one, every drag and
every Properties edit writes `portrait.nodes.<id>`, never the node's own
props (the tree marks such a node `◐`; "clear portrait override" removes the
entry), while a DROP there still adds a node with its own props — at
portrait-design coordinates. Under `design` or a landscape preset edits go to
the node as before, and a drag on a pinned node writes the offset.

## `e8 build`

`e8 build [--target <name>] [--base <path>] [--out <dir>]` writes a static
`dist/` of this game: `index.html` and the bundle (`vite build` over this
project — the page as one chunk and every row's runtime half, keyed by row
id, in a `game` chunk beside it: the `virtual:e8-rows` map `src/main.ts`
hands `createGame` as `importModule`), the four documents the rows fetch at
boot frozen under `dist/api/` — `flow`, `scenes` and `symbols` byte-identical
to what the dev host answers, `composition` with each row's `runtimeUrl`
rewritten to its row id and `clientUrl` to `null` — so an edit to a `.yml`
needs a rebuild, and `assets/` copied whole. `--out` (default `dist`) is
emptied first, so it is never the project or a folder containing it (that is
refused). `--target platform` bakes `import.meta.env.E8_TARGET`, which is
how the `session` seam picks `@energy8engine/session-sdk` over the dev host's
`session-host`. `--base` moves the page's own assets only: the rows fetch
`/api/*` at the origin root whatever the base, so a base other than `/` is a
warning — serve `dist/api` at the root, or proxy it. A built page hides the
`#controls` toolbar and `#log` and never imports `ide-bridge` (both are
behind `import.meta.env.DEV`); the `window.__e8` hooks stay. Nothing serves
`dist/` — any static server does; without `--target platform`, proxy
`/api/session` and `/api/spin` to a running `e8 dev` host. `dist/` is in
`.gitignore`.
