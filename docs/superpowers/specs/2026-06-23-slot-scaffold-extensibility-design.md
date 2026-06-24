# Slot Scaffold Extensibility — Design (slice 6)

Date: 2026-06-23. Branch: `feat/game-spec-define-game` (continuing).

**Goal:** make the scaffold + epic able to stand up a **new** slot end-to-end with no hand-rolled plumbing and **maximum flexibility**, so the *first* new slot does not hit a wall. Explicitly **not** about migrating the existing games.

**Decision summary (from brainstorming):**
- Flexibility philosophy = **B**: typed core for the common 80% (cascade/cluster + multiplier-symbols + free-spins + buy) **+ open hatches** so a novel mechanic never forces an engine type change.
- Scope = **A**: all five pieces designed cohesively here; sequenced into one implementation plan afterward.
- Result contract = **A3 (thin)**, refined: the engine ships **no coercion config**. Instead each game declares a **mandatory generic normalizer** that the **host invokes** inside a `play()` wrapper.

## Motivation

The 5-slot fit analysis (`docs/slots-analysis-and-bootstrapper.md` + per-slot reports) showed the implemented epic (game-spec / host+shell / stake-kit / slot primitives / CLI) nails the *outer* sameness but that every one of the five games independently re-implements the same inner substance the scaffold does **not** yet provide:

- a **free-spins session** loop (counter, retrigger, win accumulation, max-win exit, multiplier carry),
- a **sticky/collector multiplier** (kitsunebi = recipe = orb = stage — one abstraction),
- **Lua-result normalization** (`{}`→`[]`, field aliases, deriving winning-cell positions) before anything can consume the result,
- richer **symbol kinds / per-symbol values** and a few **spec hatches**.

Reading the *current* committed `game-spec` types showed the spec is already more flexible than the plan-era reference code implied: `SymbolKind` already has `'mid'` and `'multiplier'`; `ActionSpec.feature` is already an open `Record<string, unknown>`; `cost`, `stage`, `mode`, `transitions` already exist. So the real "first new slot breaks" risk is **not** those fields — it is the missing primitives, the missing result-normalization step, and a couple of small symbol-level hatches. This design fills exactly those.

## Design principle

The game owns mechanic-specific data and its mapping; the engine owns the reusable loop/primitives and a tiny typed contract. The typed core covers the common cascade-family slot; open hatches (`meta`, a game-declared normalizer, config-driven primitives) absorb anything novel without an engine type change.

## Piece 1 — `SlotResultNormalizer<T>` + host `play()` wrapper

**Where:** the type contract lives in `platform-core` (renderer-agnostic SDK boundary). The invocation lives in `game-engine` host (`createSlotGame`).

**Contract.** The engine ships *no* coercion DSL. Each game declares one small typed function and the host guarantees it runs:

```ts
// platform-core/src/slot-result/types.ts
export interface SlotSpinResultBase {
  /** Currency win amount for this play, as PlatformSession.play() reports it
   *  (the engine has already multiplied the Lua bet-multiplier by the bet).
   *  The host reads this to sync shell win generically. */
  totalWin: number;
  /** Optional free-spins envelope the host/scene can branch on. */
  freeSpins?: { awarded?: number; total?: number; remaining?: number };
}

export type SlotResultNormalizer<T extends SlotSpinResultBase> = (raw: unknown) => T;
```

A game's normalizer maps the raw `PlayResultData` (whatever shape its Lua emits) into its own `T extends SlotSpinResultBase` — surfacing `totalWin`/`freeSpins` plus any game-specific fields (cascade steps, multiplier, mechanic state). This is exactly the `normalizeSpinResult` every existing game hand-wrote, promoted to a first-class declared unit.

**Optional helper (not required):** `platform-core` may export `coerceLuaArrays(value, fields?)` (`{}`→`[]` on Lua empty tables) that a game's normalizer *can* call. It is a convenience, not a config layer — games are free to ignore it.

**Host integration (option 2 — host `play()` wrapper).** `createSlotGame` takes `normalize` as a **mandatory** option and exposes a normalized `play()` to the scene; the scene calls the host's `play()` instead of `platformSession.play()` directly:

```ts
interface CreateSlotGameOptions<T extends SlotSpinResultBase> {
  /* …existing options… */
  normalize: SlotResultNormalizer<T>; // REQUIRED
}

interface SlotHostApi<T extends SlotSpinResultBase> {
  /** play → normalize → shell win sync → return the game's typed T. */
  play(action: string, bet: number): Promise<T>;
}

interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
  /** Host injects its normalized play() once, on mount. Duck-typed like the others. */
  bindHost?(api: SlotHostApi<T>): void;
}
```

Inside the host, after the scene starts:

```ts
const wrappedPlay = async (action: string, bet: number): Promise<T> => {
  const raw = await game.platformSession!.play({ action, bet });
  const result = normalize(raw);          // T
  shell?.setWin(result.totalWin);         // generic shell-win sync; why T extends { totalWin }
  return result;                          // scene drives the rest (cascade/FS/multiplier)
};
sceneInst?.bindHost?.({ play: wrappedPlay });
```

This guarantees normalization happens (the scene can't forget it), centralizes shell-win sync, and leaves presentation + primitive-driving to the scene. `SlotSceneController` changes only by gaining an optional `bindHost`.

## Piece 2 — `FreeSpinsSession` (game-engine/slot, headless)

A pure, Pixi-free state machine the scene drives:

```ts
interface FreeSpinsSessionConfig {
  initialSpins: number;
  /** Extra spins to award given a normalized result; default = no retrigger. */
  retrigger?: (result: SlotSpinResultBase) => number;
  /** Optional hard exit (e.g. max-win reached). */
  isMaxWin?: () => boolean;
}

class FreeSpinsSession {
  remaining: number;
  total: number;
  totalWin: number;       // accumulated currency win across the session
  constructor(cfg: FreeSpinsSessionConfig);
  award(extra: number): void;     // retrigger adds spins
  consume(): void;                // one free spin completed
  addWin(amount: number): void;
  get isComplete(): boolean;      // remaining === 0 || isMaxWin()
}
```

The scene composes it: on a result whose `freeSpins.awarded > 0`, create the session and loop `while (!s.isComplete) { const r = await host.play('free_spin', bet); present(r); s.addWin(r.totalWin); s.award(cfg.retrigger?.(r) ?? 0); s.consume(); }`. Headless → fully unit-testable; rendering/HUD reflect it but live elsewhere.

## Piece 3 — `MultiplierMeter` (game-engine/slot: headless accumulator + optional view)

The unified abstraction behind kitsunebi / recipe / orb / stage multipliers — "collect values into a multiplier under a carry policy":

```ts
type CarryPolicy = 'spin' | 'cascade' | 'session'; // the boundary at which it resets

class MultiplierAccumulator {
  value: number;
  constructor(cfg: { policy: CarryPolicy; base?: number /* default 1 */ });
  add(delta: number): void;                 // additive collect (orbs/recipe)
  set(value: number): void;                 // absolute (stage multiplier)
  reset(boundary: 'spin' | 'cascade' | 'session'): void; // resets iff boundary >= policy scope
}
```

`reset(boundary)` clears only when the boundary is at or above the configured policy (e.g. a `'session'`-policy meter ignores `reset('cascade')` and `reset('spin')`, surviving across the whole free-spins session). An optional Pixi `MultiplierMeterView` binds to an accumulator and renders the plaque; a game may use its own view and keep just the accumulator.

## Piece 4 — Spec hatches (game-spec, additive/optional)

All additive and optional — existing specs and `derive` keep working unchanged:

```ts
interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;                  // already includes 'mid' | 'multiplier'
  pay?: Record<number, number>;      // unchanged typed default (count → multiplier)
  value?: number | number[];         // NEW: a multiplier-symbol's x-value(s)
  meta?: Record<string, unknown>;    // NEW: arbitrary per-symbol config (tier tables, flags)
}

interface GameSpec {
  /* …existing… */
  mechanic?: string;                 // NEW: open hint ('cascade'|'cluster'|'ways'|'lines'|…) for codegen/UI
  meta?: Record<string, unknown>;    // NEW: game-level hatch
}
```

`pay` stays the typed default for count-based games. Size-tier (cluster) and shape-tier (constellation) pay tables live in the game's Lua + `symbol.meta`; the UI paytable derives from `pay` when present. `derive` may optionally surface `value` into the Lua prelude (`SYMBOLS` entries carry their value) — a small, backward-compatible enhancement.

## Piece 5 — CLI mechanic + scene codegen (create-slot)

- `Mechanic` gains `'cluster'`: `Mechanic = 'cascade' | 'cluster' | 'ways' | 'lines'`. Controller mapping: `cluster | cascade → CascadeController`, `ways | lines → ReelSpinController`. (`'anywhere'` and others map to `CascadeController` too and are trivial to add later — out of scope now.)
- `Answers` gains `cascades?: boolean` (default `true` for `cascade`/`cluster`) so a `ways`/`lines` game can opt into a cascade follow-up.
- **Codegen change (the gap-closer):** the generated `GameScene`
  - implements `bindHost(api)` and calls `api.play('spin', bet)` (the host wrapper) — never `platformSession.play()` directly,
  - drives `CascadeController` over the normalized `result.steps`, `MultiplierMeter` over step multipliers, `BigWinOverlay` on win, and `FreeSpinsSession` when `result.freeSpins?.awarded` — i.e. it consumes the **declared normalizer's output**, not raw `result.data.cascades`.
- The scaffold also generates a stub `src/game/normalize.ts` that the author fills:

```ts
import type { SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { SpinData } from './schema'; // or a local type

export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = raw as { totalWin?: number; data?: any };
  return {
    totalWin: r.totalWin ?? 0,
    steps: /* TODO map r.data.cascades → CascadeStep[] */ [],
    freeSpins: /* TODO map free-spin envelope */ undefined,
  } as SpinData;
};
```

`main.ts` passes `normalize` to `createSlotGame`, and the scene is typed to the same `SpinData` so `bindHost`'s `play()` returns the right type.

## Module boundaries

| Unit | Package | Notes |
|------|---------|-------|
| `SlotSpinResultBase`, `SlotResultNormalizer<T>`, opt. `coerceLuaArrays` | `platform-core/slot-result` | renderer-agnostic type contract + optional helper |
| `normalize` host option, `SlotHostApi`, `bindHost`, `play()` wrapper | `game-engine` host (`createSlotGame`, `sceneController`, `types`) | invocation point |
| `FreeSpinsSession` | `game-engine/slot` | headless FSM |
| `MultiplierAccumulator` (+ opt. `MultiplierMeterView`) | `game-engine/slot` (+ view) | headless core + optional Pixi view |
| `SymbolSpec.value/meta`, `GameSpec.mechanic/meta` | `game-spec` | additive spec hatches |
| `Mechanic` += `cluster`, `cascades` flag, scene codegen, `normalize.ts` stub | `create-slot` | wires the above into generated games |

## Data flow (one base spin)

1. Shell `spin` → host calls `sceneInst.spin(bet)`.
2. Scene calls `host.play('spin', bet)`.
3. Host: `platformSession.play()` → `normalize(raw)` → `shell.setWin(result.totalWin)` → returns `T`.
4. Scene drives presentation from `T`: `CascadeController` over `T.steps`, `MultiplierMeter` over step multipliers, `BigWinOverlay` if win.
5. If `T.freeSpins?.awarded > 0`: scene creates a `FreeSpinsSession` and loops `host.play('free_spin', bet)` until `isComplete`.

## Testing strategy

- **platform-core:** unit-test the optional `coerceLuaArrays` helper (`{}`→`[]`, nested); `SlotResultNormalizer` is a type (typecheck only).
- **game-engine:** `FreeSpinsSession` FSM (award/consume/retrigger/max-win/accumulation) and `MultiplierAccumulator` per carry policy — both pure. Host `play()` wrapper + `bindHost`: a light unit with a fake `platformSession` and a fake `normalize` asserting normalize-then-setWin-then-return; plus typecheck that `normalize` is required and `T` flows to the scene.
- **game-spec:** `derive` snapshot with `value`/`meta` present (prelude still valid, value surfaced).
- **create-slot:** codegen assertions (scene calls `api.play`/`bindHost`, uses `FreeSpinsSession`/`MultiplierMeter`, `cluster → CascadeController`), `normalize.ts` stub generated, and the existing anti-drift scaffold smoke stays green.

## Proof

`examples/demo-slot` (already scaffolded) is the acceptance target: with a small but real cascade + multiplier-symbol + free-spins Lua and a filled `src/game/normalize.ts`, it runs end-to-end on the primitives — no hand-rolled FS loop, multiplier meter, or result coercion. Verified via typecheck + the scaffold smoke; runtime is exercised in a real browser (Pixi `app.init()` hangs headless here, so no automated screenshot).

## Out of scope (YAGNI — explicitly not in this slice)

- The presentation **event-stream** contract (brainstorm option A2).
- Migrating any of the existing games.
- `math-CLI` / Go-sim tooling, `assetsFromConvention` Vite plugin, slot **layout-manager**.
- `hold&spin`/respin and multi-**stage** progression primitives; the `anywhere` CLI mechanic.

These remain future slices; the open hatches (`meta`, game-declared `normalize`, config-driven primitives) ensure none of them require revisiting the types built here.

## Risks / open items

- **Generic `T` threading:** `createSlotGame<T>` ↔ the scene's declared `T` ↔ the normalizer's `T` must be the same type. The generated `main.ts` ties them (passes `normalize` and types the scene identically); for hand-written games this is the author's responsibility and is enforced by the `SlotSceneController<T>` / `SlotHostApi<T>` signatures.
- **No-shell case:** `shell?.setWin` is a no-op when the game runs without the DOM shell; the `play()` wrapper still normalizes and returns `T`.
- **Scene drives the FS loop (not the host):** option 2 keeps the host out of the free-spins loop; the host's `play()` is per-call. This is deliberate — the scene owns presentation pacing.
