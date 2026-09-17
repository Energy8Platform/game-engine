# Basic slot

A 5x3 lines game on the `e8-base` bundle with the `classic` mechanic and a
placeholder art set. `e8.profile.yml` stacks that one bundle; `e8.patch.yml`
is the delta on top of it.

## `scenes/`

Scene documents live here, one file per scene: `scenes/base_game.scene.yml`
and `scenes/big_win.scene.yml`. `main.ts` shows the scene named after the
spin's stage when one is declared (the temporary rule until the flow editor
drives the game) — `base_game`'s board is a `reels` node, and `big_win` is a
nested scene it can show. `scenes1`'s row (below) sets the design resolution
these documents are laid out against.

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

### Two things have NO home in the patch, on purpose

A function and a live DOM element. Both reach their rows as **services** the
page provides before the first row applies (`createGame({ provide })`),
rather than as row config:

- `reels.resolve` (a `SymbolResolver` function — the coloured-square
  placeholder art): YAML cannot carry a function. `reels1`'s row configures
  everything else `createReelSystem` needs and reads the resolver off the
  `assets` service (see `@energy8engine/reels`'s `src/runtime.ts`). `main.ts`
  supplies it today; an `assets` row could supply it tomorrow with no change
  to `reels1`.
- `mount` (the live `#mount` DOM element): a page-level handle, not
  composition data. Provided as the `mount` service: `renderer1` attaches its
  canvas to it, and `createGame` draws the failure screen on it.

### Row notes

- `reels1` — NOT a typo: the row's own `config` **is** `CreateReelSystemOptions`
  (`@energy8platform/game-engine/slot`'s options for `createReelSystem`,
  `resolve` aside), and that type's own field for reel settings is also named
  `config` (`ReelSystemConfig`, holding `grid` among others). The outer key is
  the row's config; the inner one is the reel system's.

## `editor.html`

The page the IDE opens in a scene tab, not the game — it boots the same
composition through `createGame` but applies `@energy8engine/scene-edit`
instead of the spin loop and the `#controls` chrome, so a scene renders with
a pickable gizmo and no `Spin` button. `scenes/base_game.scene.yml` now opens
with a `logo` node (`assets/logo.png`, a small filled-circle placeholder) so
there is a real image on the board to select, not just the reel grid.
