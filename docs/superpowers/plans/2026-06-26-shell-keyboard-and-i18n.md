# Shell Keyboard Controls & Localization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hold-to-spin, hold-to-step bet, a Shift-based hotkey scheme with in-modal keyboard navigation, and 16-language localization to both the Pixi shell and the DOM shell.

**Architecture:** Shared shell logic is **duplicated** across `packages/pixi-shell/src/` and `packages/platform-core/src/shell/` (same pattern as the existing `state.ts`/`i18n.ts`/`pickers.ts`), kept in lockstep by byte-parity tests. A pure `KeyboardController` drives all key handling through a small host adapter; a pure `createI18n` resolver translates English-source strings via a duplicated `locales.ts`. The game-engine host merges a per-game `i18n` map into the resolver and pre-resolves spec strings before building shell config.

**Tech Stack:** TypeScript, Vitest 2 (+ jsdom, fake timers), Pixi v8, npm workspaces, Rollup.

**Spec:** `docs/superpowers/specs/2026-06-26-shell-keyboard-and-i18n-design.md`

## Global Constraints

- **Both shells, in lockstep.** Every behaviour/string change lands in BOTH `packages/pixi-shell/src/` and `packages/platform-core/src/shell/`. Duplicated modules (`keyboard.ts`, `locales.ts`) must be **byte-identical**; a parity test enforces this.
- **No new cross-package deps.** `pixi-shell` depends only on `pixi.js` (peer). Do not import `platform-core` from `pixi-shell`.
- **English-as-key.** `t()` takes the English source string; never introduce opaque message keys. Missing translation → return the English source.
- **`socialize()` is English-only** and unchanged. It applies only when resolved language is `en` and `isSocial` is set.
- **16 languages:** `de en es fi fr hi id ja ko pl pt ru tr vi zh da`. Arabic/RTL is OUT OF SCOPE.
- **Modifier rule:** only `Space` and `Esc` are bare on the bar; every other bar action requires `Shift`. Bare arrows/Enter/Esc are for in-modal navigation only.
- **Backwards compatible:** `features.spacebar` keeps gating Space; existing `t('English')` call sites keep working.
- **Commit cadence:** one commit per task (TDD: test → impl → green → commit). Run `npm test` (or the workspace-scoped variant) before each commit.
- Run tests workspace-scoped: `npx vitest run packages/<pkg>/tests/<file>` for a single file; `npm test --workspace @energy8platform/<pkg>` for a package.

---

## File structure

**Per shell** (`X` = `packages/pixi-shell/src` and `packages/platform-core/src/shell`):
- `X/i18n.ts` — **modify**: add `Lang`, `LANGS`, `normalizeLang`, `createI18n`; keep `socialize`.
- `X/locales.ts` — **create** (duplicated, byte-identical): `LOCALES` translation data.
- `X/keyboard.ts` — **create** (duplicated, byte-identical): `KeyboardController`, `KeyboardHost`.
- `X/types.ts` — **modify**: `ShellFeatures.hotkeys?`, `'hotkeys'` Game Info section, `ShellLayer.onKey?` (Pixi context) / DOM modal key contract.
- `X/components/pickers.ts`, `components/BuyBonus.ts`, `components/GameInfo.ts` — **modify**: `onKey`, wrap stray strings, hotkeys section.

**Pixi-only:** `packages/pixi-shell/src/context.ts` (host `t`, `setLanguage`, `ShellLayer.onKey`), `PixiGameShell.ts` (controller wiring, `setBusy` hook), `primitives/overlay.ts` + `primitives/scroll.ts` (scroll `onKey`).

**DOM-only:** `packages/platform-core/src/shell/GameShell.ts` (controller wiring, `setBusy` hook, `t`, `setLanguage`, modal key stack), `components/Settings.ts` (aria-label).

**Host & tooling:** `packages/game-engine/src/host/shellConfig.ts` (merged resolver, spec-string resolution, `createSlotGame.i18n`); `packages/stake-kit/` harness bar UI (language dropdown); `packages/create-slot/` (`codegen/i18nTs.ts`, `generate.ts`, `codegen/mainTs.ts`, `codegen/claudeMd.ts`).

**Tests** live in each package's `tests/` dir (`*.test.ts`), `@/*` → that package's `src/*`.

---

## Task 1: i18n resolver core (`createI18n`, `normalizeLang`) + `locales.ts` skeleton

**Files:**
- Modify: `packages/pixi-shell/src/i18n.ts`, `packages/platform-core/src/shell/i18n.ts`
- Create: `packages/pixi-shell/src/locales.ts`, `packages/platform-core/src/shell/locales.ts`
- Test: `packages/pixi-shell/tests/i18n.test.ts`, `packages/platform-core/tests/shell-i18n.test.ts`

**Interfaces — Produces** (identical in both `i18n.ts`):
```ts
export type Lang = 'de'|'en'|'es'|'fi'|'fr'|'hi'|'id'|'ja'|'ko'|'pl'|'pt'|'ru'|'tr'|'vi'|'zh'|'da';
export const LANGS: readonly Lang[]; // the 16 above, in that order
export function normalizeLang(code: string | null | undefined): Lang; // 'pt-BR'→'pt', unknown→'en'
export interface I18nOptions { language: string; isSocial?: boolean; messages?: Partial<Record<Lang, Record<string, string>>>; }
export interface I18n { readonly lang: Lang; t(src: string): string; }
export function createI18n(opts: I18nOptions): I18n;
export function socialize(text: string): string; // unchanged
```
`locales.ts` (both): `export const LOCALES: Partial<Record<Lang, Record<string, string>>> = {};` (data filled in Task 3).

- [ ] **Step 1: Write failing tests** (`packages/pixi-shell/tests/i18n.test.ts`; mirror to platform-core path with the same body):
```ts
import { describe, it, expect } from 'vitest';
import { normalizeLang, createI18n } from '@/i18n';

describe('normalizeLang', () => {
  it('passes known languages through', () => expect(normalizeLang('ru')).toBe('ru'));
  it('strips region subtags', () => expect(normalizeLang('pt-BR')).toBe('pt'));
  it('is case-insensitive', () => expect(normalizeLang('DE')).toBe('de'));
  it('falls back to en for unknown/empty', () => {
    expect(normalizeLang('xx')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });
});

describe('createI18n.t', () => {
  it('returns the English source as-is for en, no social', () => {
    expect(createI18n({ language: 'en' }).t('Settings')).toBe('Settings');
  });
  it('socializes English only when isSocial', () => {
    expect(createI18n({ language: 'en', isSocial: true }).t('Buy bonus')).toBe('Get bonus');
  });
  it('translates via LOCALES when present', () => {
    const t = createI18n({ language: 'ru', messages: { ru: { Settings: 'Настройки' } } }).t;
    expect(t('Settings')).toBe('Настройки');
  });
  it('falls back to the English source when a key is missing', () => {
    expect(createI18n({ language: 'ru' }).t('No Such String')).toBe('No Such String');
  });
  it('game messages override built-in LOCALES', () => {
    const i = createI18n({ language: 'de', messages: { de: { Spin: 'XXX' } } });
    expect(i.t('Spin')).toBe('XXX');
  });
  it('does NOT socialize non-English', () => {
    expect(createI18n({ language: 'ru', isSocial: true, messages: { ru: { 'Buy bonus': 'Бонус' } } }).t('Buy bonus')).toBe('Бонус');
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npx vitest run packages/pixi-shell/tests/i18n.test.ts` → FAIL (`createI18n` not exported).

- [ ] **Step 3: Implement** in both `i18n.ts` (append; keep `socialize` and `RULES`):
```ts
import { LOCALES } from './locales';

export type Lang = 'de'|'en'|'es'|'fi'|'fr'|'hi'|'id'|'ja'|'ko'|'pl'|'pt'|'ru'|'tr'|'vi'|'zh'|'da';
export const LANGS: readonly Lang[] = ['de','en','es','fi','fr','hi','id','ja','ko','pl','pt','ru','tr','vi','zh','da'];
const LANG_SET = new Set<string>(LANGS);

export function normalizeLang(code: string | null | undefined): Lang {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  return (LANG_SET.has(base) ? base : 'en') as Lang;
}

export interface I18nOptions { language: string; isSocial?: boolean; messages?: Partial<Record<Lang, Record<string, string>>>; }
export interface I18n { readonly lang: Lang; t(src: string): string; }

export function createI18n(opts: I18nOptions): I18n {
  const lang = normalizeLang(opts.language);
  const t = (src: string): string => {
    if (lang === 'en') return opts.isSocial ? socialize(src) : src;
    return opts.messages?.[lang]?.[src] ?? LOCALES[lang]?.[src] ?? src;
  };
  return { lang, t };
}
```
Create both `locales.ts` with the empty `LOCALES` export above.

- [ ] **Step 4: Run, expect pass** — both test files green.

- [ ] **Step 5: Commit**
```bash
git add packages/pixi-shell/src/i18n.ts packages/pixi-shell/src/locales.ts packages/pixi-shell/tests/i18n.test.ts \
        packages/platform-core/src/shell/i18n.ts packages/platform-core/src/shell/locales.ts packages/platform-core/tests/shell-i18n.test.ts
git commit -m "feat(shell): i18n resolver (createI18n, normalizeLang) + empty locales"
```

---

## Task 2: Route shell `t` through the resolver + `setLanguage` + wrap stray strings

**Files:**
- Modify: `packages/pixi-shell/src/context.ts` (interface), `PixiGameShell.ts` (`t`, `setLanguage`)
- Modify: `packages/platform-core/src/shell/GameShell.ts` (`t`, `setLanguage`), `components/Settings.ts` (aria-label)
- Modify: `components/GameInfo.ts` in both (wrap control name/desc literals)
- Test: `packages/platform-core/tests/shell-language.test.ts`

**Interfaces — Consumes:** `createI18n` (Task 1). **Produces:** `host.t` now translates; `shell.setLanguage(lang: string): void` on both shells; `ShellHost.setLanguage?` added to `context.ts`.

- [ ] **Step 1: Failing test** (`packages/platform-core/tests/shell-language.test.ts`):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';

const base = () => ({
  mount: document.body, gameInfo: { sections: [] }, language: 'ru',
  currency: { symbol: '€', position: 'before' as const }, availableBets: [1,2], defaultBet: 1,
  currentBet: 1, balance: 100, win: 0, mode: 'base' as const,
  features: { turbo: 1 as const, buyBonus: false as const },
});

describe('shell language', () => {
  beforeEach(() => { document.body.innerHTML = ''; removeGameShell(); });
  it('translates a built-in label for the configured language', () => {
    const shell = createGameShell({ ...base(), language: 'ru' });
    expect(shell.t('Settings')).toBe('Настройки'); // requires Task 3 data; until then assert identity for 'en'
  });
  it('setLanguage swaps at runtime', () => {
    const shell = createGameShell({ ...base(), language: 'en' });
    expect(shell.t('Settings')).toBe('Settings');
    shell.setLanguage('ru');
    expect(shell.t('Settings')).toBe('Настройки');
  });
});
```
> Note: the `ru` assertions depend on Task 3 data. Until Task 3 lands, temporarily seed `LOCALES.ru = { Settings: 'Настройки' }` in this task's commit OR assert only the `en` identity + that `setLanguage` changes `host.t`'s resolved `lang`. Pick the identity-only assertions to keep Task 2 self-contained, and let Task 3 strengthen them.

- [ ] **Step 2: Run, expect fail** (`setLanguage` undefined).

- [ ] **Step 3: Implement.**
  - In `GameShell.ts`: replace `t(text){ return this.config.isSocial ? socialize(text) : text; }` with a cached resolver:
```ts
import { createI18n, type I18n } from './i18n';
private i18n: I18n = createI18n({ language: this.config.language, isSocial: this.config.isSocial });
t(text: string): string { return this.i18n.t(text); }
setLanguage(lang: string): void {
  this.config.language = lang;
  this.i18n = createI18n({ language: lang, isSocial: this.config.isSocial });
  this.render();
  // reopen the open modal so its strings refresh (mirror setSocial)
}
```
  (Update `setSocial` to also rebuild `this.i18n`.)
  - In `PixiGameShell.ts`/`context.ts`: same — store an `I18n`, `t` delegates, add `setLanguage`, add `setLanguage?(lang: string): void` to `ShellHost`.
  - Wrap the unwrapped strings: Pixi `GameInfo.ts:198-209` control `name`/`desc` already pass through `host.t()` at render (`ctlBlock` calls `host.t(r.name)`/`host.t(r.desc)`) — verify and, for the DOM shell, ensure control descriptions are wrapped likewise. Wrap `Settings.ts` `aria-label: 'Sound'` → `shell.t('Sound')`.

- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): route t() through resolver + setLanguage`.

---

## Task 3: Populate the 15 non-English translations + parity test

**Files:**
- Modify: `packages/pixi-shell/src/locales.ts`, `packages/platform-core/src/shell/locales.ts` (identical)
- Test: `packages/pixi-shell/tests/locales-parity.test.ts`, `packages/platform-core/tests/shell-locales.test.ts`

**Interfaces — Consumes:** `LOCALES` shape (Task 1). **Produces:** full `LOCALES` for 15 languages.

**String set to translate** (the complete chrome key list — gather by grepping `host.t(` / `shell.t(` across both shells' components; expected set):
`Settings, Sound, Master volume, Music, SFX, Game info, Modes, Controls, Paytable, Price, RTP, Max win, BUY BONUS, Buy bonus, Bet, Confirm, Start, Cancel, Activate, Buy, Menu, Close, Spin, Raise bet, Lower bet, Autoplay, Turbo, Paylines, Cluster pays, Pays anywhere, Ways to win, Winning shapes, Game, Menu & info`, plus the control descriptions (`Start a spin at the current bet.` …) and the Hotkeys-block labels added in Task 12 (add those in Task 12, not here).

- [ ] **Step 1: Failing parity + coverage test:**
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES } from '@/locales';
import { LANGS } from '@/i18n';

it('locales.ts is byte-identical across both shells', () => {
  const a = readFileSync(new URL('../../pixi-shell/src/locales.ts', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../../platform-core/src/shell/locales.ts', import.meta.url), 'utf8');
  expect(a).toBe(b);
});
it('every non-en language has translations', () => {
  for (const l of LANGS) if (l !== 'en') {
    expect(Object.keys(LOCALES[l] ?? {}).length, `missing ${l}`).toBeGreaterThan(20);
  }
});
it('a known label is translated in ru/de', () => {
  expect(LOCALES.ru?.Spin).toBeTruthy();
  expect(LOCALES.de?.Settings).toBeTruthy();
});
```
> The parity test's relative path must resolve from the test file location — adjust the `../../` prefix to the actual repo layout; verify it reads both real files.

- [ ] **Step 2: Run, expect fail** (empty `LOCALES`).
- [ ] **Step 3: Implement** — fill `LOCALES` for all 15 non-en languages for the full string set. Translations are machine-authored, flagged for native QA in a top-of-file comment. Keep entries ordered by key for diff stability. Copy the finished file verbatim into both locations.
- [ ] **Step 4: Run, expect pass** (parity + coverage + Task 2's `ru` assertions now hold — strengthen Task 2's test to assert `'Настройки'`).
- [ ] **Step 5: Commit** — `feat(shell): 15-language translations for built-in chrome + parity test`.

---

## Task 4: `KeyboardController` skeleton — relocate Space=spin, add guards & config toggle

**Files:**
- Create: `packages/pixi-shell/src/keyboard.ts`, `packages/platform-core/src/shell/keyboard.ts` (identical)
- Modify: both `types.ts` (`ShellFeatures.hotkeys?: boolean`); `PixiGameShell.ts` + `GameShell.ts` (construct controller, remove inline keydown)
- Test: `packages/platform-core/tests/keyboard.test.ts` (+ mirror in pixi-shell)

**Interfaces — Produces** (identical `keyboard.ts`):
```ts
import type { ShellState } from './types';
export interface KeyboardHost {
  readonly state: ShellState;
  readonly hotkeysEnabled: boolean;   // features.hotkeys !== false
  readonly spacebarEnabled: boolean;  // features.spacebar !== false
  readonly turboLevels: number;       // features.turbo
  readonly autoplayEnabled: boolean;  // features.autoplay != null
  readonly buyBonusEnabled: boolean;  // features.buyBonus !== false
  hasOpenLayer(): boolean;
  routeToLayer(e: KeyboardEvent): boolean; // give the key to the top layer's onKey; true if consumed
  spin(): void;
  stepBet(dir: 1 | -1): void;
  toggleAutoplay(): void;
  cycleTurbo(): void;
  openBuyBonus(): void;
  openInfo(): void;
  openMenu(): void;
  toggleMute(): void;
  closeLayer(): void;
}
export class KeyboardController {
  constructor(host: KeyboardHost, doc?: Document);
  attach(): void;
  detach(): void;
  notifyBusyChanged(busy: boolean): void;
}
```

This task implements ONLY: attach/detach, editable-focus guard, master/Space toggles, layer routing, and **Space → spin (single, on non-repeat)** to preserve today's behaviour. Hold logic is Task 5; other keys Task 6–7.

- [ ] **Step 1: Failing test** (mock host + fake document):
```ts
import { describe, it, expect, vi } from 'vitest';
import { KeyboardController, type KeyboardHost } from '@/shell/keyboard';
// (pixi mirror: '@/keyboard')

function mockHost(over: Partial<KeyboardHost> = {}): KeyboardHost {
  return {
    state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: false } as any,
    hotkeysEnabled: true, spacebarEnabled: true, turboLevels: 1, autoplayEnabled: true, buyBonusEnabled: true,
    hasOpenLayer: () => false, routeToLayer: () => false,
    spin: vi.fn(), stepBet: vi.fn(), toggleAutoplay: vi.fn(), cycleTurbo: vi.fn(),
    openBuyBonus: vi.fn(), openInfo: vi.fn(), openMenu: vi.fn(), toggleMute: vi.fn(), closeLayer: vi.fn(),
    ...over,
  };
}
const key = (init: Partial<KeyboardEvent>) => new KeyboardEvent('keydown', init as any);

describe('KeyboardController spin', () => {
  it('Space (no repeat) spins in base/idle', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(key({ code: 'Space' }));
    expect(h.spin).toHaveBeenCalledTimes(1); c.detach();
  });
  it('ignores Space when a layer is open (routes instead)', () => {
    const route = vi.fn(() => false);
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer: route });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(key({ code: 'Space' }));
    expect(route).toHaveBeenCalled(); expect(h.spin).not.toHaveBeenCalled(); c.detach();
  });
  it('respects spacebarEnabled=false and hotkeysEnabled=false', () => {
    const h1 = mockHost({ spacebarEnabled: false }); const c1 = new KeyboardController(h1, document); c1.attach();
    document.dispatchEvent(key({ code: 'Space' })); expect(h1.spin).not.toHaveBeenCalled(); c1.detach();
  });
  it('ignores keys when an editable element is focused', () => {
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    input.dispatchEvent(Object.assign(key({ code: 'Space' }), {})); // target is input
    expect(h.spin).not.toHaveBeenCalled(); c.detach(); input.remove();
  });
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement `keyboard.ts`** — `attach` adds `keydown`/`keyup` on `doc` (default `document`); editable-focus guard; if `host.hasOpenLayer()` → `host.routeToLayer(e)` then (if not consumed and `code==='Escape'`) `host.closeLayer()`, and return; else handle bar keys. For this task only Space:
```ts
if (e.code === 'Space' && !e.repeat) {
  if (!this.host.spacebarEnabled || !this.host.hotkeysEnabled) return;
  e.preventDefault();
  const s = this.host.state;
  if (s.mode !== 'base' || s.busy || s.autoplay.active) return;
  this.host.spin();
}
```
Add `ShellFeatures.hotkeys?: boolean` to both `types.ts`. Wire each shell: build a `KeyboardHost` from its context, `new KeyboardController(host).attach()` in the constructor (replacing the inline `handleKeyDown`/`onKeyDown` add), `detach()` in destroy. `host.spin = () => this.emit('spin')`. `host.routeToLayer`/`hasOpenLayer`/`closeLayer` map to the shell's layer state (Pixi `currentLayer`, DOM `modalHost`). Leave `notifyBusyChanged` a no-op stub for now.

- [ ] **Step 4: Run, expect pass** (controller tests + existing shell tests still green).
- [ ] **Step 5: Commit** — `feat(shell): extract KeyboardController (Space→spin parity) + features.hotkeys`.

---

## Task 5: Hold-to-spin (continuous, gated on busy, 120 ms floor)

**Files:** Modify both `keyboard.ts`; wire `setBusy` → `notifyBusyChanged` in `PixiGameShell.ts` + `GameShell.ts`. Test: extend `keyboard.test.ts`.

**Interfaces — Consumes:** Task 4 controller. **Produces:** held-Space behaviour; both shells call `controller.notifyBusyChanged(busy)` inside `setBusy`.

- [ ] **Step 1: Failing test** (fake timers):
```ts
it('held Space re-fires after spin completes, respecting the 120ms floor', () => {
  vi.useFakeTimers();
  const state: any = { mode: 'base', busy: false, autoplay: { active: false }, };
  const h = mockHost({ state, spin: vi.fn(() => { state.busy = true; }) });
  const c = new KeyboardController(h, document); c.attach();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));   // spin #1, busy=true
  expect(h.spin).toHaveBeenCalledTimes(1);
  state.busy = false; c.notifyBusyChanged(false);                            // completes immediately
  vi.advanceTimersByTime(119); expect(h.spin).toHaveBeenCalledTimes(1);       // floor not reached
  vi.advanceTimersByTime(2);  expect(h.spin).toHaveBeenCalledTimes(2);        // spin #2 after 120ms
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));      // release
  state.busy = false; c.notifyBusyChanged(false);
  vi.advanceTimersByTime(200); expect(h.spin).toHaveBeenCalledTimes(2);       // no more after release
  c.detach(); vi.useRealTimers();
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — track `spaceHeld` (set on Space keydown, clear on Space keyup), `lastSpinAt` (timestamp via `performance.now()`/`Date.now()` — but tests use fake timers; use an injectable `now()` defaulting to `() => Date.now()`, or schedule via `setTimeout` with the floor). Simplest fake-timer-friendly approach: in `notifyBusyChanged(false)`, if `spaceHeld` and allowed, `setTimeout(() => { if (spaceHeld && allowed) host.spin() }, max(0, 120 - sinceLast))`. Track `lastSpinAt` from a `setTimeout`-driven clock is fiddly; instead always `setTimeout(fire, 120)` from completion (the floor is the gap between completion and next spin) — matches the test. Clear pending timer on keyup/detach.

- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): hold-Space continuous spin gated on busy (120ms floor)`.

---

## Task 6: Hold-to-step bet (`Shift`+arrows/`=`/`-`, repeat with acceleration)

**Files:** Modify both `keyboard.ts`; `host.stepBet` already provided. Test: extend `keyboard.test.ts`.

**Interfaces — Consumes:** Task 4. **Produces:** bet keys with hold-repeat.

- [ ] **Step 1: Failing test:**
```ts
it('Shift+ArrowUp steps bet once on press, then repeats after 350ms', () => {
  vi.useFakeTimers();
  const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', shiftKey: true }));
  expect(h.stepBet).toHaveBeenCalledWith(1); expect(h.stepBet).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(349); expect(h.stepBet).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);   expect(h.stepBet).toHaveBeenCalledTimes(2);  // first repeat at 350ms
  vi.advanceTimersByTime(90);  expect(h.stepBet).toHaveBeenCalledTimes(3);  // then every 90ms
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
  vi.advanceTimersByTime(500); expect(h.stepBet).toHaveBeenCalledTimes(3);
  c.detach(); vi.useRealTimers();
});
it('ArrowUp WITHOUT shift does not step bet on the bar', () => {
  const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
  expect(h.stepBet).not.toHaveBeenCalled(); c.detach();
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — map bet-up = `{ ArrowUp(shift), Equal(shift), NumpadAdd }`, bet-down = `{ ArrowDown(shift), Minus(shift), NumpadSubtract }`. On keydown (non-repeat) for a bet key, guard (`base`, `!busy`, no layer, `hotkeysEnabled`), call `host.stepBet(dir)`, start a repeat timer: `setTimeout(firstRepeat, 350)` then `setInterval`-like chain decreasing from 90ms toward 45ms after ~1s. Track the active bet key; keyup of that key (or window blur) clears timers. (Use a recursive `setTimeout` so the interval can accelerate.)

- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): hold-to-step bet via Shift+arrows/=/- with acceleration`.

---

## Task 7: Remaining hotkeys (`Shift`+A/T/B/I/S/M, `Esc`) + mute event

**Files:** Modify both `keyboard.ts`; provide `host.toggleAutoplay/cycleTurbo/openBuyBonus/openInfo/openMenu/toggleMute` from each shell. Test: extend `keyboard.test.ts`.

**Interfaces — Consumes:** Task 4 host methods. **Produces:** full bar hotkey scheme. `toggleMute` emits `settingChange({ key: 'muted', value: 'toggle' })`.

- [ ] **Step 1: Failing tests** — for each: `Shift+A`→`toggleAutoplay` (when `autoplayEnabled`), `Shift+T`→`cycleTurbo` (when `turboLevels>0`), `Shift+B`→`openBuyBonus` (when `buyBonusEnabled`, base), `Shift+I`→`openInfo`, `Shift+S`→`openMenu`, `Shift+M`→`toggleMute`; and that the **non-Shift** letters do nothing; and that play actions are inert when `state.replay` is true.
```ts
it('Shift+A toggles autoplay; bare A does nothing', () => {
  const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
  expect(h.toggleAutoplay).not.toHaveBeenCalled();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', shiftKey: true }));
  expect(h.toggleAutoplay).toHaveBeenCalledTimes(1); c.detach();
});
it('replay mode makes play hotkeys inert', () => {
  const h = mockHost({ state: { ...mockHost().state, replay: true } as any });
  const c = new KeyboardController(h, document); c.attach();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
  expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** the `Shift`+letter switch with per-action feature/mode guards; `Escape` (no layer open) is a no-op on the bar. Wire host methods in both shells: `toggleAutoplay` = existing autoplay open/stop logic; `cycleTurbo` = `nextTurbo` + emit `turboChange`; `openBuyBonus`/`openInfo`/`openMenu` = existing open methods; `toggleMute` = `this.emit('settingChange', { key: 'muted', value: 'toggle' })`.

- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): full Shift-based hotkey scheme`.

---

## Task 8: `ShellLayer.onKey` contract + controller routing to the top layer

**Files:** Modify Pixi `context.ts` (`ShellLayer.onKey?`), `PixiGameShell.ts` (`routeToLayer` → `currentLayer.onKey`); DOM `GameShell.ts` (modal key stack + `routeToLayer`). Test: `packages/platform-core/tests/shell-modal-keys.test.ts`.

**Interfaces — Produces:** `interface ShellLayer { …; onKey?(e: KeyboardEvent): boolean; }` (Pixi). DOM: each opened modal registers `{ el, onKey? }`; `GameShell.routeToLayer` calls the top entry's `onKey`. Controller already calls `host.routeToLayer` (Task 4); now it returns the layer's verdict, and on unconsumed `Escape` the controller calls `host.closeLayer()`.

- [ ] **Step 1: Failing test** — open a modal whose `onKey` consumes `ArrowDown`; assert a bar action does NOT fire while it's open, and that `Escape` closes it when unconsumed. (DOM shell is constructible in jsdom.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** routing both shells. Pixi: `routeToLayer(e){ return this.currentLayer?.onKey?.(e) ?? false; }`. DOM: maintain `private modalStack: { el: HTMLElement; onKey?: (e: KeyboardEvent)=>boolean }[]`; push on open / pop on close; `routeToLayer` → top `onKey`. Controller: after `routeToLayer` returns false and `e.code==='Escape'`, call `host.closeLayer()` and `preventDefault`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): ShellLayer.onKey routing to top layer`.

---

## Task 9: Keyboard nav in bet/autoplay pickers

**Files:** Modify both `components/pickers.ts`. Test: `packages/platform-core/tests/picker-keys.test.ts`.

**Interfaces — Consumes:** `onKey` (Task 8), `buildSheet`. **Produces:** pickers implement `onKey`: `←/→/↑/↓`/`+`/`-` move highlight; `Enter`/`Space` confirm; `Esc` cancel.

- [ ] **Step 1: Failing test** — open the autoplay picker, dispatch arrows to move the highlight, `Enter` to confirm; assert `autoplayStart` fired with the highlighted count. (DOM shell.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — give `buildSheet` a `focusIndex` (init to the selected chip), expose `onKey` on the returned modal/layer that: arrow/`+`/`-` → move `focusIndex` across `opts.choices` (clamp), update chip visuals via existing `setSelected`, set `selected`; `Enter`/`Space` → run the confirm action; `Esc` → close. Mirror in both shells (Pixi `CardModal` returns a `ShellLayer`; DOM modal registers its `onKey`).
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): keyboard navigation in bet/autoplay pickers`.

---

## Task 10: Buy Bonus two-phase keyboard nav

**Files:** Modify both `components/BuyBonus.ts`. Test: `packages/platform-core/tests/buybonus-keys.test.ts`.

**Interfaces — Consumes:** `onKey` (Task 8). **Produces:** `BuyBonusOverlay.onKey` driving browse + confirm phases.

- [ ] **Step 1: Failing test** — open Buy Bonus with ≥2 options; `→` moves card focus; `Enter` opens confirm; `Enter` again emits `buyBonusSelect` with the focused bonus id; `Esc` from confirm returns to browse. (DOM shell.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — add `focusIndex` over affordable cards; reuse the hover/outline visual as the focus ring (`BonusCard.drawBg` hovered state / DOM `:hover` class toggled programmatically). `onKey`: if `this.confirm` set → `Enter`=Buy/Activate (same handler as the accent button), `Esc`=`removeConfirm`; else → `←/→` (mobile `↑/↓`) move focus, `+/-` step bet footer, `Enter`=`openConfirm(focused)`, `Esc`=close. Both shells.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): two-phase keyboard nav for Buy Bonus`.

---

## Task 11: Overlay scroll via keyboard (`ScrollBox.scrollBy` + Game Info `onKey`)

**Files:** Modify Pixi `primitives/overlay.ts`, `primitives/scroll.ts`; DOM overlay/scroll equivalent. Test: `packages/pixi-shell/tests/overlay-scroll.test.ts` (unit on `ScrollBox`) + DOM overlay test.

**Interfaces — Produces:** `ScrollBox.scrollBy(dy: number, animated?: boolean): void`; `Overlay.onKey` mapping `↑/↓` (line, hold-repeat), `PageUp/PageDown`, `Space`/`Shift+Space`, `Home/End`.

- [ ] **Step 1: Failing test** — `ScrollBox.scrollBy(60)` moves content offset by 60 clamped to `[−maxScroll, 0]`; `Home/End` jump to bounds.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `scrollBy` (reuse the wheel/drag offset + clamp) and `Overlay.onKey` calling it; `↑/↓`≈60px, `PageUp/Down`≈0.9×viewport, `Space`/`Shift+Space` page, `Home/End` to bounds; return true when consumed. DOM: set `scrollTop` on the scroll container equivalently.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(shell): keyboard scrolling in overlays (Game Info)`.

---

## Task 12: Hotkeys legend — `'hotkeys'` Game Info section (auto-injected, feature-aware, localized)

**Files:** Modify both `types.ts` (section type), `components/GameInfo.ts` (`sectionHotkeys`, auto-inject in `buildBody`); add legend strings to `locales.ts` (both) + parity. Test: `packages/platform-core/tests/hotkeys-section.test.ts`.

**Interfaces — Consumes:** `t()` (Task 2), translations (Task 3). **Produces:** `GameInfoSection` union gains `{ type: 'hotkeys'; title?: string; order?: number }`; `buildBody` injects one when `features.hotkeys !== false` and none is present.

- [ ] **Step 1: Failing test** — with `features.hotkeys` default and `turbo: 0`, the Game Info DOM contains a Hotkeys block, includes the Spin/Bet/Info rows, and OMITS the Turbo row; with `features.hotkeys: false`, no Hotkeys block.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — extend the section union; in `buildBody`, after sorting, splice a synthetic `{ type: 'hotkeys' }` right after `controls` (or at its default order) unless the game already supplied one and unless `features.hotkeys === false`. Implement `sectionHotkeys(host, title, width)` rendering keycap chips → localized action name, filtering rows by enabled features (Turbo iff `turbo>0`, Buy iff `buyBonus!==false`, Autoplay iff `autoplay!=null`). Localize the action labels and the keycap legend strings; add them to `locales.ts` (both) and to the Task 3 string set; re-run parity. Follow the existing `ctlBlock`/`section` render pattern (`GameInfo.ts:217`).
- [ ] **Step 4: Run, expect pass** (+ parity still green).
- [ ] **Step 5: Commit** — `feat(shell): Hotkeys legend section in Game Info`.

---

## Task 13: Game-content i18n at the host (merged catalog + spec-string resolution)

**Files:** Modify `packages/game-engine/src/host/shellConfig.ts` (~line 348, the `t`); add `i18n` to the `createSlotGame` config type. Test: `packages/game-engine/tests/host-i18n.test.ts`.

**Interfaces — Consumes:** `createI18n` (re-exported from the shell the host already imports). **Produces:** `createSlotGame({ i18n?: Partial<Record<Lang, Record<string,string>>> })`; the host resolves `gameInfo(t)`, bonus `title`/`description`, mode titles, and symbol names through the merged resolver before constructing shell config.

- [ ] **Step 1: Failing test** — build host shell config for a game with `language:'ru'`, `i18n.ru = { 'How to Play': 'Как играть', 'BUY BONUS': 'КУПИТЬ' }`; assert the resolved `gameInfo` section title and the bonus title come out Russian.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — replace `const t = isSocial ? socialize : (s)=>s` with `const t = createI18n({ language, isSocial, messages: gameConfig.i18n }).t` (merging built-in `LOCALES` automatically); apply `t` to the spec-derived strings (`title`/`description`/symbol names) before passing them into shell config; thread `language` from `initData`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(game-engine): per-game i18n map + spec-string localization`.

---

## Task 14: Harness language selector

**Files:** Modify the Stake harness control-bar UI in `packages/stake-kit/` (the bar component that consumes `harness/bar.ts`). Test: `packages/stake-kit/tests/harness-lang.test.ts` (or extend existing harness test).

**Interfaces — Consumes:** `LANGS`, `buildLaunchUrl` (`harness/bar.ts`). **Produces:** a language `<select>` (16 options) that updates the launch `lang` and reloads/relaunches the iframe.

- [ ] **Step 1: Failing test** — the harness bar renders a language select with 16 options; changing it rebuilds the launch URL with the new `lang`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — add the dropdown to the bar UI; on change, set the `lang` used by `buildLaunchUrl` and re-navigate the iframe (mirror how `currency`/`social` toggles already work). Keep `harness/bar.ts` pure (logic only).
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(stake-kit): harness language selector (16 langs)`.

---

## Task 15: Scaffold generates `src/i18n.ts` + wiring + docs

**Files:** Create `packages/create-slot/src/codegen/i18nTs.ts`; modify `src/generate.ts` (emit the file), `src/codegen/mainTs.ts` (import + pass `i18n`), `src/codegen/claudeMd.ts` (doc the workflow). Test: `packages/create-slot/tests/generate-i18n.test.ts`.

**Interfaces — Consumes:** the `createSlotGame.i18n` field (Task 13). **Produces:** generated project has `src/i18n.ts` (`en` populated from the spec, other 15 stubbed) wired into `createSlotGame`.

- [ ] **Step 1: Failing test** — run `generate()` into a temp dir; assert `src/i18n.ts` exists, exports an `i18n` object with an `en` map and 15 stub language keys, and that generated `main.ts` imports and passes it to `createSlotGame`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — `i18nTs.ts` emits an `i18n` map: `en` filled from the spec's player-facing strings (action titles/descriptions, gameInfo copy) and the other 15 languages as empty objects with a `// TODO: translate` header comment. Register it in `generate()` (mirror the other codegen modules). Add the import + `i18n` field in `mainTs.ts`'s `createSlotGame({ … })`. Add a "Localization — how to add a language" section to the generated `CLAUDE.md`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(create-slot): generate src/i18n.ts skeleton + wiring + docs`.

---

## Final verification (after Task 15)

- [ ] `npm run typecheck` — clean across workspaces.
- [ ] `npm test` — all packages green (incl. both `locales.ts`/`keyboard.ts` parity tests).
- [ ] `npm run lint` — clean.
- [ ] Manual smoke (per the `examples-consume-built-dist` memory: rebuild platform-core + `--force` Vite): launch an example, switch language in the harness, hold Space to chain spins, hold `Shift+↑` to ramp bet, open Game Info and scroll with `↑/↓`/`PageDown`, open Buy Bonus and drive it with `←/→`/`Enter`, confirm the Hotkeys block renders.
```

