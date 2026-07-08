# SpinML — the slot math language

SpinML is the math runtime for Energy8 games: a statically-typed, Lua-flavored
DSL that is JIT-compiled to native code (Cranelift) by the **e8** engine. One
`.spin` file holds the whole game — platform declarations, weights, paytable,
and the spin logic — and the exact same file runs in every environment:

| Environment | Binary | How |
|---|---|---|
| Vite dev (`npm run dev`) | `e8-server` | `spinPlugin` from `@energy8platform/platform-core/vite` spawns it; hot-reloads the `.spin` on save |
| Math pipeline (`npm run math:*`) | `e8 simulate` | `stake-math-tools` (sim → pool → curate → books) |
| Production | `e8-server` | The casino platform (`engine_mode: "spin"`) calls it over gRPC |

Binaries are downloaded by `platform-core`'s postinstall from this repo's
GitHub Releases (tag `e8-v<version>`); local override via `E8_BINARY` /
`E8_SERVER_BINARY`. Engine sources live in the private `casino-platform` repo
under `e8/`.

Why it replaced Lua: the script is **typed** (a typo in an output field, a
missing payout, or a forgotten persist is a compile error, not a silent prod
bug), and it is **fast** — ~4M rounds/sec on one desktop CPU vs ~150K for the
old gopher-lua engine, so a 100M-round pool run finishes in minutes.

---

## 1. Quick start

```bash
e8 check game/script.spin        # compile + type-check (1-2 ms per fn)
e8 simulate -config config.json -iterations 1000000 -format json
```

A minimal but complete game:

```spin
record Vars {
  free_spins_awarded: int
  retrigger_spins: int
  max_win_reached: bool
}

record Feat {
  ante: int
}

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    scatter_count: int
    free_spins_awarded: int
  }
  free_spins {
    grid: [[int]]
    spins_remaining: int
    retrigger_spins: int
  }
}

game "my-slot" {
  bet_levels = [0.2, 1.0, 5.0, 25.0]
  max_win = 5000.0
  vars = Vars
  feature = Feat
  data = SpinData
}

action spin {
  stage = base_game
  cost = 1.0
  opens = free_spin count free_spins_awarded
}

action buy_bonus {
  stage = base_game
  cost = 100.0
  opens = free_spin count free_spins_awarded
}

action free_spin {
  stage = free_spins
  cost = 1.0
  session = true
  extends = retrigger_spins
  ends when max_win_reached
}

const W_SYMS: [int; 5] = [10, 20, 30, 25, 15]

fn execute(c: ctx, v: Vars) -> outcome {
  let grid: [[int]] = list()
  for col in 0..5 {
    let rows: [int] = list()
    for row in 0..3 {
      push(rows, rng_weighted(c, W_SYMS))
    }
    push(grid, rows)
  }

  let sc = 0
  -- ...evaluate wins, count scatters...
  let fs = 0
  if sc >= 3 { fs = 8 }

  if action_is(c, "free_spin") {
    return outcome {
      win: 0.0,
      vars: Vars { free_spins_awarded: 0, retrigger_spins: 0, max_win_reached: false },
      data: SpinData.free_spins { grid: grid, spins_remaining: 0, retrigger_spins: 0 },
    }
  }

  return outcome {
    win: 0.0,
    vars: Vars { free_spins_awarded: fs, retrigger_spins: 0, max_win_reached: false },
    data: SpinData.base_game { grid: grid, scatter_count: sc, free_spins_awarded: fs },
  }
}
```

The engine provides only three things: **crypto RNG**, **persisted round
state** (`Vars`), and **session bookkeeping** driven by the `opens` /
`extends` / `ends when` declarations. Everything else — grid, weights,
evaluation, cascades — is plain code in the script.

---

## 2. Declarations

### `game`

```spin
game "moon-spice-market" {
  bet_levels = [0.2, 0.4, 1.0, 5.0]
  max_win = 7500.0
  vars = Vars          -- record persisted across the round (session state)
  feature = Feat       -- record filled from the action's `feature {}` block
  data = SpinData      -- enum of per-stage output shapes
}
```

This replaces the old JSON config *and* the transition rules: the platform
reads the compiled spec (id, bet levels, actions, costs, session rules)
straight from the `.spin`.

### `action`

```spin
action ante_spin {
  stage = base_game            -- stage tag written into the output
  cost = 1.25                  -- cost multiplier (bet × cost is debited)
  feature { ante = 1 }         -- values readable via feat_int(c, "ante")
  opens = free_spin count free_spins_awarded
}

action free_spin {
  stage = free_spins
  cost = 1.0
  session = true               -- server-driven session action (no debit)
  extends = retrigger_spins    -- Vars field that adds spins mid-session
  ends when max_win_reached    -- Vars field (bool) that force-closes it
}
```

Session flow is **declarative**: return `free_spins_awarded: 8` from a spin
and the engine opens an 8-spin `free_spin` session; return
`retrigger_spins: 2` inside the bonus and it extends by 2; set
`max_win_reached: true` and it ends — no session code in the script, and the
checker verifies every referenced field exists in `Vars` with the right type.
One `feature {}` note: fields are newline-separated, commas are rejected.

### `record` and `enum`

```spin
record Cell {
  sym: str
  mult: int?        -- optional: may be omitted in literals / absent in JSON
}

enum SpinData tag stage {
  base_game  { grid: [[Cell]]  scatter_count: int }
  free_spins { grid: [[Cell]]  spins_remaining: int }
}
```

Records are typed output/state shapes; nesting and lists of records are fine.
The `data` enum is a **sum type**: each stage variant carries its complete
required field set, the `stage` tag is emitted automatically from the variant
name. It is impossible to build a base-game answer with a bonus-only field —
that's a compile error, which is the point.

---

## 3. Types

| Type | Notes |
|---|---|
| `int` | 64-bit; no implicit float conversion — use `to_float(i)` / `to_int(f)` |
| `float` | 64-bit; `floor` `ceil` `min` `max` `abs` available |
| `bool` | `true` / `false` |
| `str` | **literals and `const` arrays only** — strings cannot be bound to `let` variables or passed around; they exist to name things in output data |
| `[T; N]` | fixed-size array, stack-allocated: `let res = [0; 4]`, `const W: [int; 14] = [...]` |
| `[T]` | growable list: `let g: [Cell] = list()`, then `push(g, cell)` |
| records / enums | see above; record parameters are by-ref |

`const` globals hold scalars, arrays, and **groups**:

```spin
const FOX_FS = {
  wild: 219, scatter: 155, coin: 0,
  symw: [4, 6, 9, 11, 13, 13, 13, 12, 12, 12],
  kbw:  [10, 10, 25, 25, 20, 8, 5, 3, 1],
}

-- fields read with dot syntax, group arrays feed rng_weighted directly:
let s = rng_weighted(c, FOX_FS.symw)
if roll <= FOX_FS.wild { ... }
```

Const groups exist to keep per-mode tuning (weights/chances per game mode)
in one named block each — the shape the math team already uses in Lua. v1
limits: no indexing into a group's array by variable (`G.arr[i]` — hoist the
array into its own `const` if you need that), and `shuffle` does not accept
group arrays.

---

## 4. Builtins

Every function that touches the round takes `c: ctx` as its first parameter
(the engine context — RNG state, action info, fuel).

| Builtin | Description |
|---|---|
| `rng(c, min, max)` | uniform int in `[min, max]`, crypto/provably-fair RNG |
| `rng_weighted(c, weights)` | **0-based** index drawn from an int-weight array |
| `rng_float(c)` | float in `[0, 1)` |
| `shuffle(c, arr)` | Fisher-Yates in place |
| `action_is(c, "name")` | true if the round was started by that action |
| `feat_int(c, "field")` / `feat_float(c, "field")` | read the acting action's `feature {}` values |
| `input_int(c, "field")` / `input_float(c, "field")` | player input declared via `game.input` (pick-me bonuses etc.) |
| `to_int` `to_float` `floor` `ceil` `min` `max` `abs` | math |
| `list()` / `push(arr, v)` | growable lists |

---

## 5. Control flow and limits

- `if` / `while` / `for i in a..b` — the usual. Loop bodies with a
  compile-time trip count ≤ 16 are unrolled.
- **`for` loop variables are read-only** (assigning to `i` inside the loop is
  a compile error). This is Lua semantics, and it lets the compiler charge
  the loop's cost in O(1).
- **Recursion is banned** — direct or mutual; the checker prints the cycle.
- **Fuel guard**: every round has a budget of 50M back-edges/iterations.
  A runaway `while true` ends the round with a `fuel exhausted` error in
  microseconds instead of the old 5-second Lua timeout. Real games use well
  under 0.1% of the budget; you will never hit it with working math.
- `execute` returns `outcome { win, vars, data }` — all three required
  (`win` is a **bet multiplier**, never currency).
- **Player-persist (`globals`)** — state that survives across rounds
  (meters, accumulators): declare `game { globals = Globals }`, and the
  signature becomes `fn execute(c: ctx, v: Vars, g: Globals) -> outcome`.
  Update via the optional `outcome` field `globals:` — omitting it means
  "unchanged". The engine stores it per player (`memory`/Redis), and the
  platform layers expose the full record to the client as
  `data.persistent_state` on every play (the same key the legacy Lua
  `exposed_vars` used). Not available in Stake books (stateless RGS).

---

## 6. game-spec integration (host mode)

Games scaffolded by `npm create @energy8platform/slot` keep the paytable in
`src/game.spec.ts` and the logic in `src/game/script.spin`. The framework
derives a **spin prelude** from the spec and prepends it at build/sim time,
so the script never hard-codes pays:

| Prelude const | From spec |
|---|---|
| `SPEC.cols` `SPEC.rows` `SPEC.max_win` … | grid/limits |
| `N_SYMBOLS`, `SYMBOLS: [str; N]` | symbol ids in spec order |
| `SYM.H1`, `SYM.WILD`, … | index of each symbol |
| `PAY_COUNTS: [int; 2]`, `PAY_H1: [float; …]` | paytable rows (`0.0` = no pay) |
| `VAL_<ID>` | symbol value fields (coin values etc.) |

`defineGame` / `buildSpinScript` / `exportGameSpin` (in
`@energy8platform/platform-core/game-spec`) assemble prelude + script and the
platform bundle (`config.json` with `engine_mode: "spin"` + `script.spin`).
Change a payout in the spec and the math follows — one source of truth.

---

## 7. Simulating

`e8 simulate` speaks the same dialect as the old Go simulate CLI — same
flags, same JSON shape, same statistics — so `stake-math-tools` and existing
tooling did not change:

```bash
e8 simulate -config config.json -iterations 100000000 -action buy_bonus \
  -rng provably-fair -seed <hex> -format json -dump rounds.jsonl
```

- `-config` is the platform config JSON; its `script_path` points at the `.spin`.
- Determinism: the master seed derives 64 RNG lanes (`sha256(master:lane)`,
  round → lane by `round % 64`), so results are **bit-identical for the same
  seed regardless of CPU core count**. Two runs with the same seed produce
  byte-equal dumps.
- `-replay-server-seed/-client-seed/-nonce-start` re-runs a single recorded
  round bit-exactly (audit path).
- The dump is streamed JSONL (one record per round, per-spin events inside) —
  the input to `pool` / `curate` in `stake-math-tools`.

Output includes total/per-stage RTP, hit frequency, stddev/CV, a 0–10
volatility score, max-win stats, and the win-distribution buckets — identical
fields and units to the Go binary it replaced.

---

## 8. Common compile errors

| Error | Cause / fix |
|---|---|
| `expected feature field, found ','` | `feature { a = 1, b = 2 }` — separate fields with newlines, not commas |
| `strings cannot be bound to variables` | `let s = "wild"` — keep strings as literals in record fields, or use a `const [str; N]` array and index it |
| `for-loop variable is read-only` | assign to a fresh `let` inside the loop instead |
| `recursion is not allowed: a -> b -> a` | restructure into a loop; the message shows the call cycle |
| `action 'X' is not declared in .spin` | simulate `-action` name must match an `action` declaration exactly (e.g. `buy_bonus_fox_fire`, not `buy_bonus`) |
| `outcome is missing field 'vars'` | every return must carry `win`, `vars`, `data` |
| unknown field / wrong type in a record literal | the output shapes are typed — fix the field name or the declared record |

For a full worked example read
[`kitsune-wrath`'s `game/script.spin`](../../kitsune-wrath/game/script.spin)
(7×7 cluster cascades, 5 modes, sticky wilds, const-group levers) or
`moon_spice.spin` in the engine repo (ways + cascades + jar multipliers).

Migrating an existing Lua game? See
[lua-to-spin-migration.md](lua-to-spin-migration.md).
