# Game Development Guide

This document describes everything required to build your own game on the Casino Platform. It targets third-party developers and assumes no knowledge of the platform's internal architecture.

---

## Contents

1. [Platform Overview](#1-platform-overview)
2. [Game Configuration Structure (JSON)](#2-game-configuration-structure-json)
3. [Max Win Cap](#3-max-win-cap)
4. [Buy Bonus and Ante Bet](#4-buy-bonus-and-ante-bet)
5. [Actions — defining game actions](#5-actions--defining-game-actions)
6. [GameState: spin state](#6-gamestate-spin-state)
7. [Lua Script: game logic](#7-lua-script-game-logic)
8. [Lua API Reference](#8-lua-api-reference)
9. [Input/Output Validation (JSON Schema)](#9-inputoutput-validation-json-schema)
10. [Client Integration (SDK)](#10-client-integration-sdk)
11. [Deploying a Game](#11-deploying-a-game)
12. [Simulation and RTP Verification](#12-simulation-and-rtp-verification)
13. [Conventions and Best Practices](#13-conventions-and-best-practices)
14. [Migrating Configs and Scripts (v3 → v4)](#14-migrating-configs-and-scripts-v3--v4)
15. [Table Games](#15-table-games)
    - 15.1. [Session Model for Table Games](#151-session-model-for-table-games)
    - 15.2. [Persistent State (`_persist_` convention)](#152-persistent-state-_persist_-convention)
    - 15.3. [Example: Blackjack](#153-example-blackjack)
16. [Cross-Spin Persistent State (meters and accumulators)](#16-cross-spin-persistent-state-meters-and-accumulators)

---

## 1. Platform Overview

The platform's game engine runs server-side. Each game consists of two parts:

1. **JSON configuration** (`GameDefinition`) — a minimal set of platform fields: identifier, type, bet levels, limits, actions (transitions), buy bonus / ante bet.
2. **Lua script** — all game logic: symbols, reels/grid, paylines, payouts, cascades, free spins, multipliers, and any other math.

The backend handles **math only** — graphics, animation, and sound stay on the client.

### Architecture: Lua-only

All games use a **single Lua engine**. The JSON configuration contains no game logic — only platform metadata and transition rules (actions/transitions). The Lua script exports a single `execute(state)` function that receives `state.action` and `state.stage` and implements all game math.

> **Note**: The JSON Flow Executor (the `engine_mode: "json"` field, the `logic`/`steps` blocks, the built-in actions `spin_reels`, `evaluate_lines`, etc.) has been **removed**. The `engine_mode` field is no longer used.

### Two game types

| Type | `type` field | Description |
|------|--------------|-------------|
| **SLOT** | `"SLOT"` | Slots — classic and video. Symbol grid, reels, paylines, cascades, free spins. All logic in the Lua script. |
| **TABLE** | `"TABLE"` | Table games — blackjack, roulette, baccarat, etc. Multi-step rounds with arbitrary decision logic. → see §15 |

### Security model

The game loads inside an iframe. The client SDK communicates with the host via `postMessage`. The JWT token is **never** passed into the iframe — all API calls are proxied through the host page.

---

## 2. Game Configuration Structure (JSON)

The configuration is a JSON file containing **only platform fields**. All game logic (symbols, reels, paylines, payouts, cascades, etc.) is defined in the Lua script.

```
GameDefinition
├── id                          string        (required) Unique game identifier
├── type                        string        (required) Category: "SLOT" | "TABLE"
├── script_path                 string        (required) S3 key for the Lua script (e.g. "games/my-game/script.lua")
│
├── actions                     map           (required) → see §5 (ActionDefinition)
│
├── bet_levels                  BetLevelsConfig  Allowed bets
│   │   — array: [0.20, 0.50, 1.00]              → list of levels only
│   │   — object: {"min": 0.20, "max": 100}      → range
│   │   — object: {"levels": [...], "max": 100}  → list + cap
│   ├── levels                  float64[]     Explicit list of allowed bet amounts
│   ├── min                     float64?      Minimum bet (optional)
│   └── max                     float64?      Maximum bet (optional)
│
├── max_win                     object        → see §3 (Max Win Cap)
│   ├── multiplier              float64       Max win as a multiplier of bet (e.g. 10000)
│   └── fixed                   float64       Absolute cap in currency (e.g. 500000)
│
├── session_ttl                 string        Session TTL (e.g. "30m", "1h"). Defaults to a platform-defined value.
│
├── buy_bonus                   object        → see §4
│   └── modes                   map           Buy-bonus modes
│       └── [mode_name]         object        One mode (e.g. "default", "super")
│           ├── cost_multiplier float64       Cost as a multiplier of bet
│           └── scatter_distribution map      Scatter count distribution
├── ante_bet                    object        → see §4
│   └── cost_multiplier         float64       Spin cost multiplier (1.25 = +25%)
│
├── persistent_state            object        → see §16 (Cross-Spin Persistent State)
│   ├── vars                    string[]      Names of numeric variables persisted across spins
│   └── exposed_vars            string[]      Names of variables exposed to the client in data.persistent_state
│
├── input_schema                object        → see §9
└── output_schema               object        → see §9
```

> **Removed from JSON config (v4)**: `version`, `rtp`, `viewport`, `symbols`, `reel_strips`, `symbol_weights`, `paylines`, `stages`, `logic`, `engine_mode`, `evaluation_mode`, `min_match_count`, `anywhere_payouts`, `scatter_payouts`, `free_spins_trigger`, `free_spins_retrigger`, `free_spins_config`, `round_type_weights`, `symbol_chances`, `multiplier_value_weights`, `ante_bet.scatter_chance_multiplier`. All of these are now defined directly inside the Lua script.

### Minimal config example

```json
{
  "id": "my_slot",
  "type": "SLOT",
  "script_path": "games/my-slot/script.lua",
  "bet_levels": [0.20, 0.50, 1.00, 2.00, 5.00],
  "max_win": { "multiplier": 10000 },
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        { "condition": "always", "next_actions": ["spin"] }
      ]
    }
  }
}
```

---

## 3. Max Win Cap

The `max_win` field caps the maximum win of a single round (base game + all free spins).

```json
"max_win": {
  "multiplier": 10000,
  "fixed": 500000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `multiplier` | float64 | Max win as a multiplier of bet. `10000` = up to 10,000× bet. |
| `fixed` | float64 | Absolute cap in currency. `500000` = at most 500,000. |

If both are set, the smaller is used: `min(bet × multiplier, fixed)`.

When the cap is reached:
1. `TotalWin` is clipped to the effective cap.
2. The variable `max_win_reached` is set to `1`.
3. The client receives `"max_win_reached": true` in `data`.
4. If a bonus round (free spins) is in progress, the session ends early.

---

## 4. Buy Bonus and Ante Bet

### Buy Bonus

Lets the player purchase entry into the bonus round directly. The cost is a fixed multiplier of bet. On purchase, the platform draws a scatter count from `scatter_distribution` and passes it to the Lua script via `state.params.forced_scatter_count`.

```json
"buy_bonus": {
  "modes": {
    "default": {
      "cost_multiplier": 100,
      "scatter_distribution": { "4": 60, "5": 30, "6": 10 }
    },
    "super": {
      "cost_multiplier": 200,
      "scatter_distribution": { "5": 70, "6": 30 }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `cost_multiplier` | Cost as a multiplier of bet. With bet 1.00 and multiplier 100 → 100.00 is debited. |
| `scatter_distribution` | Weighted distribution of scatter counts. Key — the count, value — its weight. |

For each mode, declare a separate action with `debit: "buy_bonus_cost"` and `buy_bonus_mode`:

```json
"buy_bonus": {
  "stage": "base_game",
  "debit": "buy_bonus_cost",
  "buy_bonus_mode": "default",
  "transitions": [
    {
      "condition": "always",
      "creates_session": true,
      "credit_override": "defer",
      "next_actions": ["free_spin"],
      "session_config": {
        "total_spins_var": "free_spins_awarded",
        "persistent_vars": ["global_multiplier"]
      }
    }
  ]
}
```

**What the Lua script gets on buy bonus:**
- `state.params.buy_bonus = true`
- `state.params.buy_bonus_mode = "default"` (or `"super"`)
- `state.params.forced_scatter_count = 5` (drawn by the platform)

The script must use `forced_scatter_count` to place scatters on the grid.

### Ante Bet

A higher-cost bet. The JSON config only stores `cost_multiplier`:

```json
"ante_bet": {
  "cost_multiplier": 1.25
}
```

When `ante_bet: true` is in the client params, the platform debits `bet × 1.25`. The increased scatter chance is implemented inside the Lua script (the script reads `state.params.ante_bet`).

---

## 5. Actions — defining game actions

The single endpoint `POST /api/games/{id}/play` routes requests through the `actions` field in the config.

### ActionDefinition

```json
{
  "spin": {
    "stage": "base_game",
    "debit": "bet",
    "credit": "win",
    "transitions": [
      {
        "condition": "free_spins_awarded > 0",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["free_spin"],
        "session_config": {
          "total_spins_var": "free_spins_awarded",
          "persistent_vars": ["global_multiplier"]
        }
      },
      { "condition": "always", "next_actions": ["spin"] }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `stage` | Stage name passed as `state.stage` when calling `execute(state)` |
| `debit` | Debit type: `"bet"`, `"buy_bonus_cost"`, `"ante_bet_cost"`, `"none"` |
| `credit` | When to credit the win: `"win"` (immediately), `"none"`, `"defer"` |
| `requires_session` | Requires an active session (round_id) |
| `buy_bonus_mode` | Key into `buy_bonus.modes` |
| `transitions` | Conditional transitions after the stage runs |
| `input_schema` | Per-action JSON Schema for params validation |

### Transitions

After a stage runs, transitions are evaluated in order — the first match defines behavior:

| Field | Description |
|-------|-------------|
| `condition` | govaluate expression against `state.Variables`, or `"always"` |
| `creates_session` | Create a session (free spins, pick bonus) |
| `complete_session` | End the session and credit the accumulated win |
| `credit_override` | `"defer"` — defer crediting |
| `next_actions` | Actions made available to the client |
| `session_config.total_spins_var` | Variable → `session.SpinsRemaining` |
| `session_config.persistent_vars` | Variables persisted in Redis between spins |
| `add_spins_var` | Retrigger: add spins from a variable |

### Session lifecycle

```
spin (base_game) → free_spins_awarded > 0 → creates_session, credit_override: "defer"
  → free_spin (free_spins) × N → complete_session → credit accumulated win
```

Persistent variables (e.g. `global_multiplier`) are stored in Redis between spins.

---

## 6. GameState: spin state

```go
type GameState struct {
    Variables map[string]float64 // "multiplier", "free_spins_awarded", "max_win_reached"
    TotalWin  float64
    Params    map[string]any     // Validated client parameters
    Data      map[string]any     // Output data from the Lua script
}
```

The Lua script receives `state.variables` and `state.params` and returns a table that lands in `Data`. The `total_win` key in the returned table sets `TotalWin`; the `variables` key is merged into `Variables`.

Standard engine variables:

| Variable | Description |
|----------|-------------|
| `bet` | Bet amount |
| `multiplier` | Cascade multiplier (defaults to 1) |
| `global_multiplier` | Multiplier accumulated across the session |
| `free_spins_awarded` | Number of free spins triggered |
| `free_spins_remaining` | Free spins remaining |
| `max_win_reached` | 1 if the win cap has been hit |

---

## 7. Lua Script: game logic

### Entry point

The script exports an `execute(state)` function:

```lua
function execute(state)
    if state.stage == "base_game" then
        return do_base_game(state)
    elseif state.stage == "free_spins" then
        return do_free_spins(state)
    end
end
```

### `state` shape

| Field | Type | Description |
|-------|------|-------------|
| `state.stage` | string | Stage name from the ActionDefinition |
| `state.params` | table | Client parameters + buy_bonus, forced_scatter_count |
| `state.variables` | table | Engine variables (bet, multiplier, free_spins_remaining) |

### Returned table

```lua
return {
    total_win = 15.5,           -- required: win as a multiplier of bet
    variables = {               -- optional: update variables
        free_spins_awarded = 10,
        global_multiplier = 3,
    },
    -- everything else → state.Data (sent to the client)
    matrix = {{1,2,3},{4,5,6}},
    win_lines = {...},
    scatter_count = 3,
}
```

### What the script defines

All game logic is described inside the Lua script:

- **Symbols**: ID table, wild/scatter/multiplier flags
- **Grid size** (viewport): `local COLS = 6; local ROWS = 5`
- **Reels / symbol weights**: reel strips or weight tables
- **Paylines / Anywhere Pays**: lines and payout tables
- **Scatters and free spins**: trigger and retrigger rules
- **Cascades / Tumble**: remove, shift, refill
- **Multipliers**: collection and application logic
- **Buy bonus**: forced-scatter placement on the grid

### Sandbox

- Allowed libraries: `base`, `table`, `string`, `math`
- No access to `os`, `io`, `debug`, `loadfile`, `dofile`
- Timeout: 5 seconds
- VM pool (`sync.Pool`) for concurrent execution

---

## 8. Lua API Reference

The `engine` module is available globally:

| Function | Description |
|----------|-------------|
| `engine.random(min, max)` | Cryptographically secure random integer [min, max] |
| `engine.random_float()` | Random number [0.0, 1.0) |
| `engine.random_weighted(weights)` | 1-based index from a weights table `{w1, w2, ...}` |
| `engine.shuffle(arr)` | Shuffle (Fisher-Yates, crypto RNG); returns a copy |
| `engine.log(level, msg)` | Server log: `"debug"`, `"info"`, `"warn"`, `"error"` |
| `engine.get_config()` | Table: `{id, type, bet_levels}` from the JSON config |

> `engine.get_symbol()` has been removed. Symbols are defined directly inside the Lua script.

### Usage examples

```lua
-- Weighted symbol pick
local SYMBOL_WEIGHTS = {5, 7, 9, 11, 14, 17, 20, 23, 26}
local idx = engine.random_weighted(SYMBOL_WEIGHTS)  -- 1-based index

-- Random position
local pos = engine.random(1, 30)

-- Shuffle a deck
local deck = engine.shuffle({1, 2, 3, ..., 52})
```

---


## 9. Input/Output Validation (JSON Schema)

The configuration supports optional JSON Schemas (draft 2020-12) for validating spin parameters and describing output data.

### input_schema

Validates `PlayRequest.Params` — the parameters the client passes on a play action:

```json
"input_schema": {
  "type": "object",
  "properties": {
    "lines": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    },
    "ante_bet": {
      "type": "boolean"
    },
    "buy_bonus": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

If the parameters fail validation, the spin is rejected with an error.

### output_schema

Describes the structure of `PlayResult.data` (informational, not used for validation):

```json
"output_schema": {
  "type": "object",
  "properties": {
    "matrix": {
      "type": "array",
      "items": { "type": "array", "items": { "type": "integer" } }
    },
    "win_lines": {
      "type": "array"
    },
    "multiplier": {
      "type": "number"
    }
  }
}
```

---

## 10. Client Integration (SDK)

The client side uses `@energy8platform/game-sdk`. Full reference — see [game_sdk_reference.md](game_sdk_reference.md).

### Quick overview

```typescript
import { CasinoGameSDK } from '@energy8platform/game-sdk';

const sdk = new CasinoGameSDK();

// 1. Initialize — fetch config and balance
const initData = await sdk.ready();
// initData.config    — game configuration (GameDefinition)
// initData.balance   — current balance
// initData.currency  — currency
// initData.assetsUrl — base URL for assets

// 2. Spin (universal play method)
const result = await sdk.play({ action: 'spin', bet: 1.00, params: { lines: 20 } });
// result.roundId       — round ID
// result.action        — executed action ("spin")
// result.totalWin      — win amount
// result.balanceAfter  — balance after the spin
// result.data          — payload from GameState.Data (matrix, lines, multipliers...)
// result.nextActions   — next available actions (["spin"], ["free_spin"], ["pick"])
// result.session       — session state (if free spins triggered)
// result.creditPending — true when crediting is deferred

// 3. Free spin (when nextActions includes "free_spin")
if (result.nextActions.includes('free_spin')) {
    const fs = await sdk.play({ action: 'free_spin', bet: 0, roundId: result.roundId });
    // fs.session.spinsRemaining — free spins remaining
    // fs.session.completed      — true when the bonus is over
    // fs.session.maxWinReached  — true if the max-win cap was hit
}

// 4. Balance
const balance = await sdk.getBalance();

// 5. Cleanup
sdk.destroy();
```

### What `result.data` contains

`result.data` is `GameState.Data` assembled by the engine:

- For the JSON engine: auto-mapped from `Matrix`, `WinLines`, `AnywhereWins`, etc. via `MapState()`.
- For the Lua engine: everything the script returned in its result table (except the special keys `total_win`, `free_spins`, `variables`).

Use `output_schema` in the config to document the `data` structure of your game.

---

## 11. Deploying a Game

### Step 1: Create the game record

```bash
POST /api/v1/admin/games
Content-Type: application/json

{
  "id": "my_new_slot",
  "title": "My New Slot",
  "type": "SLOT",
  "version": "1.0.0",
  "engine_mode": "json",
  "rtp": "96.5",
  "description": "Game description"
}
```

The game is created inactive (`is_active = false`). The default config path is `games/{id}/config.json`.

### Step 2: Upload the configuration to S3

Get a presigned URL:

```bash
POST /api/v1/admin/games/upload-url?game_id=my_new_slot&asset_type=config
```

Upload the config to that URL:

```bash
PUT {presigned_url}
Content-Type: application/json

< my_new_slot_config.json
```

### Step 3: Upload assets

Same flow — get a URL for each asset type (`ICON`, `BACKGROUND`, `SOUND_BUNDLE`) and upload the files.

### Step 4: Lua script (when `engine_mode: "lua"` or hybrid)

Lua scripts live in S3 alongside the configuration. Get a presigned URL with `type="script"`:

```bash
POST /api/v1/admin/games/{id}/upload-url
Content-Type: application/json

{
  "type": "script",
  "filename": "script.lua"
}
```

Upload the `.lua` file to the URL:

```bash
PUT {presigned_url}
Content-Type: application/octet-stream

< my_game_script.lua
```

The script is stored in S3 at `games/{gameID}/script.lua`. In the configuration, set `script_path` to the matching S3 key:

```json
{
  "engine_mode": "lua",
  "script_path": "games/my-game/script.lua"
}
```

> **Note**: if `script_path` is just a file name (e.g. `"script.lua"`), the platform automatically resolves it to `games/{gameID}/script.lua`. In dev mode (file-based config repo) scripts are still read from the local `scripts/` directory.

### Step 5: Activation

Update the game's status to expose it in the client lobby.

---

## 12. Simulation and RTP Verification

Before deploying, use the simulation CLI to verify the math model.

### Running

```bash
go run cmd/simulation/main.go
```

> By default `cmd/simulation/main.go` hard-codes `configPath` and `iterations`. Adjust them for your game.

### Sample output

```
Starting simulation for piggy_gates (1000000 iterations)...

--- Simulation Results ---
Game: piggy_gates
Iterations: 1000000
Duration: 12.5s
Total RTP: 96.48%
Base Game RTP: 72.31%
Free Spins RTP: 24.17%
Hit Frequency: 28.45%
Max Win: 5234.50x
Max Win Hits: 3 (rounds capped by max_win)
Free Spins Triggered: 4521 (1 in 221 spins)
Free Spins Played: 52847
```

### Metrics

| Metric | Description |
|--------|-------------|
| `Total RTP` | Overall Return to Player (should match the target `rtp` in the config). |
| `Base Game RTP` | RTP contribution of the base game. |
| `Free Spins RTP` | RTP contribution of bonus rounds. |
| `Hit Frequency` | Fraction of spins with a non-zero win. |
| `Max Win` | Largest single-round win (in bet multiples). |
| `Max Win Hits` | Number of rounds where the win was clipped by `max_win`. |

Run at least **1,000,000** iterations for stable results.

---

## 13. Conventions and Best Practices

1. **Symbol IDs are integers**. String names (keys in `symbols`) are for config readability only. Inside the engine and in `reel_strips`, `paylines`, `anywhere_payouts` — use IDs only.

2. **All payouts are bet multipliers**. `TotalWin = 50` at bet 2.00 = 100.00 of real currency. Don't use absolute amounts.

3. **Prefer `symbol_weights` over `reel_strips`** for new games. The `name→weight` format is easier to reason about, RTP-tune, and supports per-reel configuration. `reel_strips` is kept for backwards compatibility.

4. **Payout-key formats**: `"symbolID:count"` for paylines (e.g. `"1:3"`), string thresholds for anywhere (`"8"`, `"10"`), string counts for scatter (`"3"`, `"4"`).

5. **Use `input_schema`** to validate client params (`PlayRequest.Params`) — guards against malformed requests.

6. **Stage and action naming**: stages can be named freely (`"base_game"`, `"free_spins"`, `"bonus_pick"`, etc.). In Lua mode the script exports a single `execute(state)` and dispatches on `state.stage`. The `actions` block is **required** in the config (see §10.1).

7. **The global multiplier (`global_multiplier`)** is preserved across free spins via the Redis session. Use it for accumulating effects.

8. **Cascades implement via a loop**: condition `"last_win_amount > 0"`, body — `remove_winning_symbols` → `shift_and_fill` → evaluate → `payout`.

9. **Don't rely on Lua globals** between calls — VMs are reused from a pool.

10. **Test via simulation** before deploying. Achieved RTP must match the declared `rtp` within ±0.5%.

11. **Always set `max_win`** for production games. Without a cap, cascade-style games can theoretically deliver anomalously large wins. Standard range: 5,000×–20,000× bet.

12. **`free_spins_config.persistent_state`** — list every variable that should accumulate across free spins. If unset, only `global_multiplier` is preserved by default.

13. **For table games (TABLE) use the `_persist_` convention** — store complex structures (deck, player hands) in `state.Data` under `_persist_<name>` keys. The platform automatically saves them in Redis between actions (→ §21.2).

14. **Table games are Lua-only**. The JSON engine targets slots; card/table-game logic is significantly more complex and requires full control via `execute(state)`.

---

## 14. Migrating Configs and Scripts (v3 → v4)


v4 removes the JSON Flow Executor. All games now use Lua scripts.

| Was (v3) | Now (v4) |
|----------|----------|
| `engine_mode: "json"` + `logic` block | Removed. All games = Lua. |
| `symbols`, `viewport`, `reel_strips`, `paylines` in JSON | Removed from JSON. Defined inside the Lua script. |
| `anywhere_payouts`, `scatter_payouts`, `free_spins_trigger` in JSON | Removed from JSON. Defined inside the Lua script. |
| `symbol_weights`, `symbol_chances`, `round_type_weights` in JSON | Removed from JSON. Defined inside the Lua script. |
| `ante_bet.scatter_chance_multiplier` in JSON | Removed. Implemented in Lua (script reads `state.params.ante_bet`). |
| `engine.get_symbol(id)` in Lua | Removed. Symbols are defined in the script. |
| `engine.get_config().viewport` | Removed. Viewport is defined in the script. |
| `state.Matrix`, `state.WinLines`, `state.AnywhereWins` in Go | Removed. Everything goes through `state.Data`. |

**Migration steps:**
1. Move `symbols`, `viewport`, `reel_strips`/`symbol_weights`, `paylines`/`anywhere_payouts`, `scatter_payouts`, `free_spins_trigger` from JSON into the Lua script.
2. Remove those fields from the JSON config.
3. Replace `engine.get_symbol(id)` with a local symbol table.
4. Replace `engine.get_config().viewport` with local constants.
5. Make sure `script_path` is set in the JSON config.

---

## 15. Table Games

The platform supports **table games** — blackjack, roulette, baccarat, and others. Table games use `type: "TABLE"` and a Lua script for all logic.

### Key differences from slots

| Aspect | Slots (`SLOT`) | Table games (`TABLE`) |
|--------|---------------|------------------------|
| Engine mode | JSON or Lua | Lua only |
| Round model | 1 action = 1 round (or fixed count in a bonus) | Multi-step round: deal → hit/stand/double → resolve |
| Session | `SpinsRemaining` counter | Unlimited (`SpinsRemaining = -1`), ended by `complete_session` |
| Persistent state | `map[string]float64` (numeric variables) | `map[string]any` (arbitrary structures: card arrays, hands, deck) |
| Viewport | Symbol grid `width × height` | Unused (`0 × 0`) |
| Symbols / Paylines | Drive math | Empty (all logic in Lua) |

### 15.1. Session Model for Table Games

For table games the session is created on `deal` and ends on `complete_session: true`. Between actions (hit, stand, double, split) the number of steps is unbounded.

#### Unlimited sessions

`session_config.total_spins_var` names a variable (e.g. `"_table_unlimited"`), and the Lua script sets it to `-1`:

```lua
variables._table_unlimited = -1
```

This yields `SpinsRemaining = -1`, which means:
- The session does not end via the counter (no decrement)
- The session passes validation (`SpinsRemaining < 0` is treated as "unlimited")
- The session ends **only** through `complete_session: true` in a transition

#### Round completion

The Lua script signals round completion via a variable:

```lua
variables.round_complete = 1
```

Which fires this transition:

```json
{
  "condition": "round_complete == 1",
  "complete_session": true,
  "next_actions": ["deal"]
}
```

### 15.2. Persistent State (`_persist_` convention)

Table games keep complex state between actions: the deck, player and dealer hands, round phase, etc. Since `state.Variables` only carries `float64`, a `_persist_` convention is used:

#### Saving (Lua → Redis)

The Lua script writes data into `state.Data` under the `_persist_` prefix:

```lua
-- Save deck, hands, and round phase
data._persist_shoe = gs.shoe              -- 312-card array
data._persist_shoe_pos = gs.shoe_pos      -- number
data._persist_player_hands = gs.player_hands  -- array of objects
data._persist_dealer_cards = gs.dealer_cards  -- array
data._persist_phase = gs.phase            -- string
```

The platform automatically:
1. Extracts every `_persist_`-prefixed key from `state.Data`.
2. Saves them to `session.PersistentState` (without the prefix): `shoe`, `shoe_pos`, `player_hands`, …
3. The data is JSON-serialized and stored in Redis.

#### Restoring (Redis → Lua)

On the next action, the data is exposed in `state.params` under the `_ps_` prefix:

```lua
local gs = {}
gs.shoe         = state.params._ps_shoe           -- card array
gs.shoe_pos     = state.params._ps_shoe_pos        -- number (may be a float → floor it)
gs.player_hands = state.params._ps_player_hands    -- array of objects
gs.dealer_cards = state.params._ps_dealer_cards    -- array
gs.phase        = state.params._ps_phase           -- string
```

> **Important**: numeric values may come back as `float64` after a JSON round-trip (Redis → Go → Lua). Use `math.floor()` for integer values:
> ```lua
> gs.shoe_pos = math.floor(state.params._ps_shoe_pos or 1)
> ```

#### Backwards compatibility

For slots, `PersistentState` still stores `float64` values listed in `session_config.persistent_vars`. The `_persist_` convention is an additional mechanism — they don't conflict.

### 15.3. Example: Blackjack

A complete dealer-blackjack implementation (6-deck shoe, dealer stands on soft 17).

#### Configuration

```json
{
  "id": "blackjack",
  "type": "TABLE",
  "engine_mode": "lua",
  "script_path": "games/blackjack/script.lua",
  "stages": ["deal", "player_action"],
  "bet_levels": [1, 2, 5, 10, 25, 50, 100],
  "rtp": "99.5",
  "viewport": { "width": 0, "height": 0 },
  "symbols": {},
  "reel_strips": {},
  "paylines": [],
  "logic": {},
  "actions": {
    "deal": {
      "stage": "deal",
      "debit": "bet",
      "credit": "none",
      "transitions": [
        { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
        {
          "condition": "always",
          "creates_session": true,
          "credit_override": "defer",
          "next_actions": ["hit", "stand", "double"],
          "session_config": { "total_spins_var": "_table_unlimited" }
        }
      ]
    },
    "hit":    { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "stand":  { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "double": { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] },
    "split":  { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] }
  }
}
```

#### Lua script (structure)

```lua
-- Single entry point
function execute(state)
    if state.stage == "deal" then
        return do_deal(state)
    elseif state.stage == "player_action" then
        return do_player_action(state)
    end
end

function do_deal(state)
    -- 1. Build and shuffle the shoe (6 decks = 312 cards)
    local shoe = engine.shuffle(create_deck())

    -- 2. Deal: player, dealer, player, dealer
    local p1, p2 = shoe[1], shoe[3]
    local d1, d2 = shoe[2], shoe[4]

    -- 3. Check for natural blackjack → round_complete = 1
    -- 4. Otherwise → save state, return a partial dealer hand

    -- Save persistent state
    data._persist_shoe = shoe
    data._persist_shoe_pos = 5
    data._persist_player_hands = { {cards = {p1, p2}, bet_mult = 1} }
    data._persist_dealer_cards = {d1, d2}

    return {
        total_win = 0,
        variables = { round_complete = 0, _table_unlimited = -1 },
        player_hands = {...},      -- visible hands
        dealer_hand = {...},       -- first card only
        phase = "player_turn",
    }
end

function do_player_action(state)
    -- Restore state from persistent
    local gs = {
        shoe = state.params._ps_shoe,
        player_hands = state.params._ps_player_hands,
        dealer_cards = state.params._ps_dealer_cards,
    }

    -- Determine action from the action name
    local action = state.params._action  -- "hit", "stand", "double", "split"

    if action == "hit" then
        -- Add a card, check for bust
    elseif action == "stand" then
        -- Mark hand as standing
    elseif action == "double" then
        -- Double the bet, take one card, stand
    elseif action == "split" then
        -- Split into two hands
    end

    -- Are all hands done? → dealer draws → resolve
    if all_hands_done then
        play_dealer(gs)  -- Dealer hits until 17+
        local results, total_payout = resolve_hands(gs)

        return {
            total_win = total_payout - 1,  -- profit multiplier
            variables = { round_complete = 1 },
            player_hands = format_hands(gs.player_hands, results),
            dealer_hand = format_dealer(gs.dealer_cards, false),
            phase = "resolved",
        }
    end

    -- Still actions left → save and return
    save_game_state(gs, data)
    return {
        total_win = 0,
        variables = { round_complete = 0 },
        player_hands = format_hands(gs.player_hands),
        dealer_hand = format_dealer(gs.dealer_cards, true),  -- hole card hidden
        phase = "player_turn",
        available_actions = get_available_actions(gs),
    }
end
```

#### Round flow (client ↔ server)

```
Client                             Server
  │                                  │
  │ POST /play {action:"deal"}       │
  │ ──────────────────────────────▶  │ 1. Debit bet
  │                                  │ 2. Shuffle & deal
  │                                  │ 3. Create session (unlimited)
  │ ◀──────────────────────────────  │ 4. Return player_hands, dealer_hand (hole hidden)
  │ {next_actions: [hit,stand,dbl]}  │
  │                                  │
  │ POST /play {action:"hit"}        │
  │ ──────────────────────────────▶  │ 5. Restore state from Redis
  │                                  │ 6. Deal a card to the player
  │ ◀──────────────────────────────  │ 7. Save state, return updated hand
  │ {next_actions: [hit,stand]}      │
  │                                  │
  │ POST /play {action:"stand"}      │
  │ ──────────────────────────────▶  │ 8. Restore state
  │                                  │ 9. Dealer draws (S17)
  │                                  │ 10. Resolve & compare hands
  │                                  │ 11. Complete session, credit win
  │ ◀──────────────────────────────  │ 12. Return results, payouts
  │ {next_actions: [deal]}           │
```

#### Payout rules

| Result | Multiplier | Payout at bet 10 |
|--------|------------|------------------|
| Blackjack (natural 21) | 2.5× | 25 (profit: 15) |
| Win | 2.0× | 20 (profit: 10) |
| Push | 1.0× | 10 (profit: 0) |
| Lose | 0.0× | 0 (loss: 10) |
| Insurance win (dealer BJ) | 1.5× of half the bet | +7.50 |

> **TotalWin** is the **profit multiplier** (payout minus bet). For example, blackjack = `1.5` (received 2.5× bet, minus 1× bet = 1.5× profit). The platform computes `profit × bet = real win`.

### Checklist for a new table game

- [ ] `type: "TABLE"` in the config
- [ ] `engine_mode: "lua"`
- [ ] `viewport: { width: 0, height: 0 }` (no grid needed)
- [ ] `symbols`, `reel_strips`, `paylines`, `logic` — all empty
- [ ] Each player action is a separate action with `requires_session: true`
- [ ] The first action (`deal`) — `debit: "bet"`, `creates_session: true`
- [ ] `session_config.total_spins_var` points at a variable holding `-1`
- [ ] The Lua script uses the `_persist_` convention for complex persistent state
- [ ] The Lua script sets `round_complete = 1` to end the round
- [ ] `complete_session: true` in a transition guarded by `round_complete == 1`
- [ ] Actions with extra cost (`double`, `split`) declare `debit: "bet"`
- [ ] `state.params._action` is used to identify the action type in Lua

---

## 16. Cross-Spin Persistent State (meters and accumulators)

Some mechanics need state preserved **between base spins** — accumulating charges, progressive multipliers, counters toward a bonus. Unlike session-scoped `_persist_` (§15.2), which only lives inside a bonus round, Cross-Spin Persistent State lives **independently of sessions** and has no TTL.

### How it works

1. The JSON config declares a `persistent_state` block.
2. Before each spin, the platform loads stored values from Redis into `state.variables`.
3. After the spin, the platform reads the declared variables from `state.variables` and writes them back.
4. The client receives the current values in `data.persistent_state`.

### Configuration

```json
{
  "id": "charge_slot",
  "type": "SLOT",
  "script_path": "games/charge-slot/script.lua",
  "persistent_state": {
    "vars": ["charge_meter", "bonus_level"],
    "exposed_vars": ["charge_meter", "bonus_level"]
  },
  "bet_levels": [0.20, 1.00, 5.00],
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        { "condition": "always", "next_actions": ["spin"] }
      ]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `vars` | `string[]` | Names of numeric variables (`state.variables.*`) persisted across spins. |
| `exposed_vars` | `string[]` | Subset of `vars` exposed to the client in `data.persistent_state`. |

### Lua script

The script consumes persistent state through the standard `state.variables` — no special API:

```lua
function execute(state)
    -- Charges loaded by the platform from Redis → state.variables
    local charges = state.variables.charge_meter or 0
    local bonus_level = state.variables.bonus_level or 0

    -- ... main spin logic ...
    -- Suppose every special symbol on the reels adds a charge
    charges = charges + special_symbol_count

    local bonus_triggered = false
    if charges >= 50 then
        bonus_triggered = true
        charges = 0        -- reset after trigger
        bonus_level = bonus_level + 1
    end

    return {
        total_win = win,
        variables = {
            charge_meter = charges,       -- platform writes back to Redis
            bonus_level = bonus_level,
        },
        -- client data
        matrix = matrix,
        charge_meter_triggered = bonus_triggered,
    }
end
```

### What the client sees

`result.data` gains a `persistent_state` field with the current values of the declared `exposed_vars`:

```json
{
  "data": {
    "matrix": [[1,2,3],[4,5,6],[7,8,9]],
    "charge_meter_triggered": false,
    "persistent_state": {
      "charge_meter": 23,
      "bonus_level": 1
    }
  }
}
```

### Complex data (`_persist_game_` convention)

For non-numeric data (arrays, tables) use the `_persist_game_` prefix in the Lua return table. It mirrors the session-scoped `_persist_` (§15.2) but persists across spins:

```lua
return {
    total_win = win,
    variables = { charge_meter = charges },
    _persist_game_collected_symbols = collected_symbols_array,
}
```

On the next spin the data is exposed via `state.params._ps_collected_symbols`.

> **Important**: `_persist_game_*` keys are excluded from history and never reach the client.

### Load order

1. Cross-spin persistent state is loaded first → `state.variables`.
2. Then session state (if there's an active session) is loaded → **overwrites** matching keys.

This means that during free spins, session variables take precedence, but base-game accumulating meters are still available (unless the session overrides them).

### Resetting state

An admin can reset persistent state through the API:

```
DELETE /api/v1/admin/users/{userId}/games/{gameId}/persistent-state
```

The Lua script can also reset values itself (e.g. zero the `charge_meter` after triggering a bonus).

### Differences from session-scoped `_persist_`

| | Session-scoped `_persist_` (§15.2) | Cross-Spin `persistent_state` (§16) |
|---|---|---|
| Lifetime | Within a single session (free spins, table round) | Across all base spins of a user |
| TTL | Inherits the session TTL | None (lives forever) |
| Storage | Inside the `GameSession` object | A dedicated Redis key |
| Configuration | `session_config.persistent_vars` in a transition | `persistent_state.vars` at config root |
| Lua prefix (complex data) | `_persist_*` | `_persist_game_*` |
| Restoration in Lua | `state.params._ps_*` | `state.variables.*` (numbers) / `state.params._ps_*` (complex) |

---

## Related documentation

- [game_engine_design.md](game_engine_design.md) — engine design (technical architecture)
- [game_sdk_reference.md](game_sdk_reference.md) — full client SDK reference
- [game_bridge_protocol.md](game_bridge_protocol.md) — postMessage protocol
- [api_protocol.md](api_protocol.md) — REST API endpoints
- [architecture.md](architecture.md) — platform architecture
