# game-spec / defineGame() Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@energy8platform/platform-core/game-spec` — a single authored `GameSpec` from which `gameDefinition`, a Lua constants prelude, the Stake mode-map, math modes, and a shell paytable view are deterministically derived; proven by a greenfield `examples/spec-slot/`.

**Architecture:** A renderer-agnostic sub-package of platform-core with five isolated units (types, validate, derive, defineGame, export). `defineGame(spec)` validates then derives an in-memory `GameModel` (runtime source of truth, zero files). `exportGame(spec, { logicLua })` emits the two deployable artifacts (`gameDefinition.json` + a self-contained `script.lua`) using the same Lua concatenation rule used at dev runtime. game-engine re-exports the sub-path so pixi games get it for free.

**Tech Stack:** TypeScript, Vitest (node env), Rollup (multi-entry bundles), fengari LuaEngine (existing platform-core/lua), npm workspaces.

## Global Constraints

- Sub-package lives at `packages/platform-core/src/game-spec/`; renderer-agnostic — **no** imports of pixi.js, react, or DOM. (mirrors the `/lua`, `/shell` isolation contract.)
- Reuse existing platform-core types verbatim: `GameDefinition`, `ActionDefinition`, `TransitionRule`, `SessionConfig`, `MaxWinConfig` from `src/lua/types.ts`. Do **not** redefine them.
- `GameDefinition.type` is the string `'SLOT'` (uppercase). `max_win` is `{ multiplier?: number }`. `ActionDefinition.transitions` is a **required** array.
- Lua script contract: a script defines a global `execute(state)` returning a table `{ total_win, matrix, ... }`. The prelude is plain Lua source prepended to logic; logic reads prelude globals (`SYM`, `SYMBOLS`, `PAYTABLE`, `SPEC`).
- The Lua concatenation rule is **one** function used by both dev runtime and export: `buildLuaScript(model, logicLua) === model.luaPrelude + "\n" + logicLua`.
- spec owns *structure* only (symbols, paytable, bet-levels, actions+costs, grid). Reel weights/profiles stay in the authored `script.logic.lua`.
- Tests are renderer-free and live in `packages/platform-core/tests/game-spec/` (vitest include is `tests/**/*.test.ts`, node env, globals on). Tests import from `../../src/game-spec` directly — no build/export wiring needed to run them.
- Generated/exported files are build outputs and are never hand-edited.
- Commit after each task. Branch already exists: `feat/game-spec-define-game`.

## File Structure

```
packages/platform-core/src/game-spec/
  types.ts        GameSpec, SymbolSpec, ActionSpec, GameModel, MathModeSpec, PaytableView
  validate.ts     validateSpec(spec) + GameSpecError
  derive.ts       toGameDefinition, toLuaPrelude, toModeMap, toMathModes, toPaytableView
  defineGame.ts   defineGame(spec): GameModel
  export.ts       buildLuaScript(model, logicLua), exportGame(spec, { logicLua })
  index.ts        public surface
packages/platform-core/tests/game-spec/
  validate.test.ts
  derive.test.ts
  defineGame.test.ts
  export.test.ts
  integration.test.ts
  fixtures/logic.lua
packages/game-engine/src/game-spec/
  index.ts        re-export of platform-core/game-spec
examples/spec-slot/
  game.spec.ts
  script.logic.lua
  dev.config.ts
  smoke.ts
  package.json
  tsconfig.json
```

Wiring touched: `packages/platform-core/package.json` (exports), `packages/platform-core/rollup.config.mjs` (bundle), `packages/game-engine/package.json` (exports), `packages/game-engine/rollup.config.mjs` (bundle).

---

### Task 1: Spec types, validation, and sub-path wiring

**Files:**
- Create: `packages/platform-core/src/game-spec/types.ts`
- Create: `packages/platform-core/src/game-spec/validate.ts`
- Create: `packages/platform-core/src/game-spec/index.ts`
- Modify: `packages/platform-core/package.json` (add `./game-spec` export)
- Modify: `packages/platform-core/rollup.config.mjs` (add bundle)
- Create: `packages/game-engine/src/game-spec/index.ts`
- Modify: `packages/game-engine/package.json` (add `./game-spec` export)
- Modify: `packages/game-engine/rollup.config.mjs` (add bundle)
- Test: `packages/platform-core/tests/game-spec/validate.test.ts`

**Interfaces:**
- Produces: the spec type surface and `validateSpec(spec: GameSpec): void` (throws `GameSpecError`).

```ts
// types consumed by every later task — exact shapes:
export type SymbolKind = 'high' | 'low' | 'wild' | 'scatter' | 'multiplier';
export type ActionRole = 'base' | 'free' | 'buy';

export interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;
  pay?: Record<number, number>; // matchCount -> multiplier; omitted for specials
}

export interface ActionSpec {
  role?: ActionRole;            // default 'base'
  stage?: string;               // default by role: base/buy -> 'base_game', free -> 'free_spins'
  cost?: number;                // cost_multiplier, default 1
  mode?: string;                // Stake/math mode name; default UPPER(actionKey)
  feature?: Record<string, unknown>;
  transitions?: TransitionRule[]; // override convention defaults
}

export interface GameSpec {
  id: string;
  type: 'slot';
  grid: { cols: number; rows: number };
  betLevels: number[];
  defaultBet?: number;
  maxWin: number;               // multiplier cap
  currency?: string;
  symbols: SymbolSpec[];
  actions: Record<string, ActionSpec>;
}

export interface MathModeSpec {
  action: string;
  mode: string;
  costMultiplier: number;
}

export interface PaytableEntry { id: string; name: string; kind: SymbolKind; pay: Record<number, number>; }
export interface PaytableView { symbols: PaytableEntry[]; }

export interface GameModel {
  spec: GameSpec;
  gameDefinition: GameDefinition;
  luaPrelude: string;
  modeMap: Record<string, string>;
  mathModes: MathModeSpec[];
  paytable: PaytableView;
  symbols: SymbolSpec[];
}
```

- [ ] **Step 1: Write `types.ts`**

```ts
// packages/platform-core/src/game-spec/types.ts
import type { GameDefinition, TransitionRule } from '../lua/types';

export type SymbolKind = 'high' | 'low' | 'wild' | 'scatter' | 'multiplier';
export type ActionRole = 'base' | 'free' | 'buy';

export interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;
  pay?: Record<number, number>;
}

export interface ActionSpec {
  role?: ActionRole;
  stage?: string;
  cost?: number;
  mode?: string;
  feature?: Record<string, unknown>;
  transitions?: TransitionRule[];
}

export interface GameSpec {
  id: string;
  type: 'slot';
  grid: { cols: number; rows: number };
  betLevels: number[];
  defaultBet?: number;
  maxWin: number;
  currency?: string;
  symbols: SymbolSpec[];
  actions: Record<string, ActionSpec>;
}

export interface MathModeSpec {
  action: string;
  mode: string;
  costMultiplier: number;
}

export interface PaytableEntry {
  id: string;
  name: string;
  kind: SymbolKind;
  pay: Record<number, number>;
}

export interface PaytableView {
  symbols: PaytableEntry[];
}

export interface GameModel {
  spec: GameSpec;
  gameDefinition: GameDefinition;
  luaPrelude: string;
  modeMap: Record<string, string>;
  mathModes: MathModeSpec[];
  paytable: PaytableView;
  symbols: SymbolSpec[];
}
```

- [ ] **Step 2: Write the failing validation test**

```ts
// packages/platform-core/tests/game-spec/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateSpec, GameSpecError } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const base = (): GameSpec => ({
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 1], maxWin: 1000,
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 5 } },
    { id: 'WILD', kind: 'wild' },
  ],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' } },
});

describe('validateSpec', () => {
  it('accepts a valid spec', () => {
    expect(() => validateSpec(base())).not.toThrow();
  });
  it('rejects duplicate symbol ids', () => {
    const s = base(); s.symbols.push({ id: 'A', kind: 'low', pay: { 3: 2 } });
    expect(() => validateSpec(s)).toThrow(GameSpecError);
  });
  it('rejects cost <= 0', () => {
    const s = base(); s.actions.buy = { role: 'buy', cost: 0 };
    expect(() => validateSpec(s)).toThrow(/cost/);
  });
  it('rejects unsorted bet levels', () => {
    const s = base(); s.betLevels = [1, 0.2, 0.1];
    expect(() => validateSpec(s)).toThrow(/bet/i);
  });
  it('rejects empty bet levels', () => {
    const s = base(); s.betLevels = [];
    expect(() => validateSpec(s)).toThrow(/bet/i);
  });
  it('rejects maxWin <= 0', () => {
    const s = base(); s.maxWin = 0;
    expect(() => validateSpec(s)).toThrow(/maxWin/);
  });
  it('rejects pay with non-positive multiplier', () => {
    const s = base(); s.symbols[0].pay = { 3: 0 };
    expect(() => validateSpec(s)).toThrow(/pay/);
  });
  it('rejects a transition referencing an unknown action', () => {
    const s = base();
    s.actions.spin = { role: 'base', transitions: [{ condition: 'always', next_actions: ['nope'] }] };
    expect(() => validateSpec(s)).toThrow(/next_actions|unknown action/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/game-spec/validate.test.ts`
Expected: FAIL — cannot resolve `../../src/game-spec` (index/validate not written).

- [ ] **Step 4: Write `validate.ts` and `index.ts`**

```ts
// packages/platform-core/src/game-spec/validate.ts
import type { GameSpec } from './types';

export class GameSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameSpecError';
  }
}

export function validateSpec(spec: GameSpec): void {
  if (!spec.id) throw new GameSpecError('spec.id is required');
  if (spec.maxWin <= 0) throw new GameSpecError('spec.maxWin must be > 0');

  if (!spec.betLevels.length) throw new GameSpecError('spec.betLevels must be non-empty');
  for (let i = 1; i < spec.betLevels.length; i++) {
    if (spec.betLevels[i] <= spec.betLevels[i - 1]) {
      throw new GameSpecError('spec.betLevels must be strictly ascending');
    }
  }

  const ids = new Set<string>();
  for (const sym of spec.symbols) {
    if (ids.has(sym.id)) throw new GameSpecError(`duplicate symbol id: ${sym.id}`);
    ids.add(sym.id);
    if (sym.pay) {
      for (const [count, mult] of Object.entries(sym.pay)) {
        if (Number(count) <= 0 || !Number.isInteger(Number(count))) {
          throw new GameSpecError(`symbol ${sym.id} pay key must be a positive integer: ${count}`);
        }
        if (mult <= 0) throw new GameSpecError(`symbol ${sym.id} pay[${count}] must be > 0`);
      }
    }
  }

  const actionKeys = new Set(Object.keys(spec.actions));
  for (const [key, action] of Object.entries(spec.actions)) {
    if (action.cost !== undefined && action.cost <= 0) {
      throw new GameSpecError(`action ${key} cost must be > 0`);
    }
    for (const t of action.transitions ?? []) {
      for (const next of t.next_actions) {
        if (!actionKeys.has(next)) {
          throw new GameSpecError(`action ${key} transition next_actions references unknown action: ${next}`);
        }
      }
    }
  }
}
```

```ts
// packages/platform-core/src/game-spec/index.ts
export * from './types';
export { validateSpec, GameSpecError } from './validate';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/game-spec/validate.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Wire the platform-core sub-path export**

In `packages/platform-core/package.json`, add to `exports` (after `"./shell"`):

```json
    "./game-spec": {
      "import": "./dist/game-spec.esm.js",
      "require": "./dist/game-spec.cjs.js",
      "types": "./dist/game-spec.d.ts"
    }
```

In `packages/platform-core/rollup.config.mjs`, add alongside the other `createBundle(...)` lines:

```js
  ...createBundle('src/game-spec/index.ts', 'game-spec'),
```

- [ ] **Step 7: Wire the game-engine re-export**

```ts
// packages/game-engine/src/game-spec/index.ts
export * from '@energy8platform/platform-core/game-spec';
```

In `packages/game-engine/package.json`, add a `./game-spec` export entry mirroring an existing sub-path (e.g. copy the shape of `./lua`, substituting `game-spec`). In `packages/game-engine/rollup.config.mjs`, add a bundle for `src/game-spec/index.ts` named `game-spec` mirroring the existing `lua` re-export bundle.

- [ ] **Step 8: Verify build + typecheck green**

Run: `npm run build --workspace @energy8platform/platform-core && npm run typecheck --workspace @energy8platform/platform-core`
Expected: build emits `dist/game-spec.esm.js` / `.cjs.js` / `.d.ts`; typecheck passes.

- [ ] **Step 9: Commit**

```bash
git add packages/platform-core/src/game-spec packages/platform-core/tests/game-spec \
        packages/platform-core/package.json packages/platform-core/rollup.config.mjs \
        packages/game-engine/src/game-spec packages/game-engine/package.json packages/game-engine/rollup.config.mjs
git commit -m "feat(platform-core): game-spec types + validateSpec + sub-path wiring"
```

---

### Task 2: Derivers (spec → gameDefinition / prelude / modeMap / mathModes / paytable)

**Files:**
- Create: `packages/platform-core/src/game-spec/derive.ts`
- Modify: `packages/platform-core/src/game-spec/index.ts` (export derivers)
- Test: `packages/platform-core/tests/game-spec/derive.test.ts`

**Interfaces:**
- Consumes: `GameSpec`, `SymbolSpec`, `ActionSpec`, `MathModeSpec`, `PaytableView`, `GameModel` from Task 1; `GameDefinition`, `ActionDefinition`, `TransitionRule` from `src/lua/types`.
- Produces:
  - `toGameDefinition(spec: GameSpec): GameDefinition`
  - `toLuaPrelude(spec: GameSpec): string`
  - `toModeMap(spec: GameSpec): Record<string, string>`
  - `toMathModes(spec: GameSpec): MathModeSpec[]`
  - `toPaytableView(spec: GameSpec): PaytableView`

Convention defaults (used when `ActionSpec.transitions` is absent):
- `freeActionKey(spec)` = first action key whose `role === 'free'`, else `undefined`.
- base/buy default transitions: if a free action exists →
  `[{ condition: 'free_spins_awarded > 0', creates_session: true, next_actions: [freeKey], session_config: { total_spins_var: 'free_spins_awarded' } }]`; else `[]`.
- free default transitions: `[{ condition: 'retrigger_spins > 0', add_spins_var: 'retrigger_spins', next_actions: [freeKey] }]`.
- Role → `{ debit, credit, requires_session, stage }`:
  - base: `debit 'bet'`, `credit 'win'`, stage `'base_game'`
  - buy:  `debit 'bet'`, `credit 'none'`, stage `'base_game'`
  - free: `debit 'none'`, `credit 'defer'`, `requires_session true`, stage `'free_spins'`
- `toModeMap` / `toMathModes` include only actions with `role !== 'free'`; mode name = `action.mode ?? key.toUpperCase()`.

- [ ] **Step 1: Write the failing derive test**

```ts
// packages/platform-core/tests/game-spec/derive.test.ts
import { describe, it, expect } from 'vitest';
import {
  toGameDefinition, toLuaPrelude, toModeMap, toMathModes, toPaytableView,
} from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 1], maxWin: 1000, currency: 'EUR',
  symbols: [
    { id: 'A', name: 'Ace', kind: 'high', pay: { 3: 5, 4: 20 } },
    { id: 'WILD', kind: 'wild' },
  ],
  actions: {
    spin: { role: 'base' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 50, feature: { spins: 8 } },
  },
};

describe('toGameDefinition', () => {
  const gd = toGameDefinition(spec);
  it('sets SLOT type, bet levels and max win', () => {
    expect(gd.type).toBe('SLOT');
    expect(gd.bet_levels).toEqual([0.1, 0.2, 1]);
    expect(gd.max_win).toEqual({ multiplier: 1000 });
  });
  it('maps base action with default FS-trigger transition', () => {
    expect(gd.actions.spin.debit).toBe('bet');
    expect(gd.actions.spin.credit).toBe('win');
    expect(gd.actions.spin.transitions[0].next_actions).toEqual(['free_spin']);
    expect(gd.actions.spin.transitions[0].creates_session).toBe(true);
  });
  it('maps free action as session spin', () => {
    expect(gd.actions.free_spin.debit).toBe('none');
    expect(gd.actions.free_spin.requires_session).toBe(true);
  });
  it('maps buy action cost_multiplier and feature_data', () => {
    expect(gd.actions.buy_bonus.cost_multiplier).toBe(50);
    expect(gd.actions.buy_bonus.feature_data).toEqual({ spins: 8 });
  });
});

describe('toLuaPrelude', () => {
  const lua = toLuaPrelude(spec);
  it('emits SYM index table and PAYTABLE', () => {
    expect(lua).toMatch(/SYM\s*=\s*\{/);
    expect(lua).toMatch(/A\s*=\s*1/);
    expect(lua).toMatch(/PAYTABLE/);
    expect(lua).toMatch(/\[3\]\s*=\s*5/);
  });
});

describe('toModeMap / toMathModes', () => {
  it('excludes free actions and defaults mode to UPPER(key)', () => {
    expect(toModeMap(spec)).toEqual({ spin: 'SPIN', buy_bonus: 'BUY_BONUS' });
    expect(toMathModes(spec)).toEqual([
      { action: 'spin', mode: 'SPIN', costMultiplier: 1 },
      { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 50 },
    ]);
  });
});

describe('toPaytableView', () => {
  it('includes only paying symbols', () => {
    expect(toPaytableView(spec).symbols).toEqual([
      { id: 'A', name: 'Ace', kind: 'high', pay: { 3: 5, 4: 20 } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/game-spec/derive.test.ts`
Expected: FAIL — derivers not exported.

- [ ] **Step 3: Write `derive.ts`**

```ts
// packages/platform-core/src/game-spec/derive.ts
import type { GameDefinition, ActionDefinition, TransitionRule } from '../lua/types';
import type { GameSpec, ActionSpec, ActionRole, MathModeSpec, PaytableView } from './types';

function freeActionKey(spec: GameSpec): string | undefined {
  return Object.keys(spec.actions).find((k) => spec.actions[k].role === 'free');
}

function defaultStage(role: ActionRole): string {
  return role === 'free' ? 'free_spins' : 'base_game';
}

function defaultTransitions(role: ActionRole, freeKey: string | undefined): TransitionRule[] {
  if (role === 'free') {
    return freeKey
      ? [{ condition: 'retrigger_spins > 0', add_spins_var: 'retrigger_spins', next_actions: [freeKey] }]
      : [];
  }
  // base | buy
  return freeKey
    ? [{
        condition: 'free_spins_awarded > 0',
        creates_session: true,
        next_actions: [freeKey],
        session_config: { total_spins_var: 'free_spins_awarded' },
      }]
    : [];
}

function toActionDefinition(key: string, action: ActionSpec, freeKey: string | undefined): ActionDefinition {
  const role = action.role ?? 'base';
  const transitions = action.transitions ?? defaultTransitions(role, freeKey);
  if (role === 'free') {
    return {
      stage: action.stage ?? defaultStage(role),
      debit: 'none',
      credit: 'defer',
      requires_session: true,
      transitions,
      ...(action.feature ? { feature_data: action.feature } : {}),
    };
  }
  return {
    stage: action.stage ?? defaultStage(role),
    debit: 'bet',
    cost_multiplier: action.cost ?? 1,
    credit: role === 'buy' ? 'none' : 'win',
    transitions,
    ...(action.feature ? { feature_data: action.feature } : {}),
  };
}

export function toGameDefinition(spec: GameSpec): GameDefinition {
  const freeKey = freeActionKey(spec);
  const actions: Record<string, ActionDefinition> = {};
  for (const [key, action] of Object.entries(spec.actions)) {
    actions[key] = toActionDefinition(key, action, freeKey);
  }
  return {
    id: spec.id,
    type: 'SLOT',
    actions,
    bet_levels: [...spec.betLevels],
    max_win: { multiplier: spec.maxWin },
  };
}

function luaTable(record: Record<number, number>): string {
  const parts = Object.entries(record).map(([k, v]) => `[${k}]=${v}`);
  return `{${parts.join(', ')}}`;
}

export function toLuaPrelude(spec: GameSpec): string {
  const lines: string[] = ['-- AUTO-GENERATED from game.spec.ts — do not edit'];
  lines.push(`SPEC = { cols = ${spec.grid.cols}, rows = ${spec.grid.rows}, max_win = ${spec.maxWin} }`);

  const symNames = spec.symbols.map((s) => `"${s.id}"`).join(', ');
  lines.push(`SYMBOLS = { ${symNames} }`);

  const symIndex = spec.symbols.map((s, i) => `${s.id}=${i + 1}`).join(', ');
  lines.push(`SYM = { ${symIndex} }`);

  const payEntries = spec.symbols
    .filter((s) => s.pay)
    .map((s) => `  ${s.id} = ${luaTable(s.pay as Record<number, number>)}`);
  lines.push(`PAYTABLE = {\n${payEntries.join(',\n')}\n}`);

  return lines.join('\n') + '\n';
}

export function toModeMap(spec: GameSpec): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, action] of Object.entries(spec.actions)) {
    if ((action.role ?? 'base') === 'free') continue;
    map[key] = action.mode ?? key.toUpperCase();
  }
  return map;
}

export function toMathModes(spec: GameSpec): MathModeSpec[] {
  const modes: MathModeSpec[] = [];
  for (const [key, action] of Object.entries(spec.actions)) {
    if ((action.role ?? 'base') === 'free') continue;
    modes.push({ action: key, mode: action.mode ?? key.toUpperCase(), costMultiplier: action.cost ?? 1 });
  }
  return modes;
}

export function toPaytableView(spec: GameSpec): PaytableView {
  return {
    symbols: spec.symbols
      .filter((s) => s.pay)
      .map((s) => ({ id: s.id, name: s.name ?? s.id, kind: s.kind, pay: { ...(s.pay as Record<number, number>) } })),
  };
}
```

- [ ] **Step 4: Export derivers from `index.ts`**

Append to `packages/platform-core/src/game-spec/index.ts`:

```ts
export { toGameDefinition, toLuaPrelude, toModeMap, toMathModes, toPaytableView } from './derive';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/game-spec/derive.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/game-spec/derive.ts packages/platform-core/src/game-spec/index.ts \
        packages/platform-core/tests/game-spec/derive.test.ts
git commit -m "feat(platform-core): game-spec derivers (gameDefinition/prelude/modeMap/mathModes/paytable)"
```

---

### Task 3: `defineGame()` composition

**Files:**
- Create: `packages/platform-core/src/game-spec/defineGame.ts`
- Modify: `packages/platform-core/src/game-spec/index.ts` (export `defineGame`)
- Test: `packages/platform-core/tests/game-spec/defineGame.test.ts`

**Interfaces:**
- Consumes: `validateSpec` (Task 1), all derivers (Task 2).
- Produces: `defineGame(spec: GameSpec): GameModel`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/game-spec/defineGame.test.ts
import { describe, it, expect } from 'vitest';
import { defineGame, GameSpecError } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }, { id: 'WILD', kind: 'wild' }],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' } },
};

describe('defineGame', () => {
  it('returns a model with all derived views', () => {
    const m = defineGame(spec);
    expect(m.spec).toBe(spec);
    expect(m.gameDefinition.id).toBe('g');
    expect(m.luaPrelude).toMatch(/PAYTABLE/);
    expect(m.modeMap).toEqual({ spin: 'SPIN' });
    expect(m.mathModes).toEqual([{ action: 'spin', mode: 'SPIN', costMultiplier: 1 }]);
    expect(m.paytable.symbols.map((s) => s.id)).toEqual(['A']);
    expect(m.symbols).toBe(spec.symbols);
  });
  it('validates before deriving', () => {
    const bad: GameSpec = { ...spec, betLevels: [] };
    expect(() => defineGame(bad)).toThrow(GameSpecError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/game-spec/defineGame.test.ts`
Expected: FAIL — `defineGame` not exported.

- [ ] **Step 3: Write `defineGame.ts`**

```ts
// packages/platform-core/src/game-spec/defineGame.ts
import type { GameSpec, GameModel } from './types';
import { validateSpec } from './validate';
import { toGameDefinition, toLuaPrelude, toModeMap, toMathModes, toPaytableView } from './derive';

export function defineGame(spec: GameSpec): GameModel {
  validateSpec(spec);
  return {
    spec,
    gameDefinition: toGameDefinition(spec),
    luaPrelude: toLuaPrelude(spec),
    modeMap: toModeMap(spec),
    mathModes: toMathModes(spec),
    paytable: toPaytableView(spec),
    symbols: spec.symbols,
  };
}
```

- [ ] **Step 4: Export from `index.ts`**

Append to `packages/platform-core/src/game-spec/index.ts`:

```ts
export { defineGame } from './defineGame';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/game-spec/defineGame.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/game-spec/defineGame.ts packages/platform-core/src/game-spec/index.ts \
        packages/platform-core/tests/game-spec/defineGame.test.ts
git commit -m "feat(platform-core): defineGame() composes spec into GameModel"
```

---

### Task 4: `buildLuaScript` + `exportGame` (deploy artifacts)

**Files:**
- Create: `packages/platform-core/src/game-spec/export.ts`
- Modify: `packages/platform-core/src/game-spec/index.ts` (export both)
- Test: `packages/platform-core/tests/game-spec/export.test.ts`

**Interfaces:**
- Consumes: `defineGame` (Task 3), `GameModel`, `GameSpec`.
- Produces:
  - `buildLuaScript(model: GameModel, logicLua: string): string` — `model.luaPrelude + "\n" + logicLua`.
  - `exportGame(spec: GameSpec, opts: { logicLua: string }): { 'gameDefinition.json': string; 'script.lua': string }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/game-spec/export.test.ts
import { describe, it, expect } from 'vitest';
import { defineGame, buildLuaScript, exportGame } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }],
  actions: { spin: { role: 'base' } },
};
const LOGIC = 'function execute(state) return { total_win = 0, matrix = {{1}} } end';

describe('buildLuaScript', () => {
  it('prepends the prelude to logic', () => {
    const m = defineGame(spec);
    const out = buildLuaScript(m, LOGIC);
    expect(out.startsWith(m.luaPrelude)).toBe(true);
    expect(out.endsWith(LOGIC)).toBe(true);
    expect(out).toContain('PAYTABLE');
  });
});

describe('exportGame', () => {
  it('emits gameDefinition.json and a self-contained script.lua', () => {
    const out = exportGame(spec, { logicLua: LOGIC });
    const gd = JSON.parse(out['gameDefinition.json']);
    expect(gd.id).toBe('g');
    expect(gd.type).toBe('SLOT');
    expect(out['script.lua']).toContain('PAYTABLE');
    expect(out['script.lua']).toContain('function execute');
  });
  it('is deterministic', () => {
    const a = exportGame(spec, { logicLua: LOGIC });
    const b = exportGame(spec, { logicLua: LOGIC });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/game-spec/export.test.ts`
Expected: FAIL — `buildLuaScript`/`exportGame` not exported.

- [ ] **Step 3: Write `export.ts`**

```ts
// packages/platform-core/src/game-spec/export.ts
import type { GameSpec, GameModel } from './types';
import { defineGame } from './defineGame';

export function buildLuaScript(model: GameModel, logicLua: string): string {
  return model.luaPrelude + '\n' + logicLua;
}

export function exportGame(
  spec: GameSpec,
  opts: { logicLua: string },
): { 'gameDefinition.json': string; 'script.lua': string } {
  const model = defineGame(spec);
  return {
    'gameDefinition.json': JSON.stringify(model.gameDefinition, null, 2),
    'script.lua': buildLuaScript(model, opts.logicLua),
  };
}
```

- [ ] **Step 4: Export from `index.ts`**

Append to `packages/platform-core/src/game-spec/index.ts`:

```ts
export { buildLuaScript, exportGame } from './export';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/game-spec/export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/game-spec/export.ts packages/platform-core/src/game-spec/index.ts \
        packages/platform-core/tests/game-spec/export.test.ts
git commit -m "feat(platform-core): buildLuaScript + exportGame deploy artifacts"
```

---

### Task 5: Integration — LuaEngine runs prelude+logic from a model

**Files:**
- Create: `packages/platform-core/tests/game-spec/fixtures/logic.lua`
- Test: `packages/platform-core/tests/game-spec/integration.test.ts`

**Interfaces:**
- Consumes: `defineGame`, `buildLuaScript` (Tasks 3–4); `LuaEngine` from `../../src/lua`.
- Proves the runtime path: a model's prelude + an authored logic.lua, concatenated, loads in LuaEngine and a `spin` reads `PAYTABLE` to produce the expected win.

- [ ] **Step 1: Write the fixture logic**

```lua
-- packages/platform-core/tests/game-spec/fixtures/logic.lua
function execute(state)
  -- reads PAYTABLE + SYM injected by the generated prelude
  local pay = PAYTABLE["A"][3]
  return {
    total_win = state.bet * pay,
    matrix = {
      { SYM.A, SYM.A, SYM.A },
      { SYM.B, SYM.B, SYM.B },
      { SYM.A, SYM.B, SYM.A },
    },
  }
end
```

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/platform-core/tests/game-spec/integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineGame, buildLuaScript } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';
import { LuaEngine } from '../../src/lua';

const spec: GameSpec = {
  id: 'spec-integration', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 5 } },
    { id: 'B', kind: 'low', pay: { 3: 2 } },
  ],
  actions: { spin: { role: 'base' } },
};

const logic = readFileSync(resolve(__dirname, 'fixtures/logic.lua'), 'utf8');

describe('game-spec + LuaEngine integration', () => {
  let engine: LuaEngine;
  afterEach(() => engine?.destroy());

  it('runs a spin using the generated prelude', () => {
    const model = defineGame(spec);
    engine = new LuaEngine({
      script: buildLuaScript(model, logic),
      gameDefinition: model.gameDefinition,
      seed: 1,
    });
    const result = engine.execute({ action: 'spin', bet: 2 });
    // PAYTABLE.A[3] = 5, bet 2 -> 10
    expect(result.totalWin).toBe(10);
    expect(Array.isArray(result.data.matrix)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npx vitest run packages/platform-core/tests/game-spec/integration.test.ts`
Expected first run (before fixture exists / mis-pathed): FAIL. After Step 1 fixture is in place: PASS with `totalWin === 10`.

If it fails because `execute` global is missing, confirm the prelude ends with a newline and `buildLuaScript` joins with `"\n"` (it does) so the prelude's last statement and `function execute` are on separate lines.

- [ ] **Step 4: Run the whole game-spec suite**

Run: `npx vitest run packages/platform-core/tests/game-spec/`
Expected: all files PASS (validate, derive, defineGame, export, integration).

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/tests/game-spec/fixtures/logic.lua \
        packages/platform-core/tests/game-spec/integration.test.ts
git commit -m "test(platform-core): game-spec + LuaEngine end-to-end integration"
```

---

### Task 6: Greenfield example `examples/spec-slot/`

**Files:**
- Create: `examples/spec-slot/game.spec.ts`
- Create: `examples/spec-slot/script.logic.lua`
- Create: `examples/spec-slot/dev.config.ts`
- Create: `examples/spec-slot/smoke.ts`
- Create: `examples/spec-slot/package.json`
- Create: `examples/spec-slot/tsconfig.json`

**Interfaces:**
- Consumes: the public `@energy8platform/platform-core/game-spec` surface and `LuaEngine` from `/lua`.
- Demonstrates: one `game.spec.ts` feeding both the DevBridge config (runtime path) and `exportGame` (deploy path), with a node `smoke.ts` that asserts both.

- [ ] **Step 1: Write the spec, logic, dev config**

```ts
// examples/spec-slot/game.spec.ts
import { defineGame, type GameSpec } from '@energy8platform/platform-core/game-spec';

export const spec: GameSpec = {
  id: 'spec-slot',
  type: 'slot',
  grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 0.5, 1, 2, 5],
  defaultBet: 1,
  maxWin: 1000,
  currency: 'EUR',
  symbols: [
    { id: 'A', name: 'Diamond', kind: 'high', pay: { 3: 10 } },
    { id: 'B', name: 'Bell', kind: 'high', pay: { 3: 5 } },
    { id: 'C', name: 'Cherry', kind: 'low', pay: { 3: 2 } },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
    { id: 'SCATTER', name: 'Scatter', kind: 'scatter' },
  ],
  actions: {
    spin: { role: 'base' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 50, feature: { spins: 8 } },
  },
};

export const model = defineGame(spec);
```

```lua
-- examples/spec-slot/script.logic.lua
-- Minimal demo logic; reads PAYTABLE/SYM from the generated prelude.
-- Reel weights would live here in a real game.
function execute(state)
  local a = engine.random(1, 3)
  local win = 0
  if a == 1 then win = state.bet * PAYTABLE["A"][3] end
  return {
    total_win = win,
    matrix = {
      { SYM.A, SYM.B, SYM.C },
      { SYM.B, SYM.C, SYM.A },
      { SYM.C, SYM.A, SYM.B },
    },
  }
end
```

```ts
// examples/spec-slot/dev.config.ts
// Runtime path: the DevBridge gets gameDefinition + (prelude + logic) from the model.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './game.spec';

const logic = readFileSync(resolve(__dirname, 'script.logic.lua'), 'utf8');

export default {
  balance: 1000,
  currency: model.spec.currency ?? 'EUR',
  networkDelay: 80,
  debug: true,
  gameDefinition: model.gameDefinition,
  luaScript: buildLuaScript(model, logic),
  luaSeed: 12345,
};
```

- [ ] **Step 2: Write the smoke harness**

```ts
// examples/spec-slot/smoke.ts
// Proves: one spec drives BOTH the runtime LuaEngine path and the export path.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportGame, buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { LuaEngine } from '@energy8platform/platform-core/lua';
import { spec, model } from './game.spec';

const logic = readFileSync(resolve(__dirname, 'script.logic.lua'), 'utf8');

// 1) runtime path
const engine = new LuaEngine({
  script: buildLuaScript(model, logic),
  gameDefinition: model.gameDefinition,
  seed: 7,
});
const result = engine.execute({ action: 'spin', bet: 1 });
engine.destroy();
if (typeof result.totalWin !== 'number') throw new Error('spin did not return a numeric win');
console.log('runtime spin OK — totalWin =', result.totalWin);

// 2) export path
const out = exportGame(spec, { logicLua: logic });
const distDir = resolve(__dirname, 'dist', 'game');
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, 'gameDefinition.json'), out['gameDefinition.json']);
writeFileSync(resolve(distDir, 'script.lua'), out['script.lua']);
const gd = JSON.parse(out['gameDefinition.json']);
if (gd.id !== 'spec-slot' || gd.type !== 'SLOT') throw new Error('exported gameDefinition malformed');
if (!out['script.lua'].includes('PAYTABLE')) throw new Error('exported script.lua missing prelude');
console.log('export OK — wrote dist/game/{gameDefinition.json, script.lua}');
console.log('SMOKE PASS');
```

```json
// examples/spec-slot/package.json
{
  "name": "spec-slot-example",
  "private": true,
  "type": "module",
  "scripts": {
    "smoke": "tsx smoke.ts"
  },
  "dependencies": {
    "@energy8platform/platform-core": "*"
  },
  "devDependencies": {
    "tsx": "^4.21.0",
    "typescript": "^5.6.0"
  }
}
```

```json
// examples/spec-slot/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: Build platform-core so the example resolves the package**

Run: `npm run build --workspace @energy8platform/platform-core`
Expected: `dist/game-spec.*` present (the example imports the built sub-path).

- [ ] **Step 4: Run the example smoke**

Run: `npm run smoke --workspace spec-slot-example`
Expected output ends with:
```
runtime spin OK — totalWin = <number>
export OK — wrote dist/game/{gameDefinition.json, script.lua}
SMOKE PASS
```
(If the workspace name isn't picked up, run `cd examples/spec-slot && npx tsx smoke.ts` after `npm install`.)

- [ ] **Step 5: Verify the exported script.lua is self-contained**

Run: `head -20 examples/spec-slot/dist/game/script.lua`
Expected: starts with `-- AUTO-GENERATED from game.spec.ts` and contains `PAYTABLE`, followed later by `function execute`.

- [ ] **Step 6: Add a .gitignore for the example dist and commit**

```bash
printf 'dist/\nnode_modules/\n' > examples/spec-slot/.gitignore
git add examples/spec-slot
git commit -m "docs(examples): spec-slot — defineGame end-to-end (runtime + export)"
```

---

## Self-Review

**Spec coverage:**
- Sub-package game-spec (types/validate/derive/defineGame/export) → Tasks 1–4. ✓
- Re-export from game-engine → Task 1 Steps 6–7. ✓
- Runtime-derivation, zero files → `defineGame` returns in-memory model (Task 3); used by example dev.config (Task 6). ✓
- Deploy artifacts (gameDefinition.json + self-contained script.lua) via one concatenation rule → `buildLuaScript`/`exportGame` (Task 4), reused at runtime (Task 5/6). ✓
- spec owns structure, weights in logic.lua → prelude emits only structural constants; example logic comment notes weights live there. ✓
- Convention transitions with override → `defaultTransitions` + `ActionSpec.transitions` (Task 2). ✓
- Validation catches drift → Task 1 tests (dup ids, cost≤0, bet order, maxWin, pay, bad next_actions). ✓
- Renderer-free tests, LuaEngine integration → Task 5. ✓
- Greenfield example proving spec feeds DevBridge + export → Task 6. ✓
- Out-of-scope items (createSlotGame, stake-kit, math-CLI, cascade primitives, CLI, migrations) → not present. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; commands have expected output. ✓

**Type consistency:** `GameSpec`/`SymbolSpec`/`ActionSpec`/`GameModel`/`MathModeSpec`/`PaytableView` defined in Task 1 and used unchanged in Tasks 2–6. Deriver names (`toGameDefinition`/`toLuaPrelude`/`toModeMap`/`toMathModes`/`toPaytableView`) consistent across derive.ts, index exports, defineGame, and tests. `buildLuaScript`/`exportGame` signatures match between export.ts, integration, and example. ✓

**Open risk flagged in spec:** exact GameDefinition shape — addressed by reusing `src/lua/types.ts` verbatim and asserting `type:'SLOT'`/`max_win.multiplier` against the real interface read during planning.
