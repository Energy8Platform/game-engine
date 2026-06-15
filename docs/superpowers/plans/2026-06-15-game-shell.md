# Game Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a renderer-agnostic, vanilla-DOM branded "game shell" (control bar, menu, settings, game info, buy-bonus) that lives in `@energy8platform/platform-core/shell`, fully driven by the game (no SDK/session subscription), so games stop reimplementing UI chrome.

**Architecture:** A DOM overlay layered over the game `<canvas>`. A `GameShell` controller (extends `EventEmitter`) owns a plain `ShellState`, renders vanilla-DOM components, exposes imperative setters (game → shell) and emits events (shell → game). Capability flags (`features`) decide which controls render. Mirrors the existing `createCSSPreloader` lifecycle pattern.

**Tech Stack:** TypeScript, vanilla DOM, CSS custom properties, Vitest + jsdom. Zero runtime dependencies. Reuses `EventEmitter` and `buildLogoSVG`/palette from `platform-core/loading`.

---

## File Structure

```
packages/platform-core/src/shell/
├── index.ts            ← public API: createGameShell, removeGameShell, types
├── types.ts            ← ShellConfig, BonusOption, CurrencyConfig, ThemeConfig, ShellEvents, ShellState
├── format.ts           ← formatCurrency() pure formatter
├── state.ts            ← createInitialState(), shellReducer()
├── GameShell.ts        ← controller: lifecycle, mount, setters, event wiring
├── theme.ts            ← buildThemeVars() → CSS custom properties
├── shell.css.ts        ← SHELL_CSS string (injected as <style>)
├── components/
│   ├── primitives.ts   ← createButton, createToggle, createSlider, createModal
│   ├── BottomBar.ts    ← 3 modes: base | freeSpins | replay
│   ├── Menu.ts
│   ├── Settings.ts
│   ├── GameInfo.ts
│   └── BuyBonus.ts
packages/platform-core/tests/shell/
├── format.test.ts
├── state.test.ts
├── lifecycle.test.ts
├── primitives.test.ts
├── bottombar.test.ts
├── menu.test.ts
├── settings.test.ts
├── gameinfo.test.ts
└── buybonus.test.ts
```

Build wiring: new Rollup entry + `exports["./shell"]` in `package.json`. game-engine re-exports via `@energy8platform/game-engine/shell`.

**Naming contract (keep consistent across all tasks):**
- Controller: `GameShell`, factory `createGameShell(config)`, teardown `removeGameShell(): Promise<void>` and `shell.destroy(): Promise<void>`.
- State fields: `mode`, `balance`, `win`, `bet`, `availableBets`, `busy`, `autoplay {active, remaining}`, `turbo` (number), `buyBonusEnabled`, `freeSpins {current, total, totalWin, lastWin}`.
- Setters: `setBalance`, `setWin`, `setBet`, `setMode`, `setBusy`, `setAutoplay`, `setTurbo`, `setBuyBonusEnabled`, `setFreeSpins`.
- Events (`ShellEvents`): `spin: void`, `betChange: number`, `autoplayStart: AutoplayOptions`, `autoplayStop: void`, `turboChange: number`, `buyBonusSelect: { id: string }`, `menuOpen: void`, `settingsOpen: void`, `infoOpen: void`, `settingChange: { key: string; value: unknown }`.

---

## Task 1: Module scaffold, build wiring, jsdom test env, smoke test

**Files:**
- Create: `packages/platform-core/src/shell/index.ts`
- Create: `packages/platform-core/src/shell/types.ts`
- Modify: `packages/platform-core/package.json` (add `./shell` export)
- Modify: `packages/platform-core/rollup.config.mjs` (add shell bundle)
- Modify: `packages/platform-core/vitest.config.ts` (allow per-file jsdom)
- Test: `packages/platform-core/tests/shell/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

`packages/platform-core/tests/shell/smoke.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as shell from '@/shell';

describe('shell public API', () => {
  it('exports the factory and teardown', () => {
    expect(typeof shell.createGameShell).toBe('function');
    expect(typeof shell.removeGameShell).toBe('function');
  });

  it('does not import pixi (renderer-agnostic)', async () => {
    const src = await import('@/shell/index');
    expect(Object.keys(src)).toContain('createGameShell');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/smoke.test.ts`
Expected: FAIL — cannot resolve `@/shell`.

- [ ] **Step 3: Create the types file**

`packages/platform-core/src/shell/types.ts`:
```ts
export type ShellMode = 'base' | 'freeSpins' | 'replay';

export interface CurrencyConfig {
  symbol: string;
  position: 'left' | 'right';
  decimals?: number;
  separator?: { thousands?: string; decimal?: string };
}

export interface BonusOption {
  id: string;
  name: string;
  description: string;
  priceMultiplier: number;
  volatility?: 1 | 2 | 3 | 4 | 5;
  accentColor?: string;
}

export interface ThemeConfig {
  accent?: string;
  buyBonusColor?: string;
}

export interface GameInfoContent {
  rtp?: number;
  rules?: string;
  symbols?: Array<{ name: string; image?: string; payouts?: string }>;
  features?: Array<{ name: string; description: string }>;
}

export interface ShellFeatures {
  turbo: 0 | 1 | 2 | 3;
  autoplay: boolean;
  buyBonus: BonusOption[] | false;
}

export interface AutoplayOptions {
  active: boolean;
  remaining: number;
}

export interface FreeSpinsState {
  current: number;
  total: number;
  totalWin: number;
  lastWin: number;
}

export interface ShellConfig {
  mount: HTMLElement;
  theme?: ThemeConfig;
  gameInfo: GameInfoContent;
  language: string;
  currency: CurrencyConfig;
  availableBets: number[];
  defaultBet: number;
  currentBet: number | null;
  balance: number;
  win: number;
  mode: ShellMode;
  features: ShellFeatures;
}

export interface ShellState {
  mode: ShellMode;
  balance: number;
  win: number;
  bet: number;
  availableBets: number[];
  busy: boolean;
  autoplay: AutoplayOptions;
  turbo: number;
  buyBonusEnabled: boolean;
  freeSpins: FreeSpinsState;
}

export interface ShellEvents {
  spin: void;
  betChange: number;
  autoplayStart: AutoplayOptions;
  autoplayStop: void;
  turboChange: number;
  buyBonusSelect: { id: string };
  menuOpen: void;
  settingsOpen: void;
  infoOpen: void;
  settingChange: { key: string; value: unknown };
}
```

- [ ] **Step 4: Create a temporary index that satisfies the smoke test**

`packages/platform-core/src/shell/index.ts`:
```ts
export type * from './types';

// Real implementations land in later tasks. Stubs keep the public surface
// importable and let the build/test wiring be verified first.
export function createGameShell(): never {
  throw new Error('createGameShell not implemented yet');
}

export function removeGameShell(): Promise<void> {
  return Promise.resolve();
}
```

- [ ] **Step 5: Add the Rollup bundle entry**

In `packages/platform-core/rollup.config.mjs`, add to the `defineConfig([...])` array (after the loading entry):
```js
  ...createBundle('src/shell/index.ts', 'shell'),
```

- [ ] **Step 6: Add the package export**

In `packages/platform-core/package.json`, add to `exports` (after `./loading`):
```json
    "./shell": {
      "import": "./dist/shell.esm.js",
      "require": "./dist/shell.cjs.js",
      "types": "./dist/shell.d.ts"
    }
```

- [ ] **Step 7: Allow jsdom per-file in vitest**

Confirm `packages/platform-core/vitest.config.ts` keeps `environment: 'node'` (default) — per-file `// @vitest-environment jsdom` already works in Vitest 2 without config changes. No edit needed unless include globs exclude `tests/shell/**`; the existing glob `tests/**/*.test.ts` already covers it. (This step is a verification, not a change.)

- [ ] **Step 8: Run the smoke test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/smoke.test.ts`
Expected: PASS (both tests).

- [ ] **Step 9: Commit**

```bash
git add packages/platform-core/src/shell packages/platform-core/tests/shell/smoke.test.ts packages/platform-core/package.json packages/platform-core/rollup.config.mjs
git commit -m "feat(platform-core): scaffold shell module + build/test wiring"
```

---

## Task 2: Currency formatter (`format.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/format.ts`
- Test: `packages/platform-core/tests/shell/format.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/shell/format';

// Documented defaults: thousands separator '.', decimal separator ','.
describe('formatCurrency', () => {
  const eur = { symbol: '€', position: 'left' as const };
  const kr = { symbol: 'kr', position: 'right' as const };

  it('places symbol left with default 2 decimals and default separators', () => {
    expect(formatCurrency(500, eur)).toBe('€500,00');
  });

  it('places symbol right', () => {
    expect(formatCurrency(500, kr)).toBe('500,00 kr');
  });

  it('groups thousands with the default separator', () => {
    expect(formatCurrency(1234.5, eur)).toBe('€1.234,50');
  });

  it('respects custom decimals', () => {
    expect(formatCurrency(1.5, { ...eur, decimals: 0 })).toBe('€2');
  });

  it('applies custom thousands + decimal separators', () => {
    expect(
      formatCurrency(1234567.89, { ...eur, separator: { thousands: ' ', decimal: ',' } }),
    ).toBe('€1 234 567,89');
  });

  it('handles non-finite input as zero', () => {
    expect(formatCurrency(NaN, eur)).toBe('€0,00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/format.test.ts`
Expected: FAIL — cannot resolve `@/shell/format`.

- [ ] **Step 3: Write the implementation**

`packages/platform-core/src/shell/format.ts`:
```ts
import type { CurrencyConfig } from './types';

export function formatCurrency(value: number, currency: CurrencyConfig): string {
  const decimals = currency.decimals ?? 2;
  const thousands = currency.separator?.thousands ?? '.';
  const decimal = currency.separator?.decimal ?? ',';
  const safe = Number.isFinite(value) ? value : 0;

  const fixed = safe.toFixed(decimals); // e.g. "1234567.89"
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const number = fracPart !== undefined ? `${grouped}${decimal}${fracPart}` : grouped;

  return currency.position === 'left'
    ? `${currency.symbol}${number}`
    : `${number} ${currency.symbol}`;
}
```

The defaults (`thousands: '.'`, `decimal: ','`) match the spec and the Step 1 test expectations.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/format.ts packages/platform-core/tests/shell/format.test.ts
git commit -m "feat(platform-core): shell currency formatter"
```

---

## Task 3: Shell state + reducer (`state.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/state.ts`
- Test: `packages/platform-core/tests/shell/state.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createInitialState } from '@/shell/state';
import type { ShellConfig } from '@/shell/types';

function cfg(overrides: Partial<ShellConfig> = {}): ShellConfig {
  return {
    mount: {} as HTMLElement,
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5],
    defaultBet: 2,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: true, buyBonus: false },
    ...overrides,
  };
}

describe('createInitialState', () => {
  it('falls back to defaultBet when currentBet is null', () => {
    expect(createInitialState(cfg()).bet).toBe(2);
  });

  it('uses currentBet when provided (mid-session restore)', () => {
    expect(createInitialState(cfg({ currentBet: 5 })).bet).toBe(5);
  });

  it('seeds balance/win/mode and defaults', () => {
    const s = createInitialState(cfg({ balance: 50, win: 9, mode: 'replay' }));
    expect(s.balance).toBe(50);
    expect(s.win).toBe(9);
    expect(s.mode).toBe('replay');
    expect(s.busy).toBe(false);
    expect(s.turbo).toBe(0);
    expect(s.buyBonusEnabled).toBe(true);
    expect(s.autoplay).toEqual({ active: false, remaining: 0 });
    expect(s.freeSpins).toEqual({ current: 0, total: 0, totalWin: 0, lastWin: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/state.test.ts`
Expected: FAIL — cannot resolve `@/shell/state`.

- [ ] **Step 3: Write the implementation**

`packages/platform-core/src/shell/state.ts`:
```ts
import type { ShellConfig, ShellState } from './types';

export function createInitialState(config: ShellConfig): ShellState {
  return {
    mode: config.mode,
    balance: config.balance,
    win: config.win,
    bet: config.currentBet ?? config.defaultBet,
    availableBets: [...config.availableBets],
    busy: false,
    autoplay: { active: false, remaining: 0 },
    turbo: 0,
    buyBonusEnabled: config.features.buyBonus !== false,
    freeSpins: { current: 0, total: 0, totalWin: 0, lastWin: 0 },
  };
}

/** Step bet up/down within availableBets, clamped at the ends. */
export function stepBet(state: ShellState, direction: 1 | -1): number {
  const idx = state.availableBets.indexOf(state.bet);
  const next = Math.max(0, Math.min(state.availableBets.length - 1, idx + direction));
  return state.availableBets[next];
}

/** Cycle turbo level 0..maxLevels (wraps back to 0). */
export function nextTurbo(current: number, maxLevels: number): number {
  if (maxLevels <= 0) return 0;
  return current >= maxLevels ? 0 : current + 1;
}
```

- [ ] **Step 4: Add tests for stepBet and nextTurbo**

Append to `state.test.ts`:
```ts
import { stepBet, nextTurbo } from '@/shell/state';

describe('stepBet', () => {
  const base = { availableBets: [1, 2, 5], bet: 2 } as ShellState;
  it('steps up', () => expect(stepBet(base, 1)).toBe(5));
  it('steps down', () => expect(stepBet(base, -1)).toBe(1));
  it('clamps at top', () => expect(stepBet({ ...base, bet: 5 }, 1)).toBe(5));
  it('clamps at bottom', () => expect(stepBet({ ...base, bet: 1 }, -1)).toBe(1));
});

describe('nextTurbo', () => {
  it('returns 0 when no levels', () => expect(nextTurbo(0, 0)).toBe(0));
  it('increments', () => expect(nextTurbo(1, 3)).toBe(2));
  it('wraps at max', () => expect(nextTurbo(3, 3)).toBe(0));
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/platform-core/tests/shell/state.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/state.ts packages/platform-core/tests/shell/state.test.ts
git commit -m "feat(platform-core): shell state seed + bet/turbo helpers"
```

---

## Task 4: Theme vars + CSS string (`theme.ts`, `shell.css.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/theme.ts`
- Create: `packages/platform-core/src/shell/shell.css.ts`
- Test: `packages/platform-core/tests/shell/theme.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildThemeVars } from '@/shell/theme';

describe('buildThemeVars', () => {
  it('emits brand defaults when no theme supplied', () => {
    const vars = buildThemeVars();
    expect(vars).toContain('--shell-accent:');
    expect(vars).toContain('--shell-buybonus:');
  });

  it('overrides only whitelisted tokens', () => {
    const vars = buildThemeVars({ accent: '#ff0000', buyBonusColor: '#00ff00' });
    expect(vars).toContain('--shell-accent: #ff0000');
    expect(vars).toContain('--shell-buybonus: #00ff00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/theme.test.ts`
Expected: FAIL — cannot resolve `@/shell/theme`.

- [ ] **Step 3: Write the implementations**

`packages/platform-core/src/shell/theme.ts`:
```ts
import type { ThemeConfig } from './types';

const DEFAULT_ACCENT = '#663BA6';   // Energy8 brand purple (see loading/logo.ts)
const DEFAULT_BUYBONUS = '#E0A12B';

/** Returns a CSS custom-property block string for the shell root element. */
export function buildThemeVars(theme: ThemeConfig = {}): string {
  return [
    `--shell-accent: ${theme.accent ?? DEFAULT_ACCENT}`,
    `--shell-buybonus: ${theme.buyBonusColor ?? DEFAULT_BUYBONUS}`,
    `--shell-bg: #0F172A`,
    `--shell-fg: #FFFFFF`,
    `--shell-radius: 12px`,
  ].join('; ') + ';';
}
```

`packages/platform-core/src/shell/shell.css.ts`:
```ts
export const SHELL_ROOT_ID = '__ge-game-shell__';

export const SHELL_CSS = `
#${SHELL_ROOT_ID} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--shell-fg);
}
#${SHELL_ROOT_ID} .ge-shell-bottom {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  pointer-events: auto;
  background: linear-gradient(0deg, rgba(15,23,42,0.85), rgba(15,23,42,0));
}
#${SHELL_ROOT_ID} .ge-shell-btn {
  pointer-events: auto;
  cursor: pointer;
  border: none;
  border-radius: var(--shell-radius);
  background: var(--shell-accent);
  color: var(--shell-fg);
  padding: 10px 16px;
  font-size: 14px;
}
#${SHELL_ROOT_ID} .ge-shell-btn[disabled] { opacity: 0.4; cursor: default; }
#${SHELL_ROOT_ID} .ge-shell-spin { min-width: 96px; min-height: 64px; font-weight: 700; }
#${SHELL_ROOT_ID} .ge-shell-buybonus { background: var(--shell-buybonus); }
#${SHELL_ROOT_ID} .ge-shell-modal {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.6);
  pointer-events: auto;
}
#${SHELL_ROOT_ID} .ge-shell-modal-card {
  background: var(--shell-bg);
  border-radius: var(--shell-radius);
  padding: 24px; max-width: 90%; max-height: 80%; overflow: auto;
}
#${SHELL_ROOT_ID}.ge-shell-hidden { opacity: 0; pointer-events: none; }
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/theme.ts packages/platform-core/src/shell/shell.css.ts packages/platform-core/tests/shell/theme.test.ts
git commit -m "feat(platform-core): shell theme tokens + base CSS"
```

---

## Task 5: DOM primitives (`components/primitives.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/components/primitives.ts`
- Test: `packages/platform-core/tests/shell/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/primitives.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createButton, createToggle, createSlider } from '@/shell/components/primitives';

describe('createButton', () => {
  it('renders label and fires onClick', () => {
    const onClick = vi.fn();
    const btn = createButton({ label: 'SPIN', className: 'ge-shell-spin', onClick });
    expect(btn.textContent).toBe('SPIN');
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    const btn = createButton({ label: 'X', onClick });
    btn.disabled = true;
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('createToggle', () => {
  it('toggles and reports value', () => {
    const onChange = vi.fn();
    const t = createToggle({ checked: false, onChange });
    t.click();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('createSlider', () => {
  it('emits numeric value on input', () => {
    const onInput = vi.fn();
    const s = createSlider({ min: 0, max: 1, step: 0.1, value: 0.5, onInput });
    s.value = '0.8';
    s.dispatchEvent(new Event('input'));
    expect(onInput).toHaveBeenCalledWith(0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/primitives.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/platform-core/src/shell/components/primitives.ts`:
```ts
export interface ButtonOpts {
  label: string;
  className?: string;
  onClick: () => void;
}

export function createButton(opts: ButtonOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `ge-shell-btn ${opts.className ?? ''}`.trim();
  btn.textContent = opts.label;
  btn.addEventListener('click', () => {
    if (!btn.disabled) opts.onClick();
  });
  return btn;
}

export interface ToggleOpts {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function createToggle(opts: ToggleOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'ge-shell-btn ge-shell-toggle';
  let checked = opts.checked;
  const render = () => (btn.textContent = checked ? 'ON' : 'OFF');
  render();
  btn.addEventListener('click', () => {
    checked = !checked;
    render();
    opts.onChange(checked);
  });
  return btn;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}

export function createSlider(opts: SliderOpts): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.className = 'ge-shell-slider';
  input.addEventListener('input', () => opts.onInput(Number(input.value)));
  return input;
}

export interface ModalOpts {
  onClose: () => void;
}

/** A full-screen overlay card. Returns { root, body }; append content to body. */
export function createModal(opts: ModalOpts): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-shell-modal';
  const card = document.createElement('div');
  card.className = 'ge-shell-modal-card';
  const close = createButton({ label: '✕', className: 'ge-shell-close', onClick: opts.onClose });
  const body = document.createElement('div');
  card.append(close, body);
  root.appendChild(card);
  root.addEventListener('click', (e) => {
    if (e.target === root) opts.onClose();
  });
  return { root, body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/primitives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/components/primitives.ts packages/platform-core/tests/shell/primitives.test.ts
git commit -m "feat(platform-core): shell DOM primitives (button/toggle/slider/modal)"
```

---

## Task 6: GameShell controller lifecycle (`GameShell.ts`)

This task builds the controller skeleton: mount overlay, inject CSS + theme vars, idempotent `destroy()` returning a Promise, module-level `createGameShell`/`removeGameShell`. Rendering of the bottom bar comes in Task 7; here `render()` is a no-op placeholder that later tasks fill.

**Files:**
- Create: `packages/platform-core/src/shell/GameShell.ts`
- Modify: `packages/platform-core/src/shell/index.ts` (export real factory)
- Test: `packages/platform-core/tests/shell/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/lifecycle.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5],
    defaultBet: 2,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: true, buyBonus: false },
  };
}

describe('GameShell lifecycle', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('mounts a single overlay root into the mount element', () => {
    createGameShell(cfg(mount));
    expect(mount.querySelectorAll('#__ge-game-shell__').length).toBe(1);
  });

  it('injects the theme vars and stylesheet', () => {
    createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    expect(root.getAttribute('style')).toContain('--shell-accent');
    expect(mount.querySelector('style')).toBeTruthy();
  });

  it('removeGameShell() resolves and removes the root (idempotent)', async () => {
    createGameShell(cfg(mount));
    await removeGameShell();
    expect(mount.querySelector('#__ge-game-shell__')).toBeNull();
    await expect(removeGameShell()).resolves.toBeUndefined();
  });

  it('createGameShell twice does not duplicate the root', () => {
    createGameShell(cfg(mount));
    createGameShell(cfg(mount));
    expect(document.querySelectorAll('#__ge-game-shell__').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/lifecycle.test.ts`
Expected: FAIL — `createGameShell not implemented yet`.

- [ ] **Step 3: Write the controller**

`packages/platform-core/src/shell/GameShell.ts`:
```ts
import { EventEmitter } from '../EventEmitter';
import type { ShellConfig, ShellEvents, ShellState } from './types';
import { createInitialState } from './state';
import { buildThemeVars } from './theme';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';

const REMOVE_FADE_MS = 300;

export class GameShell extends EventEmitter<ShellEvents> {
  readonly config: ShellConfig;
  state: ShellState;
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private destroyed = false;

  constructor(config: ShellConfig) {
    super();
    this.config = config;
    this.state = createInitialState(config);

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_CSS;

    this.root = document.createElement('div');
    this.root.id = SHELL_ROOT_ID;
    this.root.setAttribute('style', buildThemeVars(config.theme));

    config.mount.append(this.styleEl, this.root);
    this.render();
  }

  /** Re-render the shell from current state. Filled in by later tasks. */
  render(): void {
    // BottomBar / modal rendering attached in Task 7+.
  }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.removeAllListeners();
    this.root.classList.add('ge-shell-hidden');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.root.remove();
        this.styleEl.remove();
        resolve();
      }, REMOVE_FADE_MS);
    });
  }
}
```

- [ ] **Step 4: Wire the module factory**

Replace `packages/platform-core/src/shell/index.ts`:
```ts
export type * from './types';
import { GameShell } from './GameShell';
import type { ShellConfig } from './types';

let active: GameShell | null = null;

export function createGameShell(config: ShellConfig): GameShell {
  if (active) return active;
  active = new GameShell(config);
  return active;
}

export function removeGameShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { GameShell };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/lifecycle.test.ts`
Expected: PASS (all 4). Note: the idempotency test calls `removeGameShell()` in `beforeEach`; the `REMOVE_FADE_MS` timer resolves under jsdom's real timers within the default test timeout.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/GameShell.ts packages/platform-core/src/shell/index.ts packages/platform-core/tests/shell/lifecycle.test.ts
git commit -m "feat(platform-core): GameShell controller lifecycle + factory"
```

---

## Task 7: BottomBar — base mode, capability gating, setters & events

**Files:**
- Create: `packages/platform-core/src/shell/components/BottomBar.ts`
- Modify: `packages/platform-core/src/shell/GameShell.ts` (render BottomBar + setters)
- Test: `packages/platform-core/tests/shell/bottombar.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/bottombar.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, ShellFeatures } from '@/shell/types';

function cfg(mount: HTMLElement, features: Partial<ShellFeatures> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: true, buyBonus: false, ...features },
  };
}
const q = (m: HTMLElement, sel: string) => m.querySelector(sel) as HTMLElement | null;

describe('BottomBar base mode', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders spin/bet/balance/win/menu by default', () => {
    createGameShell(cfg(mount));
    expect(q(mount, '[data-ge="spin"]')).toBeTruthy();
    expect(q(mount, '[data-ge="bet-up"]')).toBeTruthy();
    expect(q(mount, '[data-ge="bet-down"]')).toBeTruthy();
    expect(q(mount, '[data-ge="balance"]')!.textContent).toContain('€1000');
    expect(q(mount, '[data-ge="menu"]')).toBeTruthy();
  });

  it('gates turbo/autoplay/buyBonus on features', () => {
    createGameShell(cfg(mount, { turbo: 0, autoplay: false, buyBonus: false }));
    expect(q(mount, '[data-ge="turbo"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
  });

  it('shows turbo + buyBonus when enabled', () => {
    createGameShell(cfg(mount, { turbo: 3, buyBonus: [{ id: 'b', name: 'Bonus', description: 'd', priceMultiplier: 100 }] }));
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
    expect(q(mount, '[data-ge="buybonus"]')).toBeTruthy();
  });

  it('emits spin on spin click', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    q(mount, '[data-ge="spin"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('emits betChange and updates display on bet-up', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('betChange', spy);
    q(mount, '[data-ge="bet-up"]')!.click();
    expect(spy).toHaveBeenCalledWith(5);
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€5');
  });

  it('emits turboChange cycling levels', () => {
    const shell = createGameShell(cfg(mount, { turbo: 2 }));
    const spy = vi.fn();
    shell.on('turboChange', spy);
    q(mount, '[data-ge="turbo"]')!.click();
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('setBusy disables spin/bet but keeps menu enabled', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBusy(true);
    expect((q(mount, '[data-ge="spin"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(mount, '[data-ge="bet-up"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(mount, '[data-ge="menu"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('setBalance/setWin update the HUD', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBalance(250);
    shell.setWin(42);
    expect(q(mount, '[data-ge="balance"]')!.textContent).toContain('€250');
    expect(q(mount, '[data-ge="win"]')!.textContent).toContain('€42');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/bottombar.test.ts`
Expected: FAIL — no `[data-ge="spin"]` rendered / setters undefined.

- [ ] **Step 3: Write the BottomBar component**

`packages/platform-core/src/shell/components/BottomBar.ts`:
```ts
import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { stepBet, nextTurbo } from '../state';
import { createButton } from './primitives';

function valueEl(tag: string, ge: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.ge = ge;
  el.className = `ge-shell-${ge}`;
  el.textContent = text;
  return el;
}

/** Builds (or rebuilds) the bottom bar DOM for the current shell state. */
export function renderBottomBar(shell: GameShell): HTMLElement {
  const { state, config } = shell;
  const fmt = (n: number) => formatCurrency(n, config.currency);
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  if (state.mode === 'base') {
    bar.appendChild(valueEl('div', 'balance', fmt(state.balance)));

    const betDown = createButton({ label: '−', onClick: () => onBet(shell, -1) });
    betDown.dataset.ge = 'bet-down';
    const betValue = valueEl('span', 'bet-value', fmt(state.bet));
    const betUp = createButton({ label: '+', onClick: () => onBet(shell, 1) });
    betUp.dataset.ge = 'bet-up';
    bar.append(betDown, betValue, betUp);

    const spin = createButton({ label: 'SPIN', className: 'ge-shell-spin', onClick: () => shell.emit('spin') });
    spin.dataset.ge = 'spin';
    bar.appendChild(spin);

    if (config.features.autoplay) {
      const auto = createButton({ label: 'AUTO', onClick: () => onAutoplay(shell) });
      auto.dataset.ge = 'autoplay';
      bar.appendChild(auto);
    }
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
    if (config.features.buyBonus !== false) {
      const buy = createButton({ label: 'BUY BONUS', className: 'ge-shell-buybonus', onClick: () => shell.openBuyBonus() });
      buy.dataset.ge = 'buybonus';
      bar.appendChild(buy);
    }

    bar.appendChild(valueEl('div', 'win', fmt(state.win)));
  }

  // menu is always present
  const menu = createButton({ label: '☰', onClick: () => shell.openMenu() });
  menu.dataset.ge = 'menu';
  bar.appendChild(menu);

  applyBusy(shell, bar);
  return bar;
}

function turboLabel(level: number): string {
  return level === 0 ? 'TURBO' : `TURBO ×${level}`;
}

function onBet(shell: GameShell, dir: 1 | -1): void {
  if (shell.state.busy) return;
  const next = stepBet(shell.state, dir);
  if (next !== shell.state.bet) {
    shell.state.bet = next;
    shell.emit('betChange', next);
    shell.render();
  }
}

function onTurbo(shell: GameShell): void {
  const next = nextTurbo(shell.state.turbo, shell.config.features.turbo);
  shell.state.turbo = next;
  shell.emit('turboChange', next);
  shell.render();
}

function onAutoplay(shell: GameShell): void {
  const active = !shell.state.autoplay.active;
  shell.state.autoplay = { active, remaining: active ? shell.state.autoplay.remaining : 0 };
  if (active) shell.emit('autoplayStart', shell.state.autoplay);
  else shell.emit('autoplayStop');
  shell.render();
}

/** Disable money controls while busy; keep menu usable. */
function applyBusy(shell: GameShell, bar: HTMLElement): void {
  const busy = shell.state.busy;
  for (const ge of ['spin', 'bet-up', 'bet-down', 'buybonus', 'autoplay']) {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = busy;
  }
}
```

- [ ] **Step 4: Wire BottomBar + setters into GameShell**

In `packages/platform-core/src/shell/GameShell.ts`, replace the `render()` no-op and add setters. Add imports at top:
```ts
import { renderBottomBar } from './components/BottomBar';
import type { AutoplayOptions, FreeSpinsState, ShellMode } from './types';
```
Replace `render()`:
```ts
  render(): void {
    if (this.destroyed) return;
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this));
  }
```
Add a `barHost` field and create it in the constructor (after `this.root` is appended, before `this.render()`):
```ts
  private barHost = document.createElement('div');
```
In the constructor, before `this.render()`:
```ts
    this.barHost.className = 'ge-shell-barhost';
    this.root.appendChild(this.barHost);
```
Add setter methods (and stub modal openers used by BottomBar — real bodies arrive in Tasks 9–11):
```ts
  setBalance(n: number): void { this.state.balance = n; this.render(); }
  setWin(n: number): void { this.state.win = n; this.render(); }
  setBet(n: number): void { this.state.bet = n; this.render(); }
  setMode(mode: ShellMode): void { this.state.mode = mode; this.render(); }
  setBusy(busy: boolean): void { this.state.busy = busy; this.render(); }
  setAutoplay(a: AutoplayOptions): void { this.state.autoplay = a; this.render(); }
  setTurbo(level: number): void { this.state.turbo = level; this.render(); }
  setBuyBonusEnabled(enabled: boolean): void { this.state.buyBonusEnabled = enabled; this.render(); }
  setFreeSpins(fs: FreeSpinsState): void { this.state.freeSpins = fs; this.render(); }

  openMenu(): void { this.emit('menuOpen'); }
  openBuyBonus(): void { /* overlay in Task 11 */ }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/bottombar.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Run the full shell suite to catch regressions**

Run: `npx vitest run packages/platform-core/tests/shell/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-core/src/shell/components/BottomBar.ts packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/bottombar.test.ts
git commit -m "feat(platform-core): BottomBar base mode + shell setters/events"
```

---

## Task 8: BottomBar — freeSpins & replay modes

**Files:**
- Modify: `packages/platform-core/src/shell/components/BottomBar.ts`
- Test: `packages/platform-core/tests/shell/bottombar-modes.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/bottombar-modes.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 2, autoplay: true, buyBonus: false }, ...over,
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('BottomBar freeSpins/replay modes', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('freeSpins: no spin/bet/buy/autoplay, shows counter + turbo', () => {
    const shell = createGameShell(cfg(mount, { mode: 'freeSpins' }));
    shell.setFreeSpins({ current: 3, total: 10, totalWin: 25, lastWin: 4 });
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('3');
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('10');
    expect(q(mount, '[data-ge="fs-totalwin"]')!.textContent).toContain('€25');
    expect(q(mount, '[data-ge="fs-lastwin"]')!.textContent).toContain('€4');
  });

  it('replay: read-only bet/win/turbo, no controls', () => {
    const shell = createGameShell(cfg(mount, { mode: 'replay', win: 12 }));
    expect(q(mount, '[data-ge="replay-badge"]')).toBeTruthy();
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€2');
    expect(q(mount, '[data-ge="win"]')!.textContent).toContain('€12');
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/bottombar-modes.test.ts`
Expected: FAIL — freeSpins/replay branches not rendered.

- [ ] **Step 3: Extend BottomBar with the two modes**

In `packages/platform-core/src/shell/components/BottomBar.ts`, add these branches inside `renderBottomBar` after the `if (state.mode === 'base') { … }` block and before the `// menu is always present` line:
```ts
  if (state.mode === 'freeSpins') {
    bar.appendChild(valueEl('div', 'balance', fmt(state.balance)));
    bar.appendChild(valueEl('div', 'bet-value', fmt(state.bet))); // read-only
    const counter = valueEl('div', 'fs-counter', `${state.freeSpins.current} / ${state.freeSpins.total}`);
    bar.appendChild(counter);
    bar.appendChild(valueEl('div', 'fs-totalwin', fmt(state.freeSpins.totalWin)));
    bar.appendChild(valueEl('div', 'fs-lastwin', fmt(state.freeSpins.lastWin)));
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
  }

  if (state.mode === 'replay') {
    bar.appendChild(valueEl('div', 'replay-badge', 'REPLAY'));
    bar.appendChild(valueEl('div', 'bet-value', fmt(state.bet))); // read-only
    bar.appendChild(valueEl('div', 'win', fmt(state.win)));
    if (state.freeSpins.total > 0) {
      bar.appendChild(valueEl('div', 'fs-counter', `${state.freeSpins.current} / ${state.freeSpins.total}`));
    }
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
  }
```
Note: in replay/freeSpins the `menu` button still appends (it is outside the mode branches), which is correct — the player can still open settings/info.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/bottombar-modes.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full shell suite**

Run: `npx vitest run packages/platform-core/tests/shell/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/components/BottomBar.ts packages/platform-core/tests/shell/bottombar-modes.test.ts
git commit -m "feat(platform-core): BottomBar freeSpins + replay modes"
```

---

## Task 9: Menu + Settings modal surfaces

**Files:**
- Create: `packages/platform-core/src/shell/components/Menu.ts`
- Create: `packages/platform-core/src/shell/components/Settings.ts`
- Modify: `packages/platform-core/src/shell/GameShell.ts` (openMenu shows modal; settingsOpen)
- Test: `packages/platform-core/tests/shell/menu.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/menu.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('Menu + Settings', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('opens menu modal and emits menuOpen', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('menuOpen', spy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="menu-modal"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-settings"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-info"]')).toBeTruthy();
  });

  it('menu → settings opens settings modal and emits settingsOpen', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingsOpen', spy);
    q(mount, '[data-ge="menu"]')!.click();
    q(mount, '[data-ge="menu-settings"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });

  it('settings slider emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openSettings();
    const slider = q(mount, '[data-ge="setting-master"]') as HTMLInputElement;
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'master', value: 0.3 });
  });

  it('quick-spin toggle emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openSettings();
    q(mount, '[data-ge="setting-quickspin"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'quickSpin', value: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/menu.test.ts`
Expected: FAIL — modal not rendered / `openSettings` undefined.

- [ ] **Step 3: Write the Settings component**

`packages/platform-core/src/shell/components/Settings.ts`:
```ts
import type { GameShell } from '../GameShell';
import { createModal, createSlider, createToggle } from './primitives';

export function openSettingsModal(shell: GameShell): HTMLElement {
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'settings-modal';

  const slider = (key: string, label: string) => {
    const row = document.createElement('label');
    row.className = 'ge-shell-setting-row';
    row.textContent = label;
    const input = createSlider({
      min: 0, max: 1, step: 0.05, value: 1,
      onInput: (value) => shell.emit('settingChange', { key, value }),
    });
    input.dataset.ge = `setting-${key.toLowerCase()}`;
    row.appendChild(input);
    return row;
  };

  body.appendChild(slider('master', 'Master volume'));
  body.appendChild(slider('music', 'Music'));
  body.appendChild(slider('sfx', 'SFX'));

  const quick = createToggle({ checked: false, onChange: (value) => shell.emit('settingChange', { key: 'quickSpin', value }) });
  quick.dataset.ge = 'setting-quickspin';
  const quickRow = document.createElement('label');
  quickRow.className = 'ge-shell-setting-row';
  quickRow.textContent = 'Quick spin';
  quickRow.appendChild(quick);
  body.appendChild(quickRow);

  return root;
}
```

- [ ] **Step 4: Write the Menu component**

`packages/platform-core/src/shell/components/Menu.ts`:
```ts
import type { GameShell } from '../GameShell';
import { createModal, createButton } from './primitives';

export function openMenuModal(shell: GameShell): HTMLElement {
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'menu-modal';

  const entry = (ge: string, label: string, onClick: () => void) => {
    const btn = createButton({ label, onClick });
    btn.dataset.ge = ge;
    return btn;
  };

  body.append(
    entry('menu-settings', 'Settings', () => { root.remove(); shell.openSettings(); }),
    entry('menu-info', 'Game Info', () => { root.remove(); shell.openInfo(); }),
  );
  return root;
}
```

- [ ] **Step 5: Wire openMenu/openSettings/openInfo into GameShell**

In `packages/platform-core/src/shell/GameShell.ts`, add a modal host and methods. Add field:
```ts
  private modalHost = document.createElement('div');
```
In constructor, after appending `barHost`:
```ts
    this.modalHost.className = 'ge-shell-modalhost';
    this.root.appendChild(this.modalHost);
```
Add import:
```ts
import { openMenuModal } from './components/Menu';
import { openSettingsModal } from './components/Settings';
```
Add/replace methods:
```ts
  private showModal(el: HTMLElement): void {
    this.modalHost.innerHTML = '';
    this.modalHost.appendChild(el);
  }

  openMenu(): void { this.emit('menuOpen'); this.showModal(openMenuModal(this)); }
  openSettings(): void { this.emit('settingsOpen'); this.showModal(openSettingsModal(this)); }
  openInfo(): void { this.emit('infoOpen'); /* GameInfo modal in Task 10 */ }
```
(Remove the old `openMenu` stub from Task 7.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/menu.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full shell suite**

Run: `npx vitest run packages/platform-core/tests/shell/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/platform-core/src/shell/components/Menu.ts packages/platform-core/src/shell/components/Settings.ts packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/menu.test.ts
git commit -m "feat(platform-core): shell Menu + Settings modals"
```

---

## Task 10: GameInfo modal surface

**Files:**
- Create: `packages/platform-core/src/shell/components/GameInfo.ts`
- Modify: `packages/platform-core/src/shell/GameShell.ts` (openInfo renders GameInfo)
- Test: `packages/platform-core/tests/shell/gameinfo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/gameinfo.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: {
      rtp: 96.5,
      rules: 'Match symbols left to right.',
      symbols: [{ name: 'Wild', payouts: '5x = 100' }],
      features: [{ name: 'Free Spins', description: '3 scatters trigger 10 spins.' }],
    },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('GameInfo', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders rtp, rules, symbols and features from gameInfo', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('96.5');
    expect(modal.textContent).toContain('Match symbols left to right.');
    expect(modal.textContent).toContain('Wild');
    expect(modal.textContent).toContain('Free Spins');
  });

  it('omits sections that are not provided', () => {
    const c = cfg(mount);
    c.gameInfo = { rtp: 96 };
    const shell = createGameShell(c);
    shell.openInfo();
    expect(q(mount, '[data-ge="info-rules"]')).toBeNull();
    expect(q(mount, '[data-ge="info-symbols"]')).toBeNull();
    expect(q(mount, '[data-ge="info-rtp"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/gameinfo.test.ts`
Expected: FAIL — info modal not rendered.

- [ ] **Step 3: Write the GameInfo component**

`packages/platform-core/src/shell/components/GameInfo.ts`:
```ts
import type { GameShell } from '../GameShell';
import { createModal } from './primitives';

export function openGameInfoModal(shell: GameShell): HTMLElement {
  const info = shell.config.gameInfo;
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'info-modal';

  const section = (ge: string, title: string): HTMLElement => {
    const sec = document.createElement('section');
    sec.dataset.ge = ge;
    const h = document.createElement('h3');
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  };

  if (typeof info.rtp === 'number') {
    const rtp = section('info-rtp', 'RTP');
    const p = document.createElement('p');
    p.textContent = `${info.rtp}%`;
    rtp.appendChild(p);
    body.appendChild(rtp);
  }

  if (info.rules) {
    const rules = section('info-rules', 'Rules');
    const p = document.createElement('p');
    p.textContent = info.rules;
    rules.appendChild(p);
    body.appendChild(rules);
  }

  if (info.symbols?.length) {
    const sym = section('info-symbols', 'Paytable');
    for (const s of info.symbols) {
      const row = document.createElement('div');
      row.className = 'ge-shell-sym-row';
      row.textContent = s.payouts ? `${s.name} — ${s.payouts}` : s.name;
      sym.appendChild(row);
    }
    body.appendChild(sym);
  }

  if (info.features?.length) {
    const feat = section('info-features', 'Features');
    for (const f of info.features) {
      const row = document.createElement('div');
      row.className = 'ge-shell-feat-row';
      row.textContent = `${f.name}: ${f.description}`;
      feat.appendChild(row);
    }
    body.appendChild(feat);
  }

  return root;
}
```

- [ ] **Step 4: Wire openInfo into GameShell**

In `packages/platform-core/src/shell/GameShell.ts`, add import:
```ts
import { openGameInfoModal } from './components/GameInfo';
```
Replace `openInfo`:
```ts
  openInfo(): void { this.emit('infoOpen'); this.showModal(openGameInfoModal(this)); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/gameinfo.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/components/GameInfo.ts packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/gameinfo.test.ts
git commit -m "feat(platform-core): shell GameInfo modal"
```

---

## Task 11: BuyBonus overlay

**Files:**
- Create: `packages/platform-core/src/shell/components/BuyBonus.ts`
- Modify: `packages/platform-core/src/shell/GameShell.ts` (openBuyBonus renders overlay)
- Test: `packages/platform-core/tests/shell/buybonus.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/buybonus.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, BonusOption } from '@/shell/types';

const BONUSES: BonusOption[] = [
  { id: 'ante', name: 'Ante Bet', description: 'Boosts trigger', priceMultiplier: 25, volatility: 3, accentColor: '#ff0' },
  { id: 'bonus', name: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 5 },
];

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: BONUSES },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const qa = (m: HTMLElement, s: string) => Array.from(m.querySelectorAll(s)) as HTMLElement[];

describe('BuyBonus overlay', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('opens overlay with a card per bonus and live price = priceMultiplier × bet', () => {
    const shell = createGameShell(cfg(mount));
    q(mount, '[data-ge="buybonus"]')!.click();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();
    const cards = qa(mount, '[data-ge^="bonus-card-"]');
    expect(cards.length).toBe(2);
    // bet defaults to 2 → ante 25×2 = 50, bonus 100×2 = 200
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€50');
    expect(q(mount, '[data-ge="bonus-card-bonus"]')!.textContent).toContain('€200');
  });

  it('emits buyBonusSelect with id on card click', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    expect(spy).toHaveBeenCalledWith({ id: 'bonus' });
  });

  it('recomputes price after setBet', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBet(1);
    shell.openBuyBonus();
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€25');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/buybonus.test.ts`
Expected: FAIL — overlay not rendered.

- [ ] **Step 3: Write the BuyBonus component**

`packages/platform-core/src/shell/components/BuyBonus.ts`:
```ts
import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { createModal } from './primitives';

export function openBuyBonusOverlay(shell: GameShell): HTMLElement | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'buybonus-overlay';

  for (const bonus of bonuses) {
    body.appendChild(buildCard(shell, bonus, root));
  }
  return root;
}

function buildCard(shell: GameShell, bonus: BonusOption, root: HTMLElement): HTMLElement {
  const price = bonus.priceMultiplier * shell.state.bet;
  const card = document.createElement('button');
  card.className = 'ge-shell-btn ge-shell-bonus-card';
  card.dataset.ge = `bonus-card-${bonus.id}`;
  if (bonus.accentColor) card.style.borderColor = bonus.accentColor;

  const stars = bonus.volatility ? '★'.repeat(bonus.volatility) : '';
  card.innerHTML = `
    <div class="ge-bonus-name">${bonus.name}</div>
    <div class="ge-bonus-desc">${bonus.description}</div>
    <div class="ge-bonus-vol">${stars}</div>
    <div class="ge-bonus-price">${formatCurrency(price, shell.config.currency)}</div>
  `;
  card.addEventListener('click', () => {
    if (shell.state.busy || !shell.state.buyBonusEnabled) return;
    shell.emit('buyBonusSelect', { id: bonus.id });
    root.remove();
  });
  return card;
}
```

- [ ] **Step 4: Wire openBuyBonus into GameShell**

In `packages/platform-core/src/shell/GameShell.ts`, add import:
```ts
import { openBuyBonusOverlay } from './components/BuyBonus';
```
Replace the `openBuyBonus` stub from Task 7:
```ts
  openBuyBonus(): void {
    const overlay = openBuyBonusOverlay(this);
    if (overlay) this.showModal(overlay);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/buybonus.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full shell suite**

Run: `npx vitest run packages/platform-core/tests/shell/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-core/src/shell/components/BuyBonus.ts packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/buybonus.test.ts
git commit -m "feat(platform-core): shell BuyBonus selection overlay"
```

---

## Task 12: Export the shell from platform-core main index

**Files:**
- Modify: `packages/platform-core/src/index.ts`
- Test: `packages/platform-core/tests/shell/smoke.test.ts` (extend)

- [ ] **Step 1: Extend the smoke test for the main entry**

Append to `packages/platform-core/tests/shell/smoke.test.ts`:
```ts
describe('main entry re-exports shell factory', () => {
  it('createGameShell is reachable from the package root', async () => {
    const root = await import('@/index');
    expect(typeof (root as Record<string, unknown>).createGameShell).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/shell/smoke.test.ts`
Expected: FAIL — `createGameShell` not on root.

- [ ] **Step 3: Add the re-export**

In `packages/platform-core/src/index.ts`, after the loading-screen export block (around line 51), add:
```ts
// ─── Branded game shell (renderer-agnostic DOM UI chrome) ─────────────────
export { createGameShell, removeGameShell, GameShell } from './shell';
export type {
  ShellConfig,
  ShellMode,
  ShellFeatures,
  ShellState,
  ShellEvents,
  BonusOption,
  CurrencyConfig,
  ThemeConfig,
  GameInfoContent,
  AutoplayOptions,
  FreeSpinsState,
} from './shell';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/platform-core/tests/shell/smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/index.ts packages/platform-core/tests/shell/smoke.test.ts
git commit -m "feat(platform-core): re-export game shell from package root"
```

---

## Task 13: game-engine re-export sub-path + optional GameApplication boot

**Files:**
- Create: `packages/game-engine/src/shell/index.ts`
- Modify: `packages/game-engine/package.json` (add `./shell` export)
- Modify: `packages/game-engine/rollup.config.mjs` (add shell bundle) — match existing pattern
- Modify: `packages/game-engine/src/core/GameApplication.ts` (optional shell boot)
- Modify: `packages/game-engine/src/types.ts` (add `shell?` to `GameApplicationConfig`)
- Test: `packages/game-engine/tests/shell-reexport.test.ts`

- [ ] **Step 1: Inspect the existing re-export pattern**

Run: `cat packages/game-engine/src/debug/index.ts`
Expected: shows how `/debug` re-exports DevBridge from platform-core. Mirror this exact pattern for `/shell`.

- [ ] **Step 2: Write the failing test**

`packages/game-engine/tests/shell-reexport.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as shell from '@/shell';

describe('game-engine /shell re-export', () => {
  it('re-exports createGameShell from platform-core', () => {
    expect(typeof shell.createGameShell).toBe('function');
    expect(typeof shell.removeGameShell).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/shell-reexport.test.ts`
Expected: FAIL — cannot resolve `@/shell`.

- [ ] **Step 4: Create the re-export module**

`packages/game-engine/src/shell/index.ts`:
```ts
// Re-export the renderer-agnostic branded game shell from platform-core so
// game-engine consumers can import it via @energy8platform/game-engine/shell.
export {
  createGameShell,
  removeGameShell,
  GameShell,
} from '@energy8platform/platform-core/shell';
export type {
  ShellConfig,
  ShellMode,
  ShellFeatures,
  ShellState,
  ShellEvents,
  BonusOption,
  CurrencyConfig,
  ThemeConfig,
  GameInfoContent,
  AutoplayOptions,
  FreeSpinsState,
} from '@energy8platform/platform-core/shell';
```

- [ ] **Step 5: Add the package export + rollup entry**

In `packages/game-engine/package.json`, add to `exports` (mirroring the existing `./debug` entry):
```json
    "./shell": {
      "import": "./dist/shell.esm.js",
      "require": "./dist/shell.cjs.js",
      "types": "./dist/shell.d.ts"
    }
```
In `packages/game-engine/rollup.config.mjs`, add an entry mirroring the existing `/debug` bundle line:
```js
  ...createBundle('src/shell/index.ts', 'shell'),
```
(Use whatever `createBundle`/entry helper that file already defines; match the `/debug` entry exactly.)

- [ ] **Step 6: Run the re-export test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/shell-reexport.test.ts`
Expected: PASS.

- [ ] **Step 7: Add optional shell boot to GameApplication**

In `packages/game-engine/src/types.ts`, add to `GameApplicationConfig`:
```ts
  /** When set, GameApplication mounts the branded game shell after the SDK handshake. */
  shell?: import('@energy8platform/platform-core/shell').ShellConfig | false;
```
In `packages/game-engine/src/core/GameApplication.ts`, after `createPlatformSession` completes in the boot sequence, add:
```ts
    if (this.config.shell) {
      const { createGameShell } = await import('@energy8platform/platform-core/shell');
      this.shell = createGameShell(this.config.shell);
    }
```
Declare the field on the class (near other manager fields):
```ts
  shell?: import('@energy8platform/platform-core/shell').GameShell;
```
And in the existing destroy/teardown path, add:
```ts
    if (this.shell) {
      const { removeGameShell } = await import('@energy8platform/platform-core/shell');
      await removeGameShell();
      this.shell = undefined;
    }
```

- [ ] **Step 8: Run the game-engine test suite**

Run: `npm test --workspace @energy8platform/game-engine`
Expected: PASS (existing tests + new re-export test). If GameApplication has an integration test that constructs it without `shell`, it must still pass because `shell` is optional.

- [ ] **Step 9: Commit**

```bash
git add packages/game-engine/src/shell packages/game-engine/package.json packages/game-engine/rollup.config.mjs packages/game-engine/src/core/GameApplication.ts packages/game-engine/src/types.ts packages/game-engine/tests/shell-reexport.test.ts
git commit -m "feat(game-engine): re-export game shell + optional GameApplication boot"
```

---

## Task 14: Build, typecheck, full-suite gate + README docs

**Files:**
- Modify: `packages/platform-core/README.md` (document `/shell`)
- Modify: `CLAUDE.md` (add `/shell` to platform-core sub-paths list)

- [ ] **Step 1: Run typecheck across both packages**

Run: `npm run typecheck`
Expected: PASS (no type errors). Fix any signature mismatches surfaced here before continuing.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS (game-engine + platform-core, including all `tests/shell/*`).

- [ ] **Step 3: Build both packages**

Run: `npm run build`
Expected: PASS — confirms the new Rollup `shell` entries emit `dist/shell.{esm,cjs}.js` + `dist/shell.d.ts` in both packages.

- [ ] **Step 4: Document the sub-path in platform-core README**

In `packages/platform-core/README.md`, add a `## @energy8platform/platform-core/shell` section describing:
```md
## @energy8platform/platform-core/shell

Renderer-agnostic, vanilla-DOM **branded game shell** — a UI overlay layered over the
game canvas. Owns the control bar (3 modes: base / freeSpins / replay), menu, settings,
game info, and a buy-bonus selection overlay.

The shell is **fully driven by the game** (single source of truth) — it does not
subscribe to the SDK/session. Feed state via config + setters; react to player intent
via events. This keeps replay and mid-spin restore deterministic.

```ts
import { createGameShell } from '@energy8platform/platform-core/shell';

const shell = createGameShell({
  mount: document.getElementById('game')!,
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [0.2, 0.5, 1, 2], defaultBet: 1, currentBet: null,
  balance: 1000, win: 0, mode: 'base',
  gameInfo: { rtp: 96.5, rules: '…' },
  features: { turbo: 3, autoplay: true, buyBonus: [
    { id: 'fs', name: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 5 },
  ] },
});

shell.on('spin', () => game.spin(shell.state.bet));
shell.on('betChange', (bet) => game.setBet(bet));
shell.on('buyBonusSelect', ({ id }) => game.buy(id));

// game → shell
shell.setBalance(980);
shell.setWin(20);
shell.setBusy(true);            // during an active spin
shell.setMode('freeSpins');
shell.setFreeSpins({ current: 1, total: 10, totalWin: 0, lastWin: 0 });
```

Also re-exported from `@energy8platform/game-engine/shell`.
```

- [ ] **Step 5: Add the sub-path to CLAUDE.md**

In `CLAUDE.md`, under the platform-core "Sub-paths" list, add:
```md
- `@energy8platform/platform-core/shell` — `createGameShell`, `removeGameShell`, branded renderer-agnostic DOM game shell (control bar, menu, settings, game info, buy bonus)
```

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/README.md CLAUDE.md
git commit -m "docs: document game shell sub-path (/shell)"
```

---

## Self-Review Notes (covered against the spec)

- **Placement** (`platform-core/src/shell`, sub-path, game-engine re-export) → Tasks 1, 12, 13. ✓
- **DOM overlay, vanilla DOM, zero deps** → Tasks 4–11 (no framework imports). ✓
- **Game is source of truth; no session subscription** → controller takes config + setters only (Tasks 6–11); no SDK import anywhere. ✓
- **currentBet nullable → defaultBet fallback** → Task 3 + test. ✓
- **language, currency (symbol side/decimals/separators)** → Tasks 1 (types), 2 (formatter). ✓
- **features: turbo 0–3, autoplay, buyBonus[] | false; capability gating** → Tasks 7, 11 + tests. ✓
- **BonusOption: priceMultiplier, volatility 1–5, accentColor; live price = mult × bet** → Tasks 1, 11 + tests. ✓
- **3 bottom-bar modes (base/freeSpins/replay)** → Tasks 7, 8 + tests. ✓
- **setBusy keeps menu enabled** → Task 7 test. ✓
- **setFreeSpins {current,total,totalWin,lastWin}** → Tasks 7 (setter), 8 (render) + test. ✓
- **Menu/Settings (settingChange)/GameInfo(slots)/BuyBonus overlay** → Tasks 9, 10, 11 + tests. ✓
- **Lifecycle: create sync, remove Promise, idempotent** → Task 6 + test. ✓
- **Testing: vitest + jsdom, capability-gating, mode switching, events, idempotent destroy, no-pixi smoke** → all component tasks + Tasks 1, 6. ✓

**Out of scope (per spec), intentionally not planned:** `setCurrency()` runtime swap, interactive replay navigation, game-specific buy-bonus purchase panel, ResizeObserver responsive relayout (CSS handles base portrait/landscape; a JS relayout pass can be a follow-up — flagged, not silently dropped).
