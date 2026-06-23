# Stake Dev Harness (`npm run stake`) — Design (slice 10)

Date: 2026-06-23. Branch: `feat/game-spec-define-game` (continuing).

**Goal:** a `npm run stake` dev mode that runs a scaffolded game the way Stake actually launches it — framed in an iframe at a chosen screen size, driven by a local **dev-RGS** that serves real outcomes from the game's **curated books** (the `e8-math curate` artifacts), with a control bar to switch screen / currency / social / replay. When no curated books exist, the game falls back to the current Lua devBridge flow and replay is disabled.

**Decisions (from brainstorming):**
- **Backend:** a local **dev-RGS** as a vite middleware (`/__rgs/*`) implementing the real RGS HTTP contract the game's `RGSClient` calls; the iframe game runs the genuine Stake path (`rgs_url=/__rgs`). Highest fidelity.
- **Home:** a reusable primitive in `@energy8platform/stake-kit` (a new `/harness` sub-path + vite plugin). stake-kit already peer-deps `@energy8platform/stake-bridge`, so the harness imports `RGSClient`/`StakeBridge`/`CURRENCY_META` from stake-bridge (the stake-kit→stake-bridge direction — no cycle). The scaffold only wires the `npm run stake` script. No per-game duplication.
- **Outcomes:** `play` = weighted pick of a `sim` from `lookUpTable_<MODE>_0.csv`, returning that book's events from `books_<MODE>.jsonl.zst`; `replay` = the book whose id == the chosen round. No `stake-math/` → fall back to `LuaEngine` (the existing `/__lua-play` mechanism) and hide replay.
- **Reconfigure model:** `screen` = resize the iframe (CSS); `currency`/`social`/`replay` = relaunch the iframe with new query params (a fresh Stake launch).
- **Stake scope:** stake stays the **default-on** scaffold option (`--no-stake` remains for the rare non-stake game). `npm run stake` + the harness are generated only for stake games.
- `npm run dev` (Lua fullscreen) and `build:stake` (prod bundle) are unchanged. `npm run stake` is the new harness mode.

## Motivation

A scaffolded Stake game can be built (`build:stake`, slice 9) but there is no way to *run* it in dev the way Stake does: framed at the platform's screen sizes, against an RGS, with replay of recorded rounds. The pieces exist — `StakeBridge`/`RGSClient` speak the RGS contract, `StakeBridge` has a `devMode` in-process fake RGS, kitsune's `vite-replay-books.ts` already streams a curated round by id, and `CURRENCY_META` lists Stake's currencies — but nothing assembles them into a launcher. This slice builds that launcher once, as a reusable stake-bridge primitive, and serves the game's real outcomes from the curated books so dev matches production.

## The RGS contract the dev-RGS must answer

`RGSClient` ([stake-bridge/src/rgs-client.ts](../../../packages/stake-bridge/src/rgs-client.ts)) calls exactly:

| Method | Endpoint | dev-RGS behavior |
|--------|----------|------------------|
| `authenticate` | `POST /wallet/authenticate` | return `balance` + `config` (currency/social from the launch query) + no in-progress `round` |
| `balance` | `POST /wallet/balance` | return the running `balance` |
| `play` | `POST /wallet/play` | weighted-pick a `sim` from the mode's LUT → return that book (events) + debited/credited `balance` + `round` |
| `endRound` | `POST /wallet/end-round` | settle the round, credit the win, ack |
| `event` | `POST /bet/event` | ack (telemetry no-op) |
| `replay` | `GET /bet/replay/{game}/{version}/{mode}/{event}` | return the book whose id == `{event}` from `books_<MODE>.jsonl.zst` |

Launch URL params (from `parseStakeUrl`): live = `?sessionID&rgs_url&lang&currency&device&social&demo`; replay = `?replay=true&game&version&mode&event&rgs_url` (+ `amount`). **`event` is the book id** — that is the "round" the bar selects.

The response shapes (`RGSAuthenticateResponse`/`RGSPlayResponse`/`RGSReplayResponse`/`RGSEndRoundResponse`/`RGSBalance`) are the contract; the dev-RGS returns those exact shapes. Where `StakeBridge` `devMode` already synthesizes these in-process, the dev-RGS reuses that synthesis and swaps the outcome source to the curated books.

## Component 1 — `stakeHarnessPlugin()` (stake-kit `/harness`, vite plugin)

A dev-only (`apply: 'serve'`) vite plugin that:
- **Serves the wrapper page** (the parent: control bar + iframe). Routing on `/`: a request **without** an `rgs_url` query → the wrapper HTML; a request **with** `rgs_url` (the iframe's own request) → the normal game `index.html` (let vite serve it). One origin; the query discriminates, so the iframe is same-origin (the bar can resize it freely) and the inner game still loads its real entry.
- **Mounts the dev-RGS middleware** at `/__rgs/*` (the 6 endpoints above), backed by the dev-RGS data layer (Component 3). The iframe's `rgs_url=/__rgs` is same-origin.
- Resolves the books dir (default `stake-math/`, overridable) and the game's Lua (for the fallback).

Exposed as `@energy8platform/stake-kit/harness` (a node-only rollup entry — node builtins + `vite` externalized, NOT bundled into the browser `stake-kit.esm.js`) so the scaffold's harness vite config does `plugins: [stakeHarnessPlugin({ booksDir: 'stake-math', luaConfig: './dev.config' })]`.

## Component 2 — dev-RGS data layer (stake-kit)

Pure, testable functions (no vite):
- `loadIndex(booksDir)` → modes from `index.json` (`{ name, cost, events, weights }[]`); `null` if absent.
- `pickWeighted(lutPath, rng)` → choose a `sim` proportional to `weight` from `lookUpTable_<MODE>_0.csv` (streamed). Returns `{ sim, payoutCents }`.
- `readBook(eventsZstPath, id)` → the JSONL book line whose top-level `id == id` (stream + `createZstdDecompress`, early-out — kitsune's proven approach).
- `hasBooks(booksDir, mode)` → guards replay availability + the play source.

The dev-RGS handler composes these: `play` → `pickWeighted` → `readBook`; `replay` → `readBook(id)`. When `loadIndex`/`hasBooks` is empty for the mode, the handler delegates to a **Lua outcome source** (run `LuaEngine` like `luaPlugin`'s `/__lua-play`) and the wrapper marks replay unavailable.

## Component 3 — control bar (vanilla DOM, in the wrapper page)

Renderer-agnostic DOM (the shell's style), a fixed bottom bar:

```
┌──────────── <iframe> game @ selected screen preset ────────────┐
│                                                                │
└────────────────────────────────────────────────────────────────┘
[Screen ▾ Desktop] [Currency ▾ USD] [Social ☐]  │  Replay: [Mode ▾ BASE] [Round # __] [🎲] [Bet ▾ 1.00] [▶ Replay] [✕ Close]
```

- **Screen** dropdown — the 7 presets; selecting resizes the iframe (width×height, CSS). Presets: Desktop 1200×675, Laptop 1024×576, Popout S 400×225, Popout L 800×450, Mobile L 425×812, Mobile M 375×667, Mobile S 320×568.
- **Currency** dropdown — `Object.keys(CURRENCY_META)`; selecting relaunches the iframe with `currency=`.
- **Social** checkbox — relaunches with `social=true|false`.
- **Replay** group (disabled with a tooltip when no books): **Mode** dropdown (from `index.json`), **Round #** numeric id input + **🎲** (weighted-random pick), **Bet** dropdown (`spec.betLevels`), **▶ Replay** (relaunch iframe with `?replay=true&mode&event=<id>&amount=<bet>`), **✕ Close** (relaunch normal play).

## Component 4 — scaffold wiring (create-slot)

For stake games:
- `genPackageJson` adds `"stake": "BUILD_TARGET=stake-harness vite"`.
- The template `vite.config.ts` adds a `stake-harness` branch: when `process.env.BUILD_TARGET === 'stake-harness'`, mount `stakeHarnessPlugin()` (and keep `devBridge` off — the dev-RGS replaces it). The existing `dev` (Lua devBridge) and `build:stake` branches are unchanged.

## Component 5 — stake default (minimal)

Stake remains the default scaffold option (no change to `applyDefaults`). The `stake` script + harness wiring are emitted only when `a.stake`. (The "mandatory by default" intent is satisfied by stake already being the default; `--no-stake` is retained.)

## Module boundaries

| Unit | Package | Change |
|------|---------|--------|
| dev-RGS data layer (`loadIndex`/`pickWeighted`/`readBook`/`hasBooks`) | stake-kit `src/harness/` | new |
| dev-RGS handler (the 6 RGS endpoints, books or Lua source) | stake-kit `src/harness/` | new |
| `stakeHarnessPlugin()` (wrapper page + `/__rgs` mount) | stake-kit `/harness` (node rollup sub-path) | new |
| control-bar DOM UI + iframe framing | stake-kit harness (wrapper page) | new |
| `stake` script + `vite.config` `stake-harness` branch | create-slot codegen + template | change |
| spec-slot: run the harness off its e8-math books as proof | examples | change |

## Data flow

`npm run stake` → vite (BUILD_TARGET=stake-harness) → `stakeHarnessPlugin`:
1. wrapper page loads; bar defaults to Desktop / USD / social off / no replay.
2. iframe `src = /?rgs_url=/__rgs&sessionID=dev&currency=USD&social=false&lang=en&device=desktop`.
3. inner game: `isStakeLaunch` true → `StakeBridge` → `RGSClient` → `/__rgs/wallet/authenticate` → `/wallet/play` per spin.
4. dev-RGS `play`: if books for the action's mode exist → weighted-pick sim → return its book; else → LuaEngine outcome.
5. bar change: screen → resize; currency/social → relaunch (2); replay → relaunch with `?replay=true&mode&event=<id>&amount=<bet>` → dev-RGS `GET /bet/replay/...` returns book `id`.

## Testing

- **dev-RGS data layer:** `pickWeighted` respects weights (seeded RNG over a fixture LUT); `readBook` returns the line for a given id and 404s a missing id (fixture `.jsonl.zst`); `hasBooks` true/false; `loadIndex` parses the rich index.
- **dev-RGS handler:** each endpoint returns the shape `RGSClient` expects (drive it with a fixture `stake-math/` dir — assert authenticate/play/replay payloads parse into the `RGS*Response` types); the no-books path falls through to the Lua source and replay is reported unavailable.
- **harness plugin:** `configureServer` registers `/__rgs/*` middleware and serves the wrapper page (assert the route handlers exist; the heavy zstd/Lua paths are covered by the data-layer tests).
- **create-slot:** `genPackageJson` emits the `stake` script for stake games (absent for non-stake); the template vite config has the `stake-harness` branch; scaffold smoke stays green.
- **bar logic:** pure helpers — `screenPreset(name)` → `{w,h}`; `buildLaunchUrl({currency,social,replay,mode,event,amount})` → the correct query string; replay disabled when `hasBooks` is false.
- **Proof:** `examples/spec-slot` runs the harness against its `e8-math`-curated books (manual `npm run stake` confirmation — Pixi boot can't be automated here; the data-layer + URL + endpoint tests are the automatable coverage).

## Out of scope (YAGNI / separate slice)

- A production RGS or any real wallet/auth — dev-only.
- Provably-fair RNG in the dev-RGS `play` pick (a plain seeded weighted pick suffices for dev; production uses the real RGS).
- Persisting balance across reloads (each launch starts from a dev default balance).
- Multi-round session replay scrubbing beyond single-round replay by id.
- Building the harness wrapper for production (`apply: 'serve'` only).

## Risks / open items

- **dev-RGS fidelity (primary):** the response shapes must satisfy `RGSClient`. Mitigation: the plan starts by enumerating the exact `RGS*Response` shapes from `rgs-client.ts`, and reuses `StakeBridge` `devMode`'s existing in-process synthesis where it already builds them — swapping only the outcome source to the books. Each endpoint has a contract test asserting the client parses the response.
- **`devMode` synthesis reuse:** confirm `StakeBridge` `devMode`'s fake-RGS logic is factored to be callable as an HTTP handler (or extract the synthesis into a shared function). If not cleanly reusable, the dev-RGS implements the shapes directly from `rgs-client.ts` types.
- **end-round / win settlement:** the play→end-round balance math must credit the book's payout (cents) at the chosen bet; confirm the units against the LUT `payoutCents` (= bet-mult × 100, per slice 8) and `RGSBalance`'s precision.
- **books mode ↔ action mapping:** `play` must map the game's action to the Stake mode (`model.modeMap`) to choose the right LUT/book; confirm the dev-RGS receives the action/mode on `/wallet/play`.
