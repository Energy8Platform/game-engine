# Slot Spec-Modes SSOT + Scaffold Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make `game.spec.ts` the single source of truth for game modes (shell buy cards + ante toggle derive from it), read shell currency/language from `initData`, expose loading/sdk config, add a reusable IntroScene, and add an automatable boot-check.

**Architecture:** add a `feature` role to the spec (ante = paid spin) carrying `title`/`description`; the host's `buildShellConfig` derives `BonusOption[]` (buy→card, feature→ante toggle) and currency from the model + runtime `initData` instead of hardcoded options; the generated `main.ts` stops hardcoding shell config; a reusable `IntroScene` primitive + an `intro` host option give an Intro→Game flow; a static browser-import guard + a node DevBridge↔SDK handshake test cover the boot path.

**Tech Stack:** TypeScript, Vitest 2.x (node), the four `@energy8platform/*` packages, Pixi v8 (IntroScene).

## Global Constraints

- Mode roles: `ActionRole = 'base' | 'feature' | 'buy' | 'free'`. `feature` (= ante) is a **paid base-game spin** — derives like `base` (`debit:'bet'`, `credit:'win'`, `cost > 1`, base transitions incl. free-spin award); it is NOT a session. `buy` purchases free spins (`credit:'none'`, `creates_session`) — unchanged. `free` = the session spins.
- Spec is SSOT incl. display: each `buy`/`feature` action carries `title` + `description`; the shell derives cards/toggle from them. The generated `main.ts` hardcodes NO shell `buyBonus`/`currency`.
- Shell already supports both presentations via `BonusOption.type` (`'bonus'` = buy card, `'feature'` = ante toggle) — NO shell changes.
- Currency: `PlatformSession.currency` is a **code** (e.g. `'EUR'`); map code→`CurrencyConfig` (`{symbol, position}`); fallback `spec.currency` then `{symbol:'€',position:'left'}`.
- `platform-core` stays renderer-free (no pixi/game-engine). Primitives/helpers headless + unit-tested where pure; Pixi scenes verified by typecheck + the example.
- Commit after each task. Branch `feat/game-spec-define-game`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Out of scope: `#6` math-CLI/Go-sim; gameInfo-paytable-from-spec (deferred); i18n of card text; true browser+Pixi boot auto-verification (Pixi hangs headless — manual `npm run dev`).

## File Structure

```
packages/platform-core/src/game-spec/types.ts        ActionRole += 'feature'; ActionSpec += title/description
packages/platform-core/tests/feature-role.test.ts    (new) feature derives like base
packages/platform-core/tests/boot-handshake.test.ts  (new) DevBridge↔SDK handshake
packages/game-engine/src/host/shellConfig.ts          toBonusOptions, currencyConfigFromCode, buildShellConfig(runtime)
packages/game-engine/tests/host/shellConfig.test.ts   (extend)
packages/game-engine/src/host/{createSlotGame.ts,buildConfig.ts,types.ts}  runtime ctx, loading default, intro option
packages/game-engine/src/scenes/IntroScene.ts         (new) reusable intro primitive
packages/game-engine/src/core/index.ts (or scenes index) export IntroScene
packages/create-slot/src/codegen/{gameSpec.ts,mainTs.ts}  feature action+titles; drop hardcoded shell, add intro
packages/create-slot/test/{gameSpec.test.ts,mainTs?,generate.test.ts}  asserts + node:-import guard
examples/spec-slot/{game.spec.ts,main.ts}             living proof: ante action, derived shell, intro
```

---

## Task 1: game-spec — `feature` role + display fields

**Files:**
- Modify: `packages/platform-core/src/game-spec/types.ts`
- Test: `packages/platform-core/tests/feature-role.test.ts`

**Interfaces:**
- Produces: `ActionRole` includes `'feature'`; `ActionSpec.title?`, `ActionSpec.description?`. `feature` derives via the existing base-like branch in `derive.ts` (no derive change).

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/feature-role.test.ts
import { describe, it, expect } from 'vitest';
import { toGameDefinition, toModeMap, toMathModes } from '../src/game-spec/derive';
import type { GameSpec } from '../src/game-spec/types';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 6, rows: 6 }, betLevels: [1], maxWin: 1000,
  symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }],
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY', description: 'Buy spins', feature: { spins: 10 } },
  },
};

describe('feature role (ante = paid spin)', () => {
  it('derives like base: debit bet, credit win, its own cost_multiplier, no session', () => {
    const def = toGameDefinition(spec);
    const ante = def.actions.ante;
    expect(ante.debit).toBe('bet');
    expect(ante.credit).toBe('win');
    expect(ante.cost_multiplier).toBe(1.5);
    expect(ante.stage).toBe('base_game');
    // base-like transitions: can award free spins, plus an always-fallback
    expect(ante.transitions.some((t) => t.condition === 'always')).toBe(true);
  });
  it('buy stays a session purchase (credit none)', () => {
    expect(toGameDefinition(spec).actions.buy_bonus.credit).toBe('none');
  });
  it('feature + buy both appear in modeMap and mathModes (free excluded)', () => {
    expect(toModeMap(spec)).toMatchObject({ spin: 'SPIN', ante: 'ANTE', buy_bonus: 'BUY_BONUS' });
    expect(toModeMap(spec).free_spin).toBeUndefined();
    const modes = toMathModes(spec).map((m) => m.action);
    expect(modes).toEqual(expect.arrayContaining(['spin', 'ante', 'buy_bonus']));
    expect(modes).not.toContain('free_spin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/feature-role.test.ts`
Expected: FAIL — TS error: `'feature'` not assignable to `ActionRole` (type rejects the spec).

- [ ] **Step 3: Add `'feature'` + display fields to `types.ts`**

In `packages/platform-core/src/game-spec/types.ts`:
- Change `export type ActionRole = 'base' | 'free' | 'buy';` → `export type ActionRole = 'base' | 'feature' | 'buy' | 'free';`
- In `ActionSpec`, after `feature?: Record<string, unknown>;` add:
```ts
  /** Shell display for buy/feature actions (SSOT). */
  title?: string;
  description?: string;
```

(No `derive.ts` change: `toActionDefinition`'s non-`free` branch already yields `credit: role==='buy'?'none':'win'` — so `feature`→`'win'` — and `defaultTransitions` treats non-`free` roles as base-like; `defaultStage('feature')`→`'base_game'`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/feature-role.test.ts`
Expected: PASS.
Run: `npx vitest run packages/platform-core/tests/`
Expected: PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/game-spec/types.ts packages/platform-core/tests/feature-role.test.ts
git commit -m "feat(game-spec): feature role (ante = paid spin) + action title/description"
```

---

## Task 2: host — derive `BonusOption[]` + currency in `buildShellConfig`

**Files:**
- Modify: `packages/game-engine/src/host/shellConfig.ts`
- Test: `packages/game-engine/tests/host/shellConfig.test.ts`

**Interfaces:**
- Consumes: `feature`/`buy` actions + `title`/`description` (Task 1).
- Produces: `toBonusOptions(model): BonusOption[]`; `currencyConfigFromCode(code): CurrencyConfig`; `buildShellConfig(opts, model, runtime: ShellRuntime): ShellConfig` where `ShellRuntime = { balance: number; currency?: string; language?: string; mode: ShellMode }`. `SlotShellOptions.currency`/`gameInfo` become optional overrides.

- [ ] **Step 1: Write the failing test** (extend `shellConfig.test.ts`)

```ts
// packages/game-engine/tests/host/shellConfig.test.ts  (add these; keep existing if compatible)
import { describe, it, expect } from 'vitest';
import { buildShellConfig, toBonusOptions, currencyConfigFromCode } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = {
  spec: {
    betLevels: [0.1, 1, 5], defaultBet: 1, currency: 'EUR',
    actions: {
      spin: { role: 'base' },
      ante: { role: 'feature', cost: 1.5, title: 'ANTE', description: 'boost' },
      free_spin: { role: 'free' },
      buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins' },
    },
  },
} as unknown as GameModel;

describe('toBonusOptions', () => {
  it('maps buy→bonus card and feature→ante toggle, from the spec', () => {
    const opts = toBonusOptions(model);
    expect(opts).toEqual([
      { id: 'ante', type: 'feature', title: 'ANTE', description: 'boost', priceMultiplier: 1.5 },
      { id: 'buy_bonus', type: 'bonus', title: 'BUY BONUS', description: 'buy spins', priceMultiplier: 100 },
    ]);
  });
});

describe('currencyConfigFromCode', () => {
  it('maps known codes to a symbol, defaults position left, falls back to the code', () => {
    expect(currencyConfigFromCode('EUR')).toEqual({ symbol: '€', position: 'left' });
    expect(currencyConfigFromCode('USD')).toEqual({ symbol: '$', position: 'left' });
    expect(currencyConfigFromCode('ZZZ')).toEqual({ symbol: 'ZZZ', position: 'left' });
  });
});

describe('buildShellConfig (runtime ctx)', () => {
  it('derives currency from runtime, buyBonus from the model', () => {
    const c = buildShellConfig({}, model, { balance: 1000, currency: 'USD', language: 'de', mode: 'base' });
    expect(c.currency).toEqual({ symbol: '$', position: 'left' });
    expect(c.language).toBe('de');
    expect(c.balance).toBe(1000);
    expect(c.features.buyBonus).toEqual(toBonusOptions(model));
  });
  it('falls back to spec.currency then neutral; opts.currency overrides', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).currency).toEqual({ symbol: '€', position: 'left' });
    const o = buildShellConfig({ currency: { symbol: '₿', position: 'right' } }, model, { balance: 0, mode: 'base' });
    expect(o.currency).toEqual({ symbol: '₿', position: 'right' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/shellConfig.test.ts`
Expected: FAIL — `toBonusOptions`/`currencyConfigFromCode` not exported; `buildShellConfig` old signature.

- [ ] **Step 3: Rewrite `shellConfig.ts`**

```ts
// packages/game-engine/src/host/shellConfig.ts
import type {
  ShellConfig, ShellMode, CurrencyConfig, GameInfoContent, BonusOption, ShellFeatures,
} from '@energy8platform/platform-core/shell';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { WinTier } from '../slot';

export interface SlotShellOptions {
  mount?: HTMLElement;
  /** Override the derived currency (normally taken from initData). */
  currency?: CurrencyConfig;
  /** Extra info sections (merged on top of any derived ones). */
  gameInfo?: GameInfoContent;
  /** Override the derived buy/ante options. */
  buyBonus?: BonusOption[];
  tiers?: WinTier[];
  features?: Partial<ShellFeatures>;
}

/** Runtime context from the SDK handshake (initData) + the resolved mode. */
export interface ShellRuntime {
  balance: number;
  currency?: string;   // currency CODE from initData (e.g. 'EUR')
  language?: string;
  mode: ShellMode;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', JPY: '¥', BRL: 'R$', CAD: '$', AUD: '$', INR: '₹',
};

/** Map a currency code to a shell CurrencyConfig (symbol left, code as the fallback symbol). */
export function currencyConfigFromCode(code: string): CurrencyConfig {
  return { symbol: CURRENCY_SYMBOL[code] ?? code, position: 'left' };
}

/** Derive shell buy cards + ante toggles from the spec's buy/feature actions (SSOT). */
export function toBonusOptions(model: GameModel): BonusOption[] {
  const out: BonusOption[] = [];
  for (const [key, action] of Object.entries(model.spec.actions)) {
    const role = action.role ?? 'base';
    if (role !== 'buy' && role !== 'feature') continue;
    out.push({
      id: key,
      type: role === 'buy' ? 'bonus' : 'feature',
      title: action.title ?? key.replace(/_/g, ' ').toUpperCase(),
      description: action.description ?? '',
      priceMultiplier: action.cost ?? (role === 'buy' ? 100 : 1),
    });
  }
  return out;
}

/** Pure: assemble a ShellConfig from the model + runtime context (currency/balance/language/mode). */
export function buildShellConfig(opts: SlotShellOptions, model: GameModel, runtime: ShellRuntime): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  const code = runtime.currency ?? model.spec.currency;
  const currency = opts.currency ?? (code ? currencyConfigFromCode(code) : { symbol: '€', position: 'left' });
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: runtime.language ?? 'en',
    currency,
    gameInfo: opts.gameInfo ?? { sections: [] },
    availableBets: [...betLevels],
    defaultBet,
    currentBet: defaultBet,
    balance: runtime.balance,
    win: 0,
    mode: runtime.mode,
    features: {
      turbo: 0,
      spacebar: true,
      autoplay: {},
      buyBonus: opts.buyBonus ?? toBonusOptions(model),
      ...(opts.features ?? {}),
    } as ShellFeatures,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/host/shellConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/shellConfig.ts packages/game-engine/tests/host/shellConfig.test.ts
git commit -m "feat(game-engine): shell derives buyBonus + currency from spec/initData (SSOT)"
```

---

## Task 3: host — wire runtime context + loading default into `createSlotGame`

**Files:**
- Modify: `packages/game-engine/src/host/createSlotGame.ts`, `packages/game-engine/src/host/buildConfig.ts`
- No new unit test (Pixi/DOM); verified by typecheck + Task 2 tests + Task 7 proof.

**Interfaces:**
- Consumes: `buildShellConfig(opts, model, runtime)` (Task 2).
- Produces: `createSlotGame` builds `ShellRuntime` from `game.platformSession`/`initData`; `buildAppConfig` defaults `loading`.

- [ ] **Step 1: Update the shell-wiring call in `createSlotGame.ts`**

Find the shell block. Replace the `balance` line + the `buildShellConfig(...)` call:
```ts
    // BEFORE:
    const balance = (game.initData?.balance as number | undefined) ?? 0;
    ...
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, balance, mode));
```
with:
```ts
    const balance = (game.initData?.balance as number | undefined) ?? 0;
    const runtime = {
      balance,
      currency: game.platformSession?.currency,        // code from the SDK handshake
      language: (game.initData as { language?: string } | null)?.language,
      mode,
    };
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, runtime));
```
(`game.platformSession.currency` is a getter returning the SDK currency code; `mode` is the existing `'base'|'replay'` value.)

- [ ] **Step 2: Default `loading` in `buildConfig.ts`**

In `packages/game-engine/src/host/buildConfig.ts`, change the `loading` line:
```ts
    loading: opts.loading ?? { title: opts.model?.spec?.id ?? 'Loading', minDurationMs: 600 },
```
(If `LoadingScreenConfig` lacks `title`/`minDurationMs`, read the type and use its real fields with sensible defaults; keep it a non-null object so a scaffolded game shows a real loading screen. `opts.model` is on `CreateSlotGameOptions`.)

- [ ] **Step 3: Typecheck + host tests**

Run: `npm run build --workspace @energy8platform/platform-core`
Run: `npm run typecheck --workspace @energy8platform/game-engine`
Expected: clean.
Run: `npx vitest run packages/game-engine/tests/host/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/game-engine/src/host/createSlotGame.ts packages/game-engine/src/host/buildConfig.ts
git commit -m "feat(game-engine): createSlotGame feeds initData currency/language to the shell + loading default"
```

---

## Task 4: host — reusable `IntroScene` + `intro` option (Intro→Game)

**Files:**
- Create: `packages/game-engine/src/scenes/IntroScene.ts`
- Modify: `packages/game-engine/src/host/types.ts` (`intro?`), `packages/game-engine/src/host/createSlotGame.ts` (register + start), `packages/game-engine/src/core/index.ts` (export IntroScene + config)
- No new unit test (Pixi); verified by typecheck + Task 7 proof.

**Interfaces:**
- Produces: `IntroScene`, `IntroSceneConfig = { title?: string; logo?: string; tapToStart?: boolean; onStart: () => void }`; `CreateSlotGameOptions.intro?: Omit<IntroSceneConfig,'onStart'>`.

- [ ] **Step 1: Write `IntroScene.ts`**

```ts
// packages/game-engine/src/scenes/IntroScene.ts
import { Container, Graphics, Text } from 'pixi.js';
import { Scene } from '../core';

export interface IntroSceneConfig {
  title?: string;
  logo?: string;          // texture alias (optional; title text is the default)
  tapToStart?: boolean;   // default true
  /** Host wires this to scenes.goto(gameKey). */
  onStart: () => void;
}

/** Reusable splash scene: shows a title (or logo) + "tap to start", then calls onStart. */
export class IntroScene extends Scene {
  private layer?: Container;

  async onEnter(data?: unknown): Promise<void> {
    const cfg = (data ?? {}) as IntroSceneConfig;
    const layer = new Container();
    this.layer = layer;
    this.container.addChild(layer);

    const title = new Text({
      text: cfg.title ?? 'PLAY',
      style: { fill: 0xffffff, fontSize: 96, fontFamily: 'Inter', align: 'center' },
    });
    title.anchor.set(0.5);
    title.position.set(960, 460);
    layer.addChild(title);

    if (cfg.tapToStart !== false) {
      const hint = new Text({
        text: 'Tap to start',
        style: { fill: 0xffd24a, fontSize: 36, fontFamily: 'Inter' },
      });
      hint.anchor.set(0.5);
      hint.position.set(960, 600);
      layer.addChild(hint);
    }

    // full-screen tap target
    const hit = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0.001 });
    hit.eventMode = 'static';
    hit.cursor = 'pointer';
    hit.once('pointerdown', () => cfg.onStart?.());
    layer.addChild(hit);
  }

  onExit(): void {
    this.layer?.destroy({ children: true });
    this.layer = undefined;
  }
}
```

- [ ] **Step 2: Export it**

In `packages/game-engine/src/core/index.ts` append:
```ts
export { IntroScene } from '../scenes/IntroScene';
export type { IntroSceneConfig } from '../scenes/IntroScene';
```
(If `core/index.ts` only re-exports `core/*`, instead add a `src/scenes/index.ts` exporting both and re-export it from the package's `/core` entry — follow whichever pattern the package uses for sub-path exports; verify `@energy8platform/game-engine/core` resolves `IntroScene`.)

- [ ] **Step 3: Add the `intro` option + wiring**

In `packages/game-engine/src/host/types.ts`, add to `CreateSlotGameOptions`:
```ts
  /** When set, an IntroScene is shown first and transitions to the game scene on tap. */
  intro?: { title?: string; logo?: string; tapToStart?: boolean };
```
In `packages/game-engine/src/host/createSlotGame.ts`, replace the scene-registration + start:
```ts
  // BEFORE:
  game.scenes.register(opts.scene.key, opts.scene.scene);
  try { await game.start(opts.scene.key); } catch (err) { ... }
```
with:
```ts
  game.scenes.register(opts.scene.key, opts.scene.scene);
  let firstScene = opts.scene.key;
  if (opts.intro) {
    const { IntroScene } = await import('../scenes/IntroScene');
    game.scenes.register('__intro__', IntroScene);
    firstScene = '__intro__';
  }
  try {
    await game.start(firstScene, opts.intro ? { ...opts.intro, onStart: () => { void game.scenes.goto(opts.scene.key); } } : undefined);
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }
```
(`game.start(firstScene, data)` passes `data` to the first scene's `onEnter` — IntroScene receives the config incl. `onStart`.)

- [ ] **Step 4: Build + typecheck**

Run: `npm run build --workspace @energy8platform/platform-core && npm run typecheck --workspace @energy8platform/game-engine`
Expected: clean. (IntroScene compiles against pixi; the lazy `import('../scenes/IntroScene')` keeps it out of the host's eager bundle.)
Run: `npm run build --workspace @energy8platform/game-engine`
Expected: builds; `IntroScene` present in the `/core` (or `/scenes`) bundle's `.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/scenes/IntroScene.ts packages/game-engine/src/core/index.ts \
        packages/game-engine/src/host/types.ts packages/game-engine/src/host/createSlotGame.ts
git commit -m "feat(game-engine): reusable IntroScene + createSlotGame intro option (Intro→Game)"
```

---

## Task 5: codegen — spec emits a `feature` (ante) action; main.ts drops hardcoded shell, adds intro

**Files:**
- Modify: `packages/create-slot/src/codegen/gameSpec.ts`, `packages/create-slot/src/codegen/mainTs.ts`
- Test: `packages/create-slot/test/gameSpec.test.ts`, `packages/create-slot/test/stakeAdapter.test.ts` (the `genMainTs` test lives there)

**Interfaces:**
- Consumes: `feature` role + display (Task 1), derived shell (Tasks 2–3), `intro` option (Task 4).
- Produces: generated `game.spec.ts` includes an `ante` (`role:'feature'`) action + titles on buy/feature; generated `main.ts` passes `shell: {}` + `intro` and no hardcoded buyBonus/currency/gameInfo.

- [ ] **Step 1: Update `gameSpec.test.ts`**

Add to `packages/create-slot/test/gameSpec.test.ts`:
```ts
it('emits an ante (feature) action and titles on buy/feature', () => {
  const src = genGameSpec({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  expect(src).toContain("ante: { role: 'feature'");
  expect(src).toContain("title: 'ANTE BET'");
  expect(src).toContain("buy_bonus: { role: 'buy'");
  expect(src).toContain("title: 'BUY BONUS'");
});
```

- [ ] **Step 2: Update the `genMainTs` test** (in `packages/create-slot/test/stakeAdapter.test.ts`)

Replace the `genMainTs` assertions with:
```ts
describe('genMainTs', () => {
  it('enables the shell without hardcoding buyBonus/currency, and passes intro', () => {
    const m = genMainTs(a);
    expect(m).toContain('createSlotGame');
    expect(m).toContain('shell: {}');
    expect(m).toContain('intro:');
    expect(m).not.toContain('buyBonus');     // derived from spec now
    expect(m).not.toContain("symbol: '€'");  // currency from initData now
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/stakeAdapter.test.ts`
Expected: FAIL — old codegen lacks the ante action and still hardcodes the shell.

- [ ] **Step 4: Update `gameSpec.ts` codegen**

In `packages/create-slot/src/codegen/gameSpec.ts`, change the `actions` block to:
```ts
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Pay more for a boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'Buy the feature', feature: { spins: 10 } },
  },
```

- [ ] **Step 5: Update `mainTs.ts` codegen**

In `packages/create-slot/src/codegen/mainTs.ts`, replace the `shell: { ... }` block with `shell: {}` and add `intro`:
```ts
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';
import { normalize } from './game/normalize';
${stakeImport}
createSlotGame({
  model,
  normalize,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
  intro: { title: '${a.title}' },
${stakeOpt}  shell: {}, // buy/ante cards + currency derive from the spec + initData
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
```

- [ ] **Step 6: Run tests + commit**

Run: `npx vitest run packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/stakeAdapter.test.ts`
Expected: PASS.
```bash
git add packages/create-slot/src/codegen/gameSpec.ts packages/create-slot/src/codegen/mainTs.ts \
        packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/stakeAdapter.test.ts
git commit -m "feat(create-slot): scaffold spec emits ante (feature) action; main.ts derives shell + intro"
```

---

## Task 6: boot-check — static browser-import guard + node DevBridge↔SDK handshake

**Files:**
- Modify: `packages/create-slot/test/generate.test.ts` (static guard)
- Create: `packages/platform-core/tests/boot-handshake.test.ts` (handshake)

**Interfaces:**
- Consumes: `defineGame`/`buildLuaScript` (game-spec), `createPlatformSession` (platform-core).

- [ ] **Step 1: Extend the static browser-import guard** (in `generate.test.ts`, cascade/cluster case)

After the existing `dev.config.ts` assertion, add:
```ts
    for (const f of ['dev.config.ts', 'vite.config.ts', 'src/main.ts']) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, `${f} must be browser-safe`).not.toMatch(/from '\s*node:/);
    }
```

- [ ] **Step 2: Write the handshake test** (proves the boot chain in node, renderer-free)

```ts
// packages/platform-core/tests/boot-handshake.test.ts
import { describe, it, expect } from 'vitest';
import { defineGame } from '../src/game-spec';
import { buildLuaScript } from '../src/game-spec';
import { createPlatformSession } from '../src';

const model = defineGame({
  id: 'boot', type: 'slot', grid: { cols: 6, rows: 6 }, betLevels: [1], defaultBet: 1, maxWin: 1000, currency: 'EUR',
  symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' } },
});
const logic = `function execute(state)\n  return { total_win = 0, cascades = {} }\nend\n`;

describe('boot handshake (DevBridge ↔ SDK, renderer-free)', () => {
  it('createPlatformSession(dev) reaches initData and a spin returns a result', async () => {
    const session = await createPlatformSession({
      dev: { balance: 1000, currency: 'EUR', gameDefinition: model.gameDefinition, luaScript: buildLuaScript(model, logic), luaSeed: 1 },
      sdk: { devMode: true },
    });
    expect(session.initData).toBeTruthy();
    const result = await session.play({ action: 'spin', bet: 1 });
    expect(typeof result.totalWin).toBe('number');
    session.destroy?.();
  });
});
```
(Verify the exact `createPlatformSession` dev-config field names against `PlatformSession.ts` / `DevBridge` — the doc comment at `PlatformSession.ts:60` shows `dev: { luaScript, gameDefinition, balance, currency }`. Adjust `play`/`destroy` to the real `PlatformSession` API if names differ; the assertion is: handshake yields `initData` and a spin returns a numeric `totalWin`.)

- [ ] **Step 3: Run both**

Run: `npx vitest run packages/platform-core/tests/boot-handshake.test.ts`
Expected: PASS — handshake completes, spin returns `{ totalWin: 0, ... }`.
Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/game-engine`
Run: `npx vitest run packages/create-slot/test/`
Expected: PASS — full create-slot suite incl. the extended static guard + the scaffold smoke.

- [ ] **Step 4: Commit**

```bash
git add packages/platform-core/tests/boot-handshake.test.ts packages/create-slot/test/generate.test.ts
git commit -m "test: boot-check — node DevBridge↔SDK handshake + generated browser-import guard"
```

---

## Task 7: living proof — `spec-slot` adopts the spec-derived shell + ante + intro

**Files:**
- Modify: `examples/spec-slot/game.spec.ts` (add an `ante` feature action + titles), `examples/spec-slot/main.ts` (drop hardcoded shell, add intro)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add an `ante` action + titles to `examples/spec-slot/game.spec.ts`**

In the spec's `actions`, ensure (add `ante`, add titles to `buy_*`):
```ts
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'Buy the feature', feature: { spins: 10 } },
  },
```
(If `spec-slot` has different action keys, keep them but add `title`/`description` to its buy action and add one `feature` action.)

- [ ] **Step 2: Update `examples/spec-slot/main.ts`**

Replace the hardcoded `shell: { currency, gameInfo, buyBonus }` with `shell: {}` and add `intro`:
```ts
  intro: { title: 'Spec Slot' },
  shell: {}, // buy/ante cards + currency derive from the spec + initData
```
Keep `model`, `normalize`, `scene`, `manifest`, `design`, `fonts`, `textureDefaults`, `dev`, `stake` (if present) unchanged.

- [ ] **Step 3: Build deps + typecheck + smoke**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: clean — proves the shell-derive + intro + ante compose against the real types.
Run: `npm run smoke --workspace spec-slot-example`
Expected: `SMOKE PASS`.

- [ ] **Step 4: Commit**

```bash
git add examples/spec-slot/game.spec.ts examples/spec-slot/main.ts
git commit -m "docs(examples): spec-slot derives shell from spec + ante action + intro"
```

---

## Self-Review

**Spec coverage:** #7 modes SSOT → Task 1 (feature role + display) + Task 2 (toBonusOptions derivation). #2 ante → absorbed (Task 1 feature role; Task 5 emits it; Task 7 proves it). #3 currency from initData → Tasks 2 (currencyConfigFromCode + runtime) + 3 (createSlotGame feeds it). #5 loading/sdk config → Task 3 (loading default) + Task 5 (main.ts is explicit). #8 IntroScene → Task 4 + Tasks 5/7 (wired/proved). boot-check → Task 6. ✓ Deferred (noted in Global Constraints): #6 math-CLI; gameInfo-paytable-from-spec; i18n.

**Placeholder scan:** Two steps say "verify the exact type/field against the file" (LoadingScreenConfig fields in Task 3; createPlatformSession dev-config + PlatformSession.play/destroy names in Task 6; the `/core` vs `/scenes` export pattern in Task 4) — these are real "read the sibling and match" instructions with the intent + a concrete fallback given, not vague TODOs. No "add error handling"/"TBD".

**Type consistency:** `ActionRole` 'feature' (Task 1) consumed by `toBonusOptions` (Task 2) and codegen (Task 5). `buildShellConfig(opts, model, runtime: ShellRuntime)` signature identical across Task 2 (def) and Task 3 (call). `toBonusOptions`/`currencyConfigFromCode` names match across Task 2 + tests. `IntroSceneConfig`/`intro` option (Task 4) consumed by codegen (Task 5) + spec-slot (Task 7). `createPlatformSession({ dev, sdk })` (Task 6) matches `PlatformSession.ts`. `BonusOption.type` `'bonus'|'feature'` matches the shell type. ✓
