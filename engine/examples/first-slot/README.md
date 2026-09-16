# first-slot

The reference project for the `e8-base` bundle: `e8.profile.yml` stacks that
one bundle, and `e8.patch.yml` is the delta on top of it.

## `e8.patch.yml`

The patch carries everything `src/main.ts` used to pass as a JS object
straight into `createGame` — renderer size, the reel grid, the stage's design
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

- `reels.resolve` (a `SymbolResolver` function — first-slot's coloured-square
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
