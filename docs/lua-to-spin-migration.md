# Migrating a game from Lua to SpinML

Playbook for porting an existing `script.logic.lua` game to the `.spin`
runtime. It follows the process used for the first ports (moon-spice-market,
kitsune-wrath — the latter is the best reference diff: 7×7 clusters,
cascades, 5 modes, sticky symbols).

Legacy games do **not** have to move: published `platform-core ≤ 0.28.x` /
`game-engine ≤ 0.27.x` / `stake-math-tools ≤ 0.8.x` keep the fengari/Lua path
working. Upgrading past those versions means porting — the Lua engine,
fengari plugin, and Go simulate CLI are gone from 0.29/0.28/0.9 onward.

Read [spinml.md](spinml.md) first for the language itself.

---

## 1. What maps to what

| Lua | SpinML |
|---|---|
| `function execute(state)` | `fn execute(c: ctx, v: Vars) -> outcome` |
| `state.action == "buy_bonus"` | `action_is(c, "buy_bonus")` |
| `state.action_config.feature_data.x` | `feature { x = 1 }` on the action + `feat_int(c, "x")` |
| `state.variables.free_spins_remaining` | field of the typed `Vars` record (`v.free_spins_remaining`) |
| `return { total_win = w, variables = {...}, matrix = ... }` | `return outcome { win: w, vars: Vars {...}, data: SpinData.stage {...} }` |
| `engine.random(a, b)` | `rng(c, a, b)` |
| `engine.random_weighted(w)` → **1-based** index | `rng_weighted(c, W)` → **0-based** index |
| `engine.random_float()` | `rng_float(c)` |
| `engine.shuffle(t)` → returns a **copy** | `shuffle(c, arr)` → shuffles **in place** |
| Lua table as grid | `[[int]]` / `[[Cell]]` lists, or flat `[int; N]` with `col*ROWS+row` indexing (faster) |
| `nil` field | optional field `mult: int?` |
| ad-hoc `SYMBOL_WEIGHTS` locals | `const W: [int; N] = [...]` globals; per-mode blocks → `const MODE = { wild: 219, symw: [...] }` groups |
| JSON config (actions, costs, transitions) | `game` + `action` declarations in the same `.spin` |
| `variables.free_spins_awarded` opening the bonus | `opens = free_spin count free_spins_awarded` on the trigger actions |
| `variables.retrigger_spins` | `extends = retrigger_spins` on the session action |
| max-win cutoff flag | `ends when max_win_reached` |

The engine no longer interprets magic variable names — the session comes from
the `opens`/`extends`/`ends when` declarations, and the checker verifies the
named fields exist in `Vars`. Forgetting the awarded-spins variable (the old
"free_spin requires an active session" bug class) is now a compile error.

## 2. The mechanical traps

These four caused every real discrepancy during the first ports — check them
before chasing anything else:

1. **Indexing is 0-based.** Every `for i = 1, #t` becomes `for i in 0..n`.
2. **`rng_weighted` returns a 0-based index.** Lua's `random_weighted` is
   1-based. A table lookup that was `VALUES[engine.random_weighted(W)]` is
   `VALUES[rng_weighted(c, W)]` — but code that *stored* the raw index needs
   a `+ 1` review.
3. **No implicit int↔float.** `win = count * pay` fails if `count` is `int`
   and `pay` is `float` — write `to_float(count) * pay`. Division of two
   ints is integer division, as in Lua's `//`, not `/`.
4. **Strings don't bind to variables.** `local s = "wild"` has no
   equivalent; use symbol *indices* everywhere in logic and translate to
   names only in output records (via literals or a `const [str; N]` table).

Also: RNG **call order is part of the math**. If the Lua rolled
wild-then-scatter per cell, keep that order — reordering draws changes every
outcome downstream even though distributions look similar in small samples.

## 3. Porting a scaffolded (game-engine) project

For a game created with `npm create @energy8platform/slot`:

1. **Bump deps**: `@energy8platform/game-engine ≥ 0.28`, `platform-core ≥
   0.29`, `stake-math-tools ≥ 0.9` (postinstall now downloads the `e8` /
   `e8-server` binaries from GitHub Releases).
2. **Write `src/game/script.spin`** next to the old
   `src/game/script.logic.lua`. The spec-derived prelude (`SPEC`, `SYM`,
   `SYMBOLS`, `PAY_*`, `VAL_*`) is injected exactly like the old Lua prelude
   — keep reading pays from it, never hard-code them. Scaffold a fresh slot
   with `create-slot` to see the current skeleton (`Vars`/`Feat`/`SpinData`,
   actions with `opens`/`extends`/`ends when`, three-return `execute`).
3. **`math.config.ts`**: set the source to the raw `.spin`
   (`import script from './src/game/script.spin?raw'` via `buildSpinScript`)
   — `runtime: 'lua'` is rejected with a migration hint from
   stake-math-tools 0.9.
4. **`dev.config.ts`**: same — the DevBridge config carries the `.spin`
   source; `defineGameConfig({ devBridge: true })` now injects `spinPlugin`
   (e8-server with hot reload) instead of the fengari plugin.
5. **`package.json`**: the `math:*` scripts run `e8-math` (`pool` = sim +
   dump + LUT, `optimize` = curate over the existing pool). Big pools need
   `NODE_OPTIONS=--max-old-space-size=8192` and profit from
   `POOL_ZSTD_LEVEL=12`.
6. **Delete the `.lua`** once validated.

Checkpoints, in order:

```bash
npx e8 check src/game/script.spin        # or via export smoke — must compile
npm run smoke                            # spec → export artifacts build
npm run dev                              # play it: base, buy, full bonus
npm run math:base                        # sim: RTP / hit / max win vs targets
```

## 4. Validating the port

Same-seed streams will **not** match the Lua engine (different RNG consumption
patterns), so validation is statistical, the way the first ports were signed
off:

- Run ≥ 10M rounds per mode on both engines (old Lua sim vs `e8 simulate`).
- Compare RTP (±0.1pp at 10M), hit frequency (±0.1pp), feature trigger rate,
  max-win probability, and the win-distribution buckets.
- Spot-check invariants: max win never exceeded, session accounting (awarded
  = played + remaining + retriggers), buy-bonus always triggers.
- Keep the Lua file in the repo until the sign-off numbers are archived in
  the PR.

## 5. Porting a platform-hosted game (casino-platform)

For games running on the platform backend rather than the scaffold:

1. Port the script as above (declarations replace most of the JSON config).
2. In the game config set `engine_mode: "spin"` and point `script_path` at
   the uploaded `.spin` (same S3 upload flow as `.lua`, same presigned-URL
   API — just a different extension).
3. The platform routes `engine_mode: "spin"` rounds to the `e8` service
   (gRPC domain API, `E8_ENGINE_ADDR`); Lua games keep running on the old
   path until each is migrated.
4. Bet/win semantics are unchanged: `win` is a bet multiplier, the platform
   applies the real bet, audit rows carry the script SHA-256.

## 6. Where the speed goes

After the port, one desktop core does ~4M rounds/sec (kitsune: 100M-round
pool in ~2 minutes wall-clock with dump + zstd). If a port simulates
significantly slower, look for: per-cell list allocations that could be flat
`[int; N]` arrays, symbol-name strings in hot loops (use indices), and
re-computed tallies that the Lua also cached.
