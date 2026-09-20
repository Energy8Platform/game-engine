# first-slot

The reference project for the `e8-base` bundle: `e8.profile.yml` stacks that
one bundle, and `e8.patch.yml` is the delta on top of it.

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
`symbols.yml` is inert — the reels place their cells. When the safe rect is
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
