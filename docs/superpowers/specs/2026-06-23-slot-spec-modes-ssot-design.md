# Slot Spec-Modes SSOT + Scaffold Hardening — Design (slice 7)

Date: 2026-06-23. Branch: `feat/game-spec-define-game` (continuing).

**Goal:** make `game.spec.ts` the single source of truth for a slot's **game modes**, so the shell (buy cards + ante toggle), the math pipeline, and Stake all derive from one place — and harden the scaffold so a generated game **boots**, reads its currency/settings from the bridge, has an intro scene, and is configurable. After this, a new slot configures everything from one spec; the scaffold emits a complete, booting game.

**Decisions (from brainstorming):**
- Mode taxonomy: `ActionRole = 'base' | 'feature' | 'buy' | 'free'`. **`feature` (= ante) is a paid spin** (cost > 1, base-game, boosted — NOT a session); **`buy` purchases free spins** (lump cost → session). They are distinct roles, not an inferred sub-type. `#2 (ante)` is absorbed: ante is just a `feature` action.
- Spec is SSOT including **display** (variant B): each action carries `title`/`description`, so the shell derives cards/toggle fully from the spec — the generated `main.ts` hardcodes nothing.
- The shell **already** supports both presentations via `BonusOption.type` (`'bonus'` = buy card, `'feature'` = ante toggle) — no shell changes needed.
- `#8` IntroScene = a reusable game-engine primitive (Intro → Game flow), not a bespoke generated scene.
- boot-check = static browser-import guards + a node-level DevBridge↔SDK handshake test (a true browser+Pixi boot stays manual — Pixi `app.init()` hangs headless here).
- Out of scope (separate future slice): `#6` math-CLI / Go-sim (`pool`/`curate`). It will read the same `modeMap`/`mathModes` this slice cements.

## Motivation

The user ran a scaffolded game and surfaced: it doesn't boot (#4, fixed separately), it doesn't prompt (#1, fixed), shell currency is hardcoded (#3), no loading/sdk config (#5), no ante (#2), no intro scene (#8), and — the spine — modes are duplicated between shell / math / stake (#7). The original 6-slot analysis (`docs/slots-analysis-and-bootstrapper.md` §3.1–3.2) named mode-map duplication as a top pain. The spec already derives `gameDefinition`/`modeMap`/`mathModes` from `actions`; this slice extends that single derivation to the shell (and prepares it for the math pipeline), and fixes the scaffold-completeness gaps that the same boot/config chain exposed.

## Design principle

One `actions` map in the spec describes every mode (base / feature / buy / free) with its structure (cost, feature config) **and** display (title, description). Everything else is a pure derivation of it: `gameDefinition`, Stake `modeMap`, `mathModes`, the shell's `BonusOption[]` (cards + ante toggle), and the shell's paytable. No mode fact is written twice.

## Piece 1 — Spec mode model (the spine, #7 + #2)

`packages/platform-core/src/game-spec/types.ts`:

```ts
export type ActionRole = 'base' | 'feature' | 'buy' | 'free'; // + 'feature'

export interface ActionSpec {
  role?: ActionRole;
  stage?: string;
  cost?: number;                       // bet multiplier: 1 base, >1 feature/ante, lump for buy
  mode?: string;                       // Stake bet-mode (defaults to KEY.toUpperCase())
  feature?: Record<string, unknown>;   // feature config (spins, boost, …)
  title?: string;                      // NEW: shell display (SSOT, variant B)
  description?: string;                // NEW: shell display
  transitions?: TransitionRule[];
}
```

Role semantics (drives derivation):
- `base` — normal spin, `cost` 1, `credit:'win'`, base transitions (may award free spins → session).
- `feature` (= ante) — a **paid base-game spin**: `cost > 1`, `credit:'win'`, **base-like transitions** (can also award free spins). Derives exactly like `base` but with `cost > 1` and its own `mode`. NOT a session.
- `buy` — **purchase of free spins**: lump `cost`, `credit:'none'`, `creates_session` (unchanged from today).
- `free` — the free spins (session-driven, `debit:'none'`, `credit:'defer'`).

## Piece 2 — Derivations (the SSOT payoff)

All derived from `spec.actions` (one place):
- **`toGameDefinition` / `toModeMap` / `toMathModes`** (existing, `game-spec/derive.ts`) — extended so `role:'feature'` derives like `base` (the `base|buy` branch in `toActionDefinition` becomes `base|feature` for the win-crediting path; `buy` keeps `credit:'none'` + session). `toModeMap`/`toMathModes` already include every non-`free` action, so `feature` modes appear automatically.
- **NEW `toBonusOptions(model): BonusOption[]`** (in `game-engine/src/host/shellConfig.ts`, beside `buildShellConfig` — it bridges model→shell and already imports `BonusOption`). For each action with role `buy` or `feature`:
  ```ts
  { id: key,
    type: role === 'buy' ? 'bonus' : 'feature',
    title: action.title ?? defaultTitle(key),
    description: action.description ?? '',
    priceMultiplier: action.cost ?? (role === 'buy' ? 100 : 1) }
  ```
  (Stable order: spec declaration order.) The shell renders `'bonus'` as a buy card and `'feature'` as an ante toggle — existing behavior.
- **NEW paytable `gameInfo`** — `buildShellConfig` derives a paytable `GameInfoSection` from `toPaytableView(spec)` instead of taking a hardcoded `{ sections: [] }`. Author-supplied `gameInfo` sections (rules text) merge on top.

The generated `main.ts` no longer passes `buyBonus` or `gameInfo` paytable — they come from the spec.

## Piece 3 — Shell currency/settings from `initData` (#3)

`buildShellConfig` stops taking a hardcoded `currency`. Instead `createSlotGame` passes the runtime context from the SDK handshake:
- `currency` ← `game.initData.currency` (the bridge/Stake provide it). If `initData` yields a currency **code** (e.g. `'EUR'`), map it to a `CurrencyConfig` (`symbol`/`position`) via a small built-in code→symbol table; fallback to `spec.currency` then a neutral `{ symbol: '€', position: 'left' }` for dev with no data.
- `language` ← `game.initData.language` (fallback `'en'`).

`SlotShellOptions.currency` becomes optional (an override). `buildShellConfig`'s signature gains the runtime context (e.g. `buildShellConfig(opts, model, { balance, currency, language, mode })`).

## Piece 4 — Loading + SDK config in the scaffold (#5)

`CreateSlotGameOptions` already has `loading?` (and the dev/sdk flags). This slice:
- Gives `buildAppConfig` sensible **defaults** for `loading` when `opts.loading` is undefined (so a scaffolded game has a real loading screen, not silent defaults).
- The generated `main.ts` emits an explicit (commented, editable) `loading` block and the `dev`/`sdk` wiring, so configuration lives in one visible place in the generated game rather than being implicit.

## Piece 5 — IntroScene (#8)

A reusable primitive `IntroScene` in `game-engine` (e.g. `src/scenes/IntroScene.ts` + export), config-driven:
```ts
interface IntroSceneConfig { title?: string; logo?: string; tapToStart?: boolean; /* … */ }
```
It shows a title/logo + "tap to start", then transitions to the game scene. `createSlotGame` gains an optional `intro?: IntroSceneConfig`: when set, the host registers `IntroScene` as the **start** scene and wires `Intro → Game`. The scaffold passes a default `intro` (game title from the spec). Game flow becomes Intro → Game with no per-game boilerplate.

## Piece 6 — boot-check (so #4-class can't recur)

Two feasible, renderer-free checks (a true browser+Pixi boot can't be automated here — Pixi hangs headless; that stays a manual `npm run dev` confirmation):
- **(a) Static browser-import guard** — extend the existing generated-`dev.config` check to assert that NO generated browser-entry file (`dev.config.ts`, `vite.config.ts`, `src/main.ts`) imports a `node:` builtin. This is exactly the #4 class (browser code using Node APIs).
- **(b) Node DevBridge↔SDK handshake test** — construct a `DevBridge` from the generated game's `model.gameDefinition` + `buildLuaScript(model, logic)` (the same inputs `dev.config` feeds), start it on the in-memory channel, run `createPlatformSession({ sdk: { devMode: true } })`, and assert `ready()` resolves with `initData` (no timeout) and a first `play()` returns a result. This catches a malformed `gameDefinition` / Lua that would throw on boot — renderer-free, no Pixi, no Vite.

## Module boundaries

| Unit | Package | Change |
|------|---------|--------|
| `ActionRole` += `'feature'`; `ActionSpec.title/description` | `platform-core/game-spec/types.ts` | additive |
| `toActionDefinition` feature-role; (modeMap/mathModes unchanged) | `platform-core/game-spec/derive.ts` | extend |
| `toBonusOptions(model)`; paytable `gameInfo`; currency-from-initData; runtime-context signature | `game-engine/src/host/shellConfig.ts` + `createSlotGame.ts` | new + change |
| `loading` defaults; `intro` option + Intro→Game wiring | `game-engine/src/host/{buildConfig,createSlotGame}.ts` | extend |
| `IntroScene` primitive | `game-engine/src/scenes/IntroScene.ts` (+ export) | new |
| codegen: spec emits `feature`/`buy` actions with title/description; main.ts drops hardcoded buyBonus/gameInfo/currency, adds `intro`/`loading` | `create-slot/src/codegen/{gameSpec,mainTs}.ts` | change |
| boot-check (a) static guard + (b) handshake test | `create-slot/test/` (+ a node harness) | new |

## Data flow (shell assembly)

`createSlotGame` → SDK handshake → `game.initData` (currency/language/balance) → `buildShellConfig(opts, model, { balance, currency, language, mode })`:
- `availableBets/defaultBet` ← `model.spec`
- `currency/language` ← `initData` (fallback spec/neutral)
- `features.buyBonus` ← `toBonusOptions(model)` (buy cards + ante toggles from spec actions)
- `gameInfo` ← paytable from `toPaytableView(spec)` + author sections
- shell events route to the scene as today (spin/betChange/buyBonusSelect; buyBonusSelect now also fires for `feature`/ante options).

## Testing

- **game-spec:** `toActionDefinition` for `role:'feature'` (credit:'win', cost>1, base transitions); `modeMap`/`mathModes` include feature modes; snapshot a spec with base+feature+buy+free.
- **game-engine host:** `toBonusOptions` (buy→`type:'bonus'`, feature→`type:'feature'`, title/description/price from actions, order); `buildShellConfig` derives currency/language from a fake `initData` (+ fallbacks), derives buyBonus + paytable gameInfo from the model. `IntroScene` logic where unit-testable (Pixi parts via typecheck).
- **create-slot:** codegen emits a `feature` (ante) action + `buy` action with titles; generated `main.ts` no longer hardcodes buyBonus/gameInfo/currency and passes `intro`/`loading`; scaffold smoke stays green; boot-check (a) static guard + (b) the node handshake test on a generated game.
- **Proof:** `examples/spec-slot` and a regenerated `demo-slot` show Intro → Game, an ante toggle + a buy card derived from the spec, currency from the DevBridge config — verified by tsc + smoke + the handshake test (browser boot confirmed manually by the user).

## Out of scope (YAGNI / separate slice)

- `#6` math-CLI / Go-sim (`pool`/`curate`) — its own package + slice; consumes the `modeMap`/`mathModes` cemented here.
- True browser + Pixi boot auto-verification (Pixi headless hang) — stays a manual `npm run dev` check; boot-check (a)+(b) cover the automatable failure classes.
- i18n of card/toggle text — `title`/`description` live in the spec for now (single-locale); an id-keyed i18n map is a later refinement.

## Risks / open items

- **Currency mapping:** `initData.currency` may be a code or a full config; the plan must confirm the SDK's shape and the code→symbol table (small, extend as needed).
- **`feature` transitions:** a `feature`/ante spin can also award free spins (like base) — its default transitions must mirror `base` (free_spins_awarded → session), not be a dead self-loop.
- **`buyBonusSelect` for ante:** selecting a `type:'feature'` option must route to the scene's feature path (cost applied per spin) vs a one-shot buy — confirm the shell's event payload distinguishes them or the scene keys on the action id.
- **IntroScene as start scene:** the host's scene registration/`start` order changes when `intro` is set (Intro registered + started first, transitions to the game key) — must not break the existing no-intro path.
