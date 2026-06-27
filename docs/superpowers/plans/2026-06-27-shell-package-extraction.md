# Shell Package Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@energy8platform/shell` — one renderer-agnostic logic core (`ShellController`) driving two pluggable renderers (`ui/html`, `ui/pixi`) behind a stable `ShellRenderer` contract, wired into `shell-demo` and `pixi-shell-demo`.

**Architecture:** Layered controller → host → renderer. `ShellController` owns ALL logic (state, events, keyboard, i18n, format, theme tokens, bet/turbo stepping, overlay flow, buy-bonus pricing, key routing) and the game-facing public API. A renderer implements `ShellRenderer` (mount/renderBar/setLayout/applyTheme/animateMoney/openOverlay/closeOverlay/destroy) and reads the brain through `ShellHost` (+ a renderer-local component context). Display nodes (`HTMLElement`/`Container`) never leak into core. A new renderer cannot break bet/state logic — it only draws and reports input via `host.actions.*`.

**Tech Stack:** TypeScript ~5.6 (ESM), Rollup (multi-subpath bundles), Vitest 2.0, jsdom; PixiJS v8 (optional peer, only for `/pixi`).

**Spec:** [docs/superpowers/specs/2026-06-27-shell-package-extraction-design.md](../specs/2026-06-27-shell-package-extraction-design.md)

## Global Constraints

- **Do NOT modify** `packages/platform-core/src/shell`, `packages/pixi-shell`, or `packages/game-engine`. The new package is additive; old packages stay and keep their tests.
- **Byte-identical rendered output.** Each renderer must emit the SAME DOM (class names, `data-ge` attrs, structure) / Pixi tree as its origin, so the migrated test suites pass unchanged. The migrated tests are the behavioral spec.
- **Logic lives ONLY in core.** Components/renderers must NOT mutate `state`, call `stepBet`/`nextTurbo`, or `emit` directly — they call `host.actions.*`. Moving this inline logic into the controller IS the UI/logic separation.
- **No node types in core.** `core/` must not import `pixi.js` or reference `HTMLElement`/`Container` in the controller or contract (except where a type is generic over a renderer node in `types.ts`, parameterized away from core).
- **Drop-in names preserved:** `createGameShell`/`createPixiShell` signatures and the type names `GameShell`, `PixiGameShell`, `ShellMode`, `ShellConfig`, etc. remain exported so examples change only the import path.
- **`pixi.js`** is an optional peer dependency, external in the `/pixi` bundle only.
- Comments and identifiers in English (match repo conventions).
- Source-of-truth for ports: the exact files in `platform-core/src/shell/**` (HTML) and `pixi-shell/src/**` (Pixi). "Copy" means copy that file's current content verbatim, then apply the listed transforms.

---

## Phase 0 — Scaffold

### Task 1: Create the package skeleton + workspace wiring

**Files:**
- Create branch `feat/shell-package`
- Create: `packages/shell/package.json`
- Create: `packages/shell/tsconfig.json`
- Create: `packages/shell/rollup.config.mjs`
- Create: `packages/shell/vitest.config.ts`
- Create: `packages/shell/scripts/gen-version.mjs`
- Create: `packages/shell/src/core/index.ts` (temporary stub)
- Create: `packages/shell/src/ui/html/index.ts` (temporary stub)
- Create: `packages/shell/src/ui/pixi/index.ts` (temporary stub)

**Interfaces:**
- Produces: workspace package `@energy8platform/shell` with subpath build targets `index` (core), `html`, `pixi`.

- [ ] **Step 1: Branch off main**

```bash
git checkout -b feat/shell-package
```

- [ ] **Step 2: Write `packages/shell/package.json`**

```jsonc
{
  "name": "@energy8platform/shell",
  "version": "0.1.0",
  "description": "Energy8 branded game shell — one logic core, pluggable html/pixi renderers behind a stable contract.",
  "type": "module",
  "main": "./dist/index.cjs.js",
  "module": "./dist/index.esm.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":      { "import": "./dist/index.esm.js", "require": "./dist/index.cjs.js", "types": "./dist/index.d.ts" },
    "./html": { "import": "./dist/html.esm.js",  "require": "./dist/html.cjs.js",  "types": "./dist/html.d.ts" },
    "./pixi": { "import": "./dist/pixi.esm.js",  "require": "./dist/pixi.cjs.js",  "types": "./dist/pixi.d.ts" }
  },
  "files": ["dist", "src"],
  "scripts": {
    "gen-version": "node scripts/gen-version.mjs",
    "prebuild": "npm run gen-version",
    "build": "rollup -c rollup.config.mjs",
    "dev": "rollup -c rollup.config.mjs -w",
    "lint": "eslint src/ --ext .ts",
    "format": "prettier --write \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "pretest": "npm run gen-version",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": { "pixi.js": "^8.16.0" },
  "peerDependenciesMeta": { "pixi.js": { "optional": true } },
  "devDependencies": {
    "@rollup/plugin-typescript": "^12.1.0",
    "@types/node": "^25.6.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "jsdom": "^25.0.1",
    "pixi.js": "^8.16.0",
    "rollup": "^4.24.0",
    "rollup-plugin-dts": "^6.1.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "keywords": ["casino", "energy8", "game-shell", "pixijs", "dom", "igaming"],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/energy8platform/game-engine.git", "directory": "packages/shell" }
}
```

- [ ] **Step 3: Write `packages/shell/tsconfig.json`** (mirror `packages/pixi-shell/tsconfig.json`, with `@/*` → `src/*`)

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `packages/shell/scripts/gen-version.mjs`** (copy `packages/platform-core/scripts/gen-version.mjs` if present; else this)

```js
// Stamp src/core/version.ts from package.json "version".
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const out = `// AUTO-GENERATED by scripts/gen-version.mjs — do not edit. Mirrors package.json "version".
/** The @energy8platform/shell package version, stamped into the game-info footer. */
export const PACKAGE_VERSION = '${pkg.version}';
`;
writeFileSync(join(here, '..', 'src', 'core', 'version.ts'), out);
console.log(`shell: wrote version.ts (${pkg.version})`);
```

- [ ] **Step 5: Write `packages/shell/rollup.config.mjs`**

```js
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';

function bundle(input, name, external = []) {
  return [
    {
      input, external,
      output: [
        { file: `dist/${name}.esm.js`, format: 'esm', sourcemap: true },
        { file: `dist/${name}.cjs.js`, format: 'cjs', sourcemap: true },
      ],
      plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false })],
    },
    { input, external, output: { file: `dist/${name}.d.ts`, format: 'esm' }, plugins: [dts()] },
  ];
}

export default defineConfig([
  ...bundle('src/core/index.ts', 'index'),
  ...bundle('src/ui/html/index.ts', 'html'),
  ...bundle('src/ui/pixi/index.ts', 'pixi', ['pixi.js']),
]);
```

- [ ] **Step 6: Write `packages/shell/vitest.config.ts`** (mirror pixi-shell; jsdom + `@/*` alias)

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 7: Write the three temporary stub entries** so the build graph resolves.

`src/core/index.ts`:
```ts
export const __shell_core_stub = true;
```
`src/ui/html/index.ts`:
```ts
export const __shell_html_stub = true;
```
`src/ui/pixi/index.ts`:
```ts
export const __shell_pixi_stub = true;
```

- [ ] **Step 8: Install + verify the workspace links**

Run: `npm install`
Expected: completes; `@energy8platform/shell` symlinked under `node_modules/@energy8platform/`.

- [ ] **Step 9: Verify build + typecheck on the stub**

Run: `npm run build --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: gen-version writes `src/core/version.ts`; three bundles emit to `dist/`; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add packages/shell .gitignore
git commit -m "feat(shell): scaffold @energy8platform/shell package (core/html/pixi build targets)"
```

---

## Phase 1 — Core logic (renderer-agnostic)

### Task 2: Port the byte-identical logic files + their pure tests

**Files:**
- Create: `packages/shell/src/core/EventEmitter.ts` ← copy `packages/platform-core/src/EventEmitter.ts`
- Create: `packages/shell/src/core/colors.ts` ← copy `packages/platform-core/src/shell/colors.ts`
- Create: `packages/shell/src/core/fonts.ts` ← copy `packages/platform-core/src/shell/fonts.ts`
- Create: `packages/shell/src/core/format.ts` ← copy `packages/platform-core/src/shell/format.ts`
- Create: `packages/shell/src/core/state.ts` ← copy `packages/platform-core/src/shell/state.ts`
- Create: `packages/shell/src/core/i18n.ts` ← copy `packages/platform-core/src/shell/i18n.ts`
- Create: `packages/shell/src/core/locales.ts` ← copy `packages/platform-core/src/shell/locales.ts`
- Create: `packages/shell/src/core/keyboard.ts` ← copy `packages/platform-core/src/shell/keyboard.ts`
- Test: `packages/shell/tests/core/format.test.ts`, `state.test.ts`, `i18n.test.ts`, `locales.test.ts`, `keyboard.test.ts`

**Interfaces:**
- Produces: `formatCurrency`, `createInitialState`, `stepBet`, `nextTurbo`, `createI18n`, `socialize`, `normalizeLang`, `KeyboardController`, `KeyboardHost`, `EventEmitter`, `effectiveAccent`, `contrastText` — same signatures as the platform-core originals.

- [ ] **Step 1: Copy the 8 source files** verbatim into `src/core/`. These are byte-identical between html and pixi shells; copy from platform-core. Fix only internal relative imports (e.g. `from '../EventEmitter'` → `from './EventEmitter'`; `state.ts` imports `ShellConfig`/`ShellState` from `./types` — that file lands in Task 4, so this task will not typecheck standalone; that is expected and resolved by Task 4. Order: do Step 1–2 here, run tests after Task 4 if needed, OR temporarily import types from a local `./types` stub. To keep this task green on its own, add the minimal `./types` re-export stub described in Step 2.)

- [ ] **Step 2: Add a minimal `src/core/types.ts` stub** so `state.ts`/`i18n.ts`/`keyboard.ts` typecheck now (fully written in Task 4). Include exactly the symbols these files import: `ShellState`, `ShellConfig`, `ShellMode`, `AutoplayOptions`, `FreeSpinsState`, `BonusOption`, `ShellFeatures`, `CurrencyConfig`. Copy these type declarations verbatim from `packages/platform-core/src/shell/types.ts` (the renderer-agnostic subset — everything EXCEPT `ShellConfig.mount` and the `HTMLElement` references; for `ShellConfig`, copy it but drop the `mount: HTMLElement` line). Task 4 replaces this file with the full merged contract.

- [ ] **Step 3: Copy the pure tests**, retargeting imports to the new package paths (`@/core/...`). Copy these files verbatim and change their import specifiers:
  - `packages/platform-core/tests/shell/format.test.ts` → `tests/core/format.test.ts`
  - `packages/platform-core/tests/shell/state.test.ts` → `tests/core/state.test.ts`
  - `packages/platform-core/tests/shell/i18n.test.ts` → `tests/core/i18n.test.ts`
  - `packages/platform-core/tests/shell-locales.test.ts` → `tests/core/locales.test.ts`
  - `packages/platform-core/tests/shell/keyboard.test.ts` → `tests/core/keyboard.test.ts`
  Replace any import from `@/shell/...` or `../../src/shell/...` with `@/core/...`.

- [ ] **Step 4: Run the core tests to verify they pass**

Run: `npm test --workspace @energy8platform/shell -- tests/core`
Expected: PASS for format, state, i18n, locales, keyboard. (Byte-identical logic ⇒ identical behavior.)

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/core packages/shell/tests/core
git commit -m "feat(shell): port renderer-agnostic core logic (state, i18n, locales, keyboard, format) + tests"
```

### Task 3: Core theme + motion (shared data, no renderer emit)

**Files:**
- Create: `packages/shell/src/core/theme.ts`
- Create: `packages/shell/src/core/motion.ts`
- Test: `packages/shell/tests/core/theme.test.ts`, `packages/shell/tests/core/motion.test.ts`

**Interfaces:**
- Consumes: `ThemeConfig` (from types stub / Task 4).
- Produces: `SCHEMES`, `DEFAULT_ACCENT`, `resolveTheme(theme?: ThemeConfig): ShellTokens`, `ShellTokens` (interface), `prefersReducedMotion(): boolean`, `easeOutCubic`, `easeInOutQuad`.

- [ ] **Step 1: Write `src/core/theme.ts`** = the pixi shell's `theme.ts` (it already produces a `ShellTokens` object, which is the renderer-agnostic form). Copy `packages/pixi-shell/src/theme.ts` verbatim. (The DOM CSS-var emission becomes `ui/html/theme-css.ts` in Task 8 — NOT here.)

- [ ] **Step 2: Write `src/core/motion.ts`** = the renderer-agnostic motion bits only: `prefersReducedMotion`, `easeOutCubic`, `easeInOutQuad`. Copy these three from `packages/pixi-shell/src/motion.ts` but DROP the Pixi `tween`/`countUpText` (those go to `ui/pixi/motion-pixi.ts`) and DROP the `import type { Text, Ticker }` / `setText` import. The file must not import `pixi.js`.

```ts
/** True when the user (or environment) prefers no motion. Missing matchMedia (jsdom/SSR) is
 *  treated as reduced so animations never block. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true;
  return mm('(prefers-reduced-motion: reduce)').matches;
}
export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
export const easeInOutQuad = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
```

- [ ] **Step 3: Write `tests/core/theme.test.ts`** by copying `packages/platform-core/tests/shell/theme.test.ts` and adapting assertions to the object form: where the DOM test checks the CSS-var string (`--shell-fg: ...`), assert the corresponding `ShellTokens` field (`resolveTheme({scheme:'dark'}).fg`). Concretely:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTheme, DEFAULT_ACCENT } from '@/core/theme';

describe('resolveTheme', () => {
  it('defaults to the dark scheme palette', () => {
    const t = resolveTheme();
    expect(t.fg).toBeTruthy();
    expect(t.accent).toBe(DEFAULT_ACCENT);
  });
  it('applies a game accent override', () => {
    expect(resolveTheme({ accent: '#ff0000' }).accent).toBe('#ff0000');
  });
  it('keeps plaque tokens scheme-independent', () => {
    expect(resolveTheme({ scheme: 'dark' }).plaqueDark).toBe(resolveTheme({ scheme: 'light' }).plaqueDark);
  });
});
```

- [ ] **Step 4: Write `tests/core/motion.test.ts`** by copying the reduced-motion assertions from `packages/platform-core/tests/shell/motion.test.ts` (only the `prefersReducedMotion` cases; the count-up cases move to the renderer motion tests).

```ts
import { describe, it, expect } from 'vitest';
import { prefersReducedMotion, easeOutCubic } from '@/core/motion';

describe('prefersReducedMotion', () => {
  it('treats a missing matchMedia (jsdom) as reduced', () => {
    const orig = (globalThis as any).matchMedia;
    (globalThis as any).matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(true);
    (globalThis as any).matchMedia = orig;
  });
});
describe('easeOutCubic', () => {
  it('is 0 at 0 and 1 at 1', () => { expect(easeOutCubic(0)).toBe(0); expect(easeOutCubic(1)).toBe(1); });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test --workspace @energy8platform/shell -- tests/core/theme tests/core/motion`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/core/theme.ts packages/shell/src/core/motion.ts packages/shell/tests/core/theme.test.ts packages/shell/tests/core/motion.test.ts
git commit -m "feat(shell): core theme tokens (resolveTheme) + reduced-motion helpers + tests"
```

### Task 4: Core types — merge the shared shell contract

**Files:**
- Modify/replace: `packages/shell/src/core/types.ts` (replaces the Task-2 stub)

**Interfaces:**
- Produces: `ShellMode`, `ShellFeatures`, `ShellState`, `ShellEvents`, `BonusOption`, `BonusCardContext`, `CurrencyConfig`, `ThemeConfig`, `GameInfoContent`, `GameInfoSection`, `AutoplayOptions`, `FreeSpinsState`, `ModalOptions`, `ReplayModalOptions`, `ShellConfig`, `ResolvedShellConfig`.

- [ ] **Step 1: Build `types.ts` from the shared contract.** Start from `packages/platform-core/src/shell/types.ts` (it is the renderer-agnostic source of truth). Copy it verbatim, then make these edits:
  - Remove `mount: HTMLElement;` from `ShellConfig` (the mount target is a renderer-config concern; `ResolvedShellConfig` below has no mount).
  - For `BonusOption.custom` and `GameInfoSection`'s `custom.node`, change the renderer node type from `HTMLElement` to a generic parameter so core stays node-free. Define:
    ```ts
    /** A renderer-supplied display node. Parameterized so core never references HTMLElement/Container.
     *  ui/html binds TNode = HTMLElement; ui/pixi binds TNode = import('pixi.js').Container. */
    // In core, custom renderers receive `unknown` and cast; each renderer re-exports a typed alias.
    ```
    Concretely: type `BonusOption.custom?: (ctx: BonusCardContext) => unknown;` and `GameInfoSection` custom: `{ type: 'custom'; title?: string; order?: number; node?: unknown; html?: string }`. Each UI package re-exports a typed `BonusOption`/`GameInfoSection` narrowing `unknown` to its node type (Task 10 / Task 14).
  - Add `ResolvedShellConfig` = `ShellConfig` with defaults applied (all optional fields made required where the controller fills them):
    ```ts
    /** ShellConfig after the controller applies defaults (version, isSocial, replay, theme). No mount. */
    export type ResolvedShellConfig = Required<Pick<ShellConfig,
      'language' | 'currency' | 'availableBets' | 'defaultBet' | 'balance' | 'win' | 'mode' | 'features' | 'gameInfo' | 'version' | 'isSocial' | 'replay'>>
      & Pick<ShellConfig, 'currentBet' | 'theme' | 'onBonusBuy'>;
    ```
- [ ] **Step 2: Verify core typechecks now** (state/i18n/keyboard resolve their type imports against the real contract).

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean (core only; ui/* still stubs).

- [ ] **Step 3: Re-run core tests** (no behavior change expected):

Run: `npm test --workspace @energy8platform/shell -- tests/core`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/core/types.ts
git commit -m "feat(shell): merge the shared renderer-agnostic shell contract into core/types"
```

### Task 5: The renderer contract

**Files:**
- Create: `packages/shell/src/core/renderer.ts`

**Interfaces:**
- Consumes: types from `core/types.ts`, `ShellTokens` from `core/theme.ts`, `EventEmitter` from `core/EventEmitter.ts`.
- Produces: `ShellRenderer`, `ShellHost`, `ShellActions`, `OverlayRequest`, `OverlayHandle`, `ShellLayoutMode`.

- [ ] **Step 1: Write `src/core/renderer.ts`**

```ts
import type { EventEmitter } from './EventEmitter';
import type { ShellTokens } from './theme';
import type {
  ResolvedShellConfig, ShellState, ShellEvents, BonusOption,
  ModalOptions, ReplayModalOptions,
} from './types';

export type ShellLayoutMode = 'wide' | 'mobile';

/** The view side the controller drives. A renderer holds its own mount target (DOM element /
 *  Pixi app) and translates state → pixels; it never owns logic. */
export interface ShellRenderer {
  /** Bind to the brain. Called once during createShell, before the first renderBar. */
  mount(host: ShellHost): void;
  /** (Re)build the bottom bar from host.state. MUST cancel any in-flight money count-up first. */
  renderBar(): void;
  /** Switch bar layout. The controller derives wide|mobile from host.notifyResize. */
  setLayout(layout: ShellLayoutMode): void;
  /** Apply colour tokens (CSS vars in DOM / repaint in Pixi). */
  applyTheme(tokens: ShellTokens): void;
  /** Count a money readout from→to on the freshly-rendered bar (DOM rAF / Pixi ticker). */
  animateMoney(field: 'balance' | 'win', from: number, to: number): void;
  /** Build + show an overlay from a controller-supplied model; return a handle for key routing
   *  and programmatic close. Returns void when nothing was shown. */
  openOverlay(req: OverlayRequest): OverlayHandle | void;
  /** Tear down any open overlay. */
  closeOverlay(): void;
  /** If the open overlay registered a sound-icon refresher, the controller calls this to refresh it. */
  refreshSoundIcon?(on: boolean): void;
  /** Fade out + remove all nodes; resolve when gone. */
  destroy(): Promise<void> | void;
}

/** What the renderer (and its components) read from the brain. */
export interface ShellHost {
  readonly state: ShellState;
  readonly config: ResolvedShellConfig;
  readonly tokens: ShellTokens;
  readonly layout: ShellLayoutMode;
  readonly soundOn: boolean;
  /** Resolve a built-in string (translation + optional socialize). */
  t(text: string): string;
  /** Currency-aware money formatting (win=true ⇒ variable decimals). */
  formatCurrency(n: number, win?: boolean): string;
  /** Typed event emit — same signature as the shells. */
  emit: EventEmitter<ShellEvents>['emit'];
  /** Renderer reports its surface size; the controller recomputes layout + re-renders. */
  notifyResize(w: number, h: number): void;
  /** Flip shared sound state (emits settingChange + refreshes an open Settings icon). */
  setSound(on: boolean): void;
  /** An open Settings overlay registers an icon updater here (null clears it on close). */
  setSoundRefresh(fn: ((on: boolean) => void) | null): void;
  /** Logic-bearing actions invoked by renderer controls. */
  readonly actions: ShellActions;
}

/** Every state-changing thing a control can do. Each runs logic in the controller, emits the
 *  matching event, and triggers a re-render. Renderers MUST route input through these. */
export interface ShellActions {
  spin(): void;
  stepBet(dir: 1 | -1): void;
  setBet(n: number): void;
  cycleTurbo(): void;
  toggleAutoplay(): void;
  startAutoplay(remaining: number): void;
  stopAutoplay(): void;
  openMenu(): void;
  openSettings(): void;
  openInfo(): void;
  openBuyBonus(): void;
  openBetPicker(): void;
  openAutoplayPicker(): void;
  selectBuyBonus(id: string): void;
  activateFeature(b: BonusOption): void;
  deactivateFeature(): void;
  setSound(on: boolean): void;
  closeOverlay(): void;
}

export interface OverlayHandle {
  /** Overlay-specific keys (e.g. arrows in a picker). Return true to consume. */
  onKey?(e: KeyboardEvent): boolean;
  /** Programmatically close this overlay. */
  close(): void;
}

export type OverlayRequest =
  | { kind: 'settings' }
  | { kind: 'gameInfo' }
  | { kind: 'buyBonus' }
  | { kind: 'betPicker' }
  | { kind: 'autoplayPicker' }
  | { kind: 'replay'; opts: ReplayModalOptions }
  | { kind: 'modal'; opts: ModalOptions };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shell/src/core/renderer.ts
git commit -m "feat(shell): define ShellRenderer/ShellHost/ShellActions contract"
```

### Task 6: ShellController (the brain) + FakeRenderer + controller tests

**Files:**
- Create: `packages/shell/src/core/ShellController.ts`
- Create: `packages/shell/tests/core/FakeRenderer.ts` (test double)
- Test: `packages/shell/tests/core/controller.test.ts`

**Interfaces:**
- Consumes: everything in `core/*`.
- Produces: `ShellController` (class), `CreateShellOptions` (`ShellConfig & { renderer: ShellRenderer }`), `resolveConfig(config): ResolvedShellConfig`. Public API mirrors `GameShell`/`PixiGameShell`: `setBalance · setWin · setBet · setMode · setBusy · setAutoplay · setTurbo · setFreeSpins · setBuyBonusEnabled · setTheme · setLanguage · setSocial · setSound · activateFeature · deactivateFeature · formatWin · openMenu · openSettings · openInfo · openBuyBonus · openBetPicker · openAutoplayPicker · openReplay · openModal · closeModal · destroy`. Also implements `ShellHost`.

- [ ] **Step 1: Write the failing controller test** (drives the headline property: logic lives in the controller; a renderer only observes).

`tests/core/FakeRenderer.ts`:
```ts
import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';

/** Records every contract call so tests assert the controller drives the view correctly. */
export class FakeRenderer implements ShellRenderer {
  host!: ShellHost;
  bars = 0;
  layouts: string[] = [];
  themes = 0;
  money: Array<{ field: string; from: number; to: number }> = [];
  overlays: OverlayRequest[] = [];
  closed = 0;
  destroyed = false;
  /** When set, openOverlay returns a handle with this onKey. */
  onKey?: (e: KeyboardEvent) => boolean;
  mount(host: ShellHost): void { this.host = host; }
  renderBar(): void { this.bars++; }
  setLayout(l: 'wide' | 'mobile'): void { this.layouts.push(l); }
  applyTheme(): void { this.themes++; }
  animateMoney(field: 'balance' | 'win', from: number, to: number): void { this.money.push({ field, from, to }); }
  openOverlay(req: OverlayRequest): OverlayHandle { this.overlays.push(req); return { onKey: this.onKey, close: () => { this.closed++; } }; }
  closeOverlay(): void { this.closed++; }
  destroy(): void { this.destroyed = true; }
}
```

`tests/core/controller.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ShellController } from '@/core/ShellController';
import { FakeRenderer } from './FakeRenderer';
import type { ShellConfig } from '@/core/types';

function make(over: Partial<ShellConfig> = {}): { c: ShellController; r: FakeRenderer } {
  const r = new FakeRenderer();
  const c = new ShellController({
    renderer: r,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.2, 0.5, 1, 2, 5],
    defaultBet: 1, currentBet: null, balance: 1000, win: 0, mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 3, autoplay: {}, buyBonus: [] },
    ...over,
  });
  return { c, r };
}

describe('ShellController', () => {
  it('mounts the renderer and renders the bar once on construct', () => {
    const { r } = make();
    expect(r.host).toBeDefined();
    expect(r.bars).toBe(1);
    expect(r.themes).toBe(1);
  });

  it('stepBet runs in the controller and emits betChange (renderer only redraws)', () => {
    const { c, r } = make();
    const spy = vi.fn();
    c.on('betChange', spy);
    r.host.actions.stepBet(1); // available [0.2,0.5,1,2,5], default 1 → 2
    expect(c.state.bet).toBe(2);
    expect(spy).toHaveBeenCalledWith(2);
    expect(r.bars).toBe(2); // one more redraw
  });

  it('setBalance animates money from the previous value', () => {
    const { c, r } = make();
    c.setBalance(1200);
    expect(c.state.balance).toBe(1200);
    expect(r.money.at(-1)).toEqual({ field: 'balance', from: 1000, to: 1200 });
  });

  it('openSettings emits settingsOpen and opens the settings overlay', () => {
    const { c, r } = make();
    const spy = vi.fn();
    c.on('settingsOpen', spy);
    c.openSettings();
    expect(spy).toHaveBeenCalled();
    expect(r.overlays.at(-1)).toEqual({ kind: 'settings' });
  });

  it('onBonusBuy override is called instead of opening the overlay', () => {
    const onBonusBuy = vi.fn();
    const { c, r } = make({ onBonusBuy });
    c.openBuyBonus();
    expect(onBonusBuy).toHaveBeenCalled();
    expect(r.overlays.find((o) => o.kind === 'buyBonus')).toBeUndefined();
  });

  it('notifyResize switches to mobile when portrait', () => {
    const { c, r } = make();
    r.host.notifyResize(400, 800);
    expect(c.layout).toBe('mobile');
    expect(r.layouts.at(-1)).toBe('mobile');
  });

  it('setSound flips shared state, emits settingChange, and refreshes the open settings icon', () => {
    const { c } = make();
    const changed = vi.fn();
    const refresh = vi.fn();
    c.on('settingChange', changed);
    c.setSoundRefresh(refresh);
    c.setSound(false);
    expect(c.soundOn).toBe(false);
    expect(changed).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(refresh).toHaveBeenCalledWith(false);
  });

  it('deactivateFeature is a no-op with no active feature', () => {
    const { c } = make();
    const spy = vi.fn();
    c.on('featureDeactivate', spy);
    c.deactivateFeature();
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/core/controller`
Expected: FAIL ("Cannot find module '@/core/ShellController'").

- [ ] **Step 3: Write `src/core/ShellController.ts`** (logic extracted from `GameShell` + `PixiGameShell`, renderer-free).

```ts
import { EventEmitter } from './EventEmitter';
import { createInitialState, nextTurbo, stepBet } from './state';
import { resolveTheme, type ShellTokens } from './theme';
import { formatCurrency } from './format';
import { createI18n, type I18n } from './i18n';
import { KeyboardController, type KeyboardHost } from './keyboard';
import { PACKAGE_VERSION } from './version';
import type {
  ShellConfig, ResolvedShellConfig, ShellState, ShellEvents, ShellMode,
  AutoplayOptions, FreeSpinsState, BonusOption, ThemeConfig, ModalOptions, ReplayModalOptions,
} from './types';
import type {
  ShellRenderer, ShellHost, ShellActions, OverlayHandle, OverlayRequest, ShellLayoutMode,
} from './renderer';

export interface CreateShellOptions extends ShellConfig { renderer: ShellRenderer; }

/** Apply defaults to the raw config (the mount target lives on the renderer, not here). */
export function resolveConfig(config: ShellConfig): ResolvedShellConfig {
  return {
    language: config.language,
    currency: config.currency,
    availableBets: config.availableBets,
    defaultBet: config.defaultBet,
    currentBet: config.currentBet,
    balance: config.balance,
    win: config.win,
    mode: config.mode,
    gameInfo: config.gameInfo,
    features: config.features,
    theme: config.theme,
    onBonusBuy: config.onBonusBuy,
    version: config.version ?? '1.0.0',
    isSocial: config.isSocial ?? false,
    replay: config.replay ?? config.mode === 'replay',
  };
}

/** The renderer-agnostic brain. Owns state, events, keyboard, i18n, theme, overlay flow and the
 *  game-facing public API; drives a ShellRenderer for the view. Implements ShellHost so the
 *  renderer + its components read everything they need through one interface. */
export class ShellController extends EventEmitter<ShellEvents> implements ShellHost {
  readonly config: ResolvedShellConfig;
  state: ShellState;
  tokens: ShellTokens;
  layout: ShellLayoutMode = 'wide';
  soundOn = true;
  readonly engineVersion = PACKAGE_VERSION;
  readonly actions: ShellActions;

  private renderer: ShellRenderer;
  private i18n: I18n;
  private kbd?: KeyboardController;
  private overlay: OverlayHandle | null = null;
  private soundRefresh: ((on: boolean) => void) | null = null;
  private prevBalance: number;
  private prevWin: number;
  private destroyed = false;

  constructor(opts: CreateShellOptions) {
    super();
    const { renderer, ...config } = opts;
    this.renderer = renderer;
    this.config = resolveConfig(config);
    this.i18n = createI18n({ language: this.config.language, isSocial: this.config.isSocial });
    this.state = createInitialState(this.config);
    this.tokens = resolveTheme(this.config.theme);
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
    this.actions = this.buildActions();

    renderer.mount(this);
    if (typeof document !== 'undefined') {
      this.attachKeyboard();
      document.addEventListener('pointerdown', this.pullFocus, true);
    }
    this.renderer.applyTheme(this.tokens);
    this.renderer.renderBar();
  }

  // ── ShellHost ──────────────────────────────────────────────────────────────
  t(text: string): string { return this.i18n.t(text); }
  formatCurrency(n: number, win = false): string { return formatCurrency(n, this.config.currency, win); }
  formatWin(value: number): string { return this.formatCurrency(value, true); }
  notifyResize(w: number, h: number): void {
    const layout: ShellLayoutMode = w !== 0 && h > w ? 'mobile' : 'wide';
    if (layout !== this.layout) { this.layout = layout; this.renderer.setLayout(layout); }
    this.renderer.renderBar();
  }

  private buildActions(): ShellActions {
    const a: ShellActions = {
      spin: () => this.emit('spin'),
      stepBet: (dir) => {
        const next = stepBet(this.state, dir);
        if (next === this.state.bet) return;
        this.state.bet = next; this.emit('betChange', next); this.renderer.renderBar();
      },
      setBet: (n) => this.setBet(n),
      cycleTurbo: () => {
        const next = nextTurbo(this.state.turbo, this.config.features.turbo);
        this.state.turbo = next; this.emit('turboChange', next); this.renderer.renderBar();
      },
      toggleAutoplay: () => {
        if (this.state.autoplay.active) a.stopAutoplay();
        else this.openAutoplayPicker();
      },
      startAutoplay: (remaining) => {
        this.state.autoplay = { active: true, remaining };
        this.emit('autoplayStart', { remaining }); this.renderer.renderBar();
      },
      stopAutoplay: () => {
        this.state.autoplay = { active: false, remaining: 0 };
        this.emit('autoplayStop'); this.renderer.renderBar();
      },
      openMenu: () => this.openMenu(),
      openSettings: () => this.openSettings(),
      openInfo: () => this.openInfo(),
      openBuyBonus: () => this.openBuyBonus(),
      openBetPicker: () => this.openBetPicker(),
      openAutoplayPicker: () => this.openAutoplayPicker(),
      selectBuyBonus: (id) => this.emit('buyBonusSelect', { id }),
      activateFeature: (b) => this.activateFeature(b),
      deactivateFeature: () => this.deactivateFeature(),
      setSound: (on) => this.setSound(on),
      closeOverlay: () => this.closeModal(),
    };
    return a;
  }

  private attachKeyboard(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const host: KeyboardHost = {
      get state() { return self.state; },
      get hotkeysEnabled() { return self.config.features.hotkeys !== false; },
      get spacebarEnabled() { return self.config.features.spacebar !== false; },
      get turboLevels() { return self.config.features.turbo; },
      get autoplayEnabled() { return self.config.features.autoplay != null; },
      get buyBonusEnabled() { return self.config.features.buyBonus !== false; },
      hasOpenLayer: () => self.overlay !== null,
      routeToLayer: (e) => self.overlay?.onKey?.(e) ?? false,
      spin: () => self.actions.spin(),
      stepBet: (d) => self.actions.stepBet(d),
      toggleAutoplay: () => self.actions.toggleAutoplay(),
      cycleTurbo: () => self.actions.cycleTurbo(),
      openBuyBonus: () => self.actions.openBuyBonus(),
      openInfo: () => self.actions.openInfo(),
      openMenu: () => self.actions.openMenu(),
      toggleMute: () => self.setSound(!self.soundOn),
      closeLayer: () => self.closeModal(),
    };
    this.kbd = new KeyboardController(host);
    this.kbd.attach();
  }

  private pullFocus = (): void => { try { (globalThis as { focus?: () => void }).focus?.(); } catch { /* cross-origin */ } };

  // ── overlay flow ─────────────────────────────────────────────────────────────
  private show(req: OverlayRequest): void { this.closeModal(); this.overlay = this.renderer.openOverlay(req) ?? null; }
  openMenu(): void { this.emit('menuOpen'); this.openSettings(); }
  openSettings(): void { this.emit('settingsOpen'); this.show({ kind: 'settings' }); }
  openInfo(): void { this.emit('infoOpen'); this.show({ kind: 'gameInfo' }); }
  openBuyBonus(): void { if (this.config.onBonusBuy) { this.config.onBonusBuy(); return; } this.show({ kind: 'buyBonus' }); }
  openBetPicker(): void { this.show({ kind: 'betPicker' }); }
  openAutoplayPicker(): void { this.show({ kind: 'autoplayPicker' }); }
  openReplay(opts: ReplayModalOptions): void { if (this.destroyed) return; this.show({ kind: 'replay', opts }); }
  openModal(opts: ModalOptions): void { this.show({ kind: 'modal', opts }); }
  closeModal(): void {
    if (this.overlay) { this.overlay.close(); this.overlay = null; }
    this.soundRefresh = null;
    this.renderer.closeOverlay();
  }

  // ── sound ──────────────────────────────────────────────────────────────────
  setSound(on: boolean): void {
    this.soundOn = on;
    this.emit('settingChange', { key: 'sound', value: on });
    this.soundRefresh?.(on);
    this.renderer.refreshSoundIcon?.(on);
  }
  setSoundRefresh(fn: ((on: boolean) => void) | null): void { this.soundRefresh = fn; }

  // ── features ─────────────────────────────────────────────────────────────────
  activateFeature(bonus: BonusOption): void {
    this.state.activeFeature = bonus; this.emit('featureActivate', { id: bonus.id }); this.renderer.renderBar();
  }
  deactivateFeature(): void {
    const prev = this.state.activeFeature;
    if (!prev) return;
    this.state.activeFeature = null; this.emit('featureDeactivate', { id: prev.id }); this.renderer.renderBar();
  }

  // ── game-facing public API (mirrors GameShell/PixiGameShell) ───────────────────
  private money(field: 'balance' | 'win', from: number, to: number): void {
    this.renderer.renderBar();
    if (to !== from) this.renderer.animateMoney(field, from, to);
  }
  setBalance(n: number): void { const from = this.prevBalance; this.state.balance = n; this.prevBalance = n; this.money('balance', from, n); }
  setWin(n: number): void { const from = this.prevWin; this.state.win = n; this.prevWin = n; this.money('win', from, n); }
  setBet(n: number): void { this.state.bet = n; this.renderer.renderBar(); }
  setMode(mode: ShellMode): void { if (mode === 'replay') this.state.replay = true; this.state.mode = mode; this.renderer.renderBar(); }
  setBusy(busy: boolean): void { this.state.busy = busy; this.renderer.renderBar(); this.kbd?.notifyBusyChanged(busy); }
  setAutoplay(a: AutoplayOptions): void { this.state.autoplay = a; this.renderer.renderBar(); }
  setTurbo(level: number): void { this.state.turbo = level; this.renderer.renderBar(); }
  setBuyBonusEnabled(enabled: boolean): void { this.state.buyBonusEnabled = enabled; this.renderer.renderBar(); }
  setFreeSpins(fs: FreeSpinsState): void { this.state.freeSpins = fs; this.renderer.renderBar(); }
  setTheme(theme: ThemeConfig): void { this.config.theme = theme; this.tokens = resolveTheme(theme); this.renderer.applyTheme(this.tokens); this.renderer.renderBar(); }
  setLanguage(lang: string): void { this.config.language = lang; this.i18n = createI18n({ language: lang, isSocial: this.config.isSocial }); this.renderer.renderBar(); }
  setSocial(isSocial: boolean): void { this.config.isSocial = isSocial; this.i18n = createI18n({ language: this.config.language, isSocial }); this.renderer.renderBar(); }
  setLayout(layout: ShellLayoutMode): void { if (layout === this.layout) return; this.layout = layout; this.renderer.setLayout(layout); this.renderer.renderBar(); }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    if (typeof document !== 'undefined') {
      this.kbd?.detach();
      document.removeEventListener('pointerdown', this.pullFocus, true);
    }
    this.removeAllListeners();
    return Promise.resolve(this.renderer.destroy());
  }
}
```

> Note for the implementer: `setBalance`/`setWin` track `prevBalance`/`prevWin` so count-up animates from the last shown value (the originals did this inside `render()`; here the controller drives it explicitly and the renderer's `renderBar()` cancels its own in-flight anims).

- [ ] **Step 4: Run the controller tests to verify they pass**

Run: `npm test --workspace @energy8platform/shell -- tests/core/controller`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/core/ShellController.ts packages/shell/tests/core/FakeRenderer.ts packages/shell/tests/core/controller.test.ts
git commit -m "feat(shell): ShellController brain + contract test double (logic/render separation proven)"
```

### Task 7: Core entry — `createShell` factory + exports

**Files:**
- Replace: `packages/shell/src/core/index.ts` (was stub)
- Test: `packages/shell/tests/core/createShell.test.ts`

**Interfaces:**
- Produces: `createShell(opts: CreateShellOptions): ShellController`; re-exports all of `core/renderer`, `core/types`, `core/theme` (`ShellTokens`), `ShellController`, `resolveConfig`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createShell, ShellController } from '@/core';
import { FakeRenderer } from './FakeRenderer';

describe('createShell', () => {
  it('returns a ShellController wired to the given renderer', () => {
    const r = new FakeRenderer();
    const shell = createShell({
      renderer: r, language: 'en', currency: { symbol: '€', position: 'left' },
      availableBets: [1, 2], defaultBet: 1, currentBet: null, balance: 100, win: 0,
      mode: 'base', gameInfo: { sections: [] }, features: { turbo: 0 },
    });
    expect(shell).toBeInstanceOf(ShellController);
    expect(r.host).toBe(shell);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/core/createShell`
Expected: FAIL (`createShell` not exported).

- [ ] **Step 3: Write `src/core/index.ts`**

```ts
import { ShellController, type CreateShellOptions } from './ShellController';

/** Create a shell with an explicit renderer instance (custom or a built-in HtmlRenderer/PixiRenderer).
 *  Built-in renderers also have the createGameShell/createPixiShell sugar in /html and /pixi. */
export function createShell(opts: CreateShellOptions): ShellController {
  return new ShellController(opts);
}

export { ShellController, resolveConfig } from './ShellController';
export type { CreateShellOptions } from './ShellController';
export * from './renderer';
export * from './types';
export { resolveTheme, SCHEMES, DEFAULT_ACCENT } from './theme';
export type { ShellTokens } from './theme';
export { createI18n, socialize, normalizeLang } from './i18n';
export type { Lang, I18n, I18nOptions } from './i18n';
export { PACKAGE_VERSION } from './version';
```

- [ ] **Step 4: Run the test + full core suite + typecheck**

Run: `npm test --workspace @energy8platform/shell -- tests/core && npm run typecheck --workspace @energy8platform/shell`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/core/index.ts packages/shell/tests/core/createShell.test.ts
git commit -m "feat(shell): core createShell factory + public exports"
```

---

## Phase 2 — HTML renderer (`ui/html`)

### Task 8: Port DOM building blocks (css, theme-css, motion-dom, icons, primitives)

**Files:**
- Create: `packages/shell/src/ui/html/shell.css.ts` ← copy `packages/platform-core/src/shell/shell.css.ts`
- Create: `packages/shell/src/ui/html/theme-css.ts` (the CSS-var emitter split out of platform-core `theme.ts`)
- Create: `packages/shell/src/ui/html/motion-dom.ts` (the DOM `countUp` out of platform-core `motion.ts`)
- Create: `packages/shell/src/ui/html/icons.ts` ← copy `packages/platform-core/src/shell/components/icons.ts`
- Create: `packages/shell/src/ui/html/primitives.ts` ← copy `packages/platform-core/src/shell/components/primitives.ts`

**Interfaces:**
- Produces: `SHELL_CSS`, `SHELL_ROOT_ID`; `buildThemeVars(tokens: ShellTokens): string`; `countUp(el, from, to, fmt, durationMs?): () => void`; `icon`, `IconName`; DOM primitives (`twoLine`, `createOverlay`, etc.).

- [ ] **Step 1: Copy `shell.css.ts`, `icons.ts`, `primitives.ts`** verbatim; fix relative imports (`./icons`, `./primitives` stay sibling; any `../theme`/`../colors`/`../format` → `@/core/theme` etc.).

- [ ] **Step 2: Write `theme-css.ts`** = the CSS-var block from platform-core `theme.ts` (`buildThemeVars`), but it now CONSUMES the already-resolved `ShellTokens` (from core) instead of recomputing the palette. Map each token to its `--shell-*` custom property exactly as platform-core does:

```ts
import type { ShellTokens } from '@/core/theme';

/** Emit the shell root's CSS custom-property block from resolved tokens — the DOM renderer's
 *  applyTheme. Property names/values must match platform-core's buildThemeVars byte-for-byte. */
export function buildThemeVars(t: ShellTokens): string {
  return [
    `--shell-fg: ${t.fg}`, `--shell-muted: ${t.muted}`, `--shell-icon: ${t.icon}`,
    `--shell-icon-active: ${t.iconActive}`, `--shell-surface: ${t.surface}`,
    `--shell-hairline: ${t.hairline}`, `--shell-veil: ${t.veil}`, `--shell-veil-strong: ${t.veilStrong}`,
    `--shell-track: ${t.track}`, `--shell-soft: ${t.soft}`, `--shell-spin: ${t.spin}`, `--shell-spin-fg: ${t.spinFg}`,
    `--shell-radius: 12px`,
    `--shell-plaque-dark: ${t.plaqueDark}`, `--shell-plaque-glass: ${t.plaqueGlass}`,
    `--shell-plaque-glass-hover: ${t.plaqueGlassHover}`, `--shell-plaque-solid: ${t.plaqueSolid}`,
    `--shell-plaque-line: ${t.plaqueLine}`, `--shell-plaque-label: ${t.plaqueLabel}`,
    `--shell-accent: ${t.accent}`,
  ].join('; ') + ';';
}
```
> Verify against `packages/platform-core/src/shell/theme.ts`: the list of `--shell-*` properties and the literal values (plaque colours, radius) must match exactly so `shell.css.ts` keeps working.

- [ ] **Step 3: Write `motion-dom.ts`** = platform-core `motion.ts`'s `countUp` (rAF + `textContent`), importing `prefersReducedMotion` from `@/core/motion`:

```ts
import { prefersReducedMotion } from '@/core/motion';

/** Animate el's text from→to via fmt on requestAnimationFrame; jumps to final when motion is
 *  reduced/unavailable. Returns a canceler. (Verbatim behavior of platform-core motion.ts countUp.) */
export function countUp(el: HTMLElement, from: number, to: number, fmt: (n: number) => string, durationMs = 450): () => void {
  // ... copy the body of countUp from packages/platform-core/src/shell/motion.ts ...
}
```
> Copy the exact body from `packages/platform-core/src/shell/motion.ts`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/html
git commit -m "feat(shell/html): port DOM css, theme-vars, count-up, icons, primitives"
```

### Task 9: Port DOM components (BottomBar + overlays), retargeted to `ShellHost`

**Files:**
- Create: `packages/shell/src/ui/html/components/BottomBar.ts` ← from platform-core
- Create: `packages/shell/src/ui/html/components/Settings.ts`, `GameInfo.ts`, `BuyBonus.ts`, `pickers.ts`, `Modal.ts`, `ReplayModal.ts` ← from platform-core

**Interfaces:**
- Consumes: `ShellHost` (`@/core/renderer`), `icon`, primitives, `@/core` logic.
- Produces: `renderBottomBar(host: ShellHost): HTMLElement`; `openSettingsModal(host)`, `openGameInfoModal(host)`, `openBuyBonusOverlay(host)`, `openBetModal(host)`, `openAutoplayModal(host)`, `buildModal(opts)`, `buildReplayModal(host, opts)` — each returns `{ root: HTMLElement, onKey?: (e) => boolean }` (or just `HTMLElement` where the original had no onKey).

- [ ] **Step 1: Copy each component file** from `packages/platform-core/src/shell/components/*` into `src/ui/html/components/`.

- [ ] **Step 2: Apply the retarget transform to EVERY component.** This is the UI/logic separation — mechanical but mandatory:
  - Change the host parameter type `GameShell` → `ShellHost` (import from `@/core/renderer`). Replace `import type { GameShell } from '../GameShell'` with `import type { ShellHost } from '@/core/renderer'` and rename the param `shell` → `host` (or keep `shell` typed as `ShellHost`).
  - Replace every inline logic+mutation+emit+render with the matching action. Exact substitutions for `BottomBar.ts`:
    - `onBet(shell, dir)` body (`stepBet` + `shell.state.bet = …` + `shell.emit('betChange')` + `shell.render()`) → `host.actions.stepBet(dir)`.
    - `onTurbo(shell)` body → `host.actions.cycleTurbo()`.
    - `stopAutoplay(shell)` body → `host.actions.stopAutoplay()`.
    - spin button `shell.emit('spin')` → `host.actions.spin()`.
    - `shell.openMenu()` → `host.actions.openMenu()`; `shell.openBetPicker()` → `host.actions.openBetPicker()`; `shell.openAutoplayPicker()` → `host.actions.openAutoplayPicker()`; `shell.openBuyBonus()` → `host.actions.openBuyBonus()`; `shell.deactivateFeature()` → `host.actions.deactivateFeature()`.
    - Remove the now-unused `import { stepBet, nextTurbo } from '../state'` (logic no longer runs here).
    - Keep all DOM construction, class names, `data-ge` attributes, and `applyBusy` EXACTLY as-is.
  - For `Settings.ts`: `shell.setSound` → `host.setSound`, `shell.setSoundRefresh` → `host.setSoundRefresh`, `shell.soundOn` → `host.soundOn`, `shell.emit('settingChange', …)` for sliders → `host.emit('settingChange', …)` (sliders are not in `actions`; emitting a setting value is allowed via `host.emit` — it carries no state mutation). `shell.openInfo()` → `host.actions.openInfo()`.
  - For `GameInfo.ts`, `BuyBonus.ts`, `pickers.ts`, `Modal.ts`, `ReplayModal.ts`: change host type to `ShellHost`; route any state changes through `host.actions` (e.g. buy-bonus confirm → `host.actions.selectBuyBonus(id)` + `host.actions.activateFeature(b)` where the original called `shell.emit('buyBonusSelect')`/`shell.activateFeature`); bet picker confirm → `host.actions.setBet(n)` then close; autoplay picker confirm → `host.actions.startAutoplay(remaining)` then close. Keep all pricing/labels/i18n (`host.t`, `host.formatCurrency`) and DOM structure identical.

> Reference while transforming: `host.actions` has exactly `{ spin, stepBet, setBet, cycleTurbo, toggleAutoplay, startAutoplay, stopAutoplay, openMenu, openSettings, openInfo, openBuyBonus, openBetPicker, openAutoplayPicker, selectBuyBonus, activateFeature, deactivateFeature, setSound, closeOverlay }`. Anything a component used to do to `shell.state` must map to one of these.

- [ ] **Step 3: Typecheck** (no tests yet — they arrive with the renderer in Task 10):

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/ui/html/components
git commit -m "feat(shell/html): port DOM components, route input through host.actions"
```

### Task 10: HtmlRenderer + `createGameShell` + migrate the DOM test suite

**Files:**
- Create: `packages/shell/src/ui/html/HtmlRenderer.ts`
- Replace: `packages/shell/src/ui/html/index.ts` (was stub)
- Test: `packages/shell/tests/html/**` (migrated from platform-core)

**Interfaces:**
- Consumes: `ShellRenderer`/`ShellHost`/`OverlayRequest` (`@/core`), the html components, `SHELL_CSS`, `buildThemeVars`, `countUp`.
- Produces: `HtmlRenderer` (class, `new HtmlRenderer({ mount: HTMLElement })`), `createGameShell(config: HtmlShellConfig): ShellController`, type aliases `GameShell = ShellController`, `HtmlShellConfig = ShellConfig & { mount: HTMLElement }`. Re-export every type from `@/core` plus the html-typed `BonusOption`/`GameInfoSection` (node = `HTMLElement`).

- [ ] **Step 1: Write `HtmlRenderer.ts`** — the DOM view half of the old `GameShell` (root/style/barHost/modalHost, render→`renderBottomBar`, applyFitScale, animateMoney via `countUp`, showModal/fitModals/fitSheet, ResizeObserver→`host.notifyResize`, theme via `buildThemeVars`, destroy fade). Move the rendering methods of `packages/platform-core/src/shell/GameShell.ts` here, adapted to the contract:

```ts
import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';
import { buildThemeVars } from './theme-css';
import { countUp } from './motion-dom';
import { renderBottomBar } from './components/BottomBar';
import { openSettingsModal } from './components/Settings';
import { openGameInfoModal } from './components/GameInfo';
import { openBuyBonusOverlay } from './components/BuyBonus';
import { openBetModal, openAutoplayModal } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';

export interface HtmlRendererOptions { mount: HTMLElement; }

export class HtmlRenderer implements ShellRenderer {
  private host!: ShellHost;
  private mountEl: HTMLElement;
  private root!: HTMLElement;
  private styleEl!: HTMLStyleElement;
  private barHost = document.createElement('div');
  private modalHost = document.createElement('div');
  private ro: ResizeObserver | null = null;
  private moneyAnims: Array<() => void> = [];
  private modalOnKey: ((e: KeyboardEvent) => boolean) | undefined;
  private destroyed = false;

  constructor(opts: HtmlRendererOptions) { this.mountEl = opts.mount; }

  mount(host: ShellHost): void {
    this.host = host;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_CSS;
    this.root = document.createElement('div');
    this.root.id = SHELL_ROOT_ID;
    this.mountEl.append(this.styleEl, this.root);
    this.barHost.className = 'ge-shell-barhost';
    this.modalHost.className = 'ge-shell-modalhost';
    this.root.append(this.barHost, this.modalHost);
    this.observeLayout();
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => { if (!this.destroyed) this.applyFitScale(); });
    }
  }

  applyTheme(tokens: import('@/core/theme').ShellTokens): void { this.root.setAttribute('style', buildThemeVars(tokens)); }

  renderBar(): void {
    if (this.destroyed) return;
    this.cancelMoneyAnims();
    this.root.classList.toggle('ge-mobile', this.host.layout === 'mobile');
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this.host));
    this.applyFitScale();
  }

  setLayout(): void { this.renderBar(); }

  animateMoney(field: 'balance' | 'win', from: number, to: number): void {
    const fmt = (n: number) => this.host.formatCurrency(n, field === 'win');
    const el = this.barHost.querySelector(`[data-ge="${field}"]`) as HTMLElement | null;
    if (el) this.moneyAnims.push(animateReadout(el, from, to, fmt));
  }

  openOverlay(req: OverlayRequest): OverlayHandle | void {
    const built = this.build(req);
    if (!built) return;
    this.showModal(built.root, built.onKey);
    return { onKey: built.onKey, close: () => this.closeOverlay() };
  }
  closeOverlay(): void { this.modalOnKey = undefined; this.modalHost.innerHTML = ''; }
  refreshSoundIcon(): void { /* Settings registers via host.setSoundRefresh; nothing extra here */ }

  destroy(): Promise<void> { /* fade ge-shell-hidden, remove root+style after 300ms; clear RO + anims */ }

  // private: build(req) → dispatch to the component openers; observeLayout → RO calls host.notifyResize;
  // applyFitScale / fitModals / fitSheet / showModal / cancelMoneyAnims → copy verbatim from GameShell.
}
```
> Implementation detail: `build(req)` switches on `req.kind` and calls the matching component opener (`openSettingsModal(this.host)`, `openGameInfoModal(this.host)`, `openBuyBonusOverlay(this.host)`, `openBetModal`, `openAutoplayModal`, `buildModal(req.opts)`, `buildReplayModal(this.host, req.opts)`), normalizing each to `{ root, onKey? }`. Copy `applyFitScale`, `fitModals`, `fitSheet`, `showModal`, `observeLayout`, the static `BAR_*`/`MODAL_FIT` constants, and `animateReadout` VERBATIM from `packages/platform-core/src/shell/GameShell.ts` (they are pure DOM and must behave identically). `observeLayout`'s ResizeObserver calls `this.host.notifyResize(w, h)` then `this.applyFitScale()` + `this.fitModals()`.

- [ ] **Step 2: Write `src/ui/html/index.ts`** (sugar + exports)

```ts
import { createShell, ShellController } from '@/core';
import type { ShellConfig } from '@/core/types';
import { HtmlRenderer } from './HtmlRenderer';

export interface HtmlShellConfig extends ShellConfig { mount: HTMLElement; }

/** Drop-in replacement for the platform-core createGameShell. */
export function createGameShell(config: HtmlShellConfig): ShellController {
  return createShell({ ...config, renderer: new HtmlRenderer({ mount: config.mount }) });
}
export function removeGameShell(shell: ShellController): Promise<void> { return shell.destroy(); }

export { HtmlRenderer };
export { ShellController as GameShell };
export * from '@/core';
```
> If the originals exposed a singleton `removeGameShell()` (no arg), preserve that exact signature instead: keep a module-level `active` like `packages/platform-core/src/shell/index.ts` and mirror it. Check that file and match its API.

- [ ] **Step 3: Migrate the DOM test suite.** Copy these into `packages/shell/tests/html/` and retarget imports from `@/shell/...`/`@energy8platform/platform-core/shell` to `@energy8platform/shell/html` (public API) or `@/ui/html/...` / `@/core/...` (internals). Files:
  - From `packages/platform-core/tests/shell/`: `smoke`, `lifecycle`, `bottombar`, `bottombar-modes`, `controls`, `layout`, `menu`, `modal`, `modal-fit`, `replay`, `overlay-chrome`, `overlay-scroll`, `overlay-stacking`, `gameinfo`, `buybonus`, `buybonus-keys`, `hotkeys-section`, `countup`, `social`, `fonts`, `icons`, `keyboard`, `i18n`.
  - From `packages/platform-core/tests/`: `shell-mute`, `shell-keyboard-parity`, `shell-modal-keys`, `shell-i18n`, `shell-language`.
  (`state`, `format`, `theme`, `locales`, `motion` already moved to `tests/core` in Phase 1 — do not duplicate.)

- [ ] **Step 4: Run the DOM suite; fix renderer until green**

Run: `npm test --workspace @energy8platform/shell -- tests/html`
Expected: PASS. Failures indicate a structural drift from the original — fix `HtmlRenderer`/components to match the original DOM exactly (do NOT weaken tests).

- [ ] **Step 5: Build the html bundle + typecheck**

Run: `npm run build --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: `dist/html.*` emit; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/html packages/shell/tests/html
git commit -m "feat(shell/html): HtmlRenderer + createGameShell; migrate DOM test suite (green)"
```

---

## Phase 3 — Pixi renderer (`ui/pixi`)

### Task 11: Port Pixi building blocks (context, primitives, text, icons, motion-pixi)

**Files:**
- Create: `packages/shell/src/ui/pixi/context.ts` (pixi-extended host + `ShellLayer`)
- Create: `packages/shell/src/ui/pixi/primitives/{card,controls,flex,overlay,scroll,widgets}.ts` ← copy from pixi-shell
- Create: `packages/shell/src/ui/pixi/text.ts`, `pixi-icon.ts`, `icons.ts` ← copy from pixi-shell
- Create: `packages/shell/src/ui/pixi/motion-pixi.ts` (Pixi `tween`/`countUpText` out of pixi-shell `motion.ts`)

**Interfaces:**
- Consumes: `ShellHost` (`@/core/renderer`), `@/core` logic, `pixi.js`.
- Produces: `PixiComponentContext` (extends `ShellHost` with `ticker`, `canvas?`, `screenW`, `screenH`, `pushLayer`, `closeLayer`, `fitModals`, `setSoundRefresh`, plus the `openMenu/openSettings/...` convenience used by pixi components), `ShellLayer`, `LayerHandle`; `tween`, `countUpText`, `easeOutCubic`; pixi primitives; `installShellFont`, `whenFontReady`, `setText`; icons.

- [ ] **Step 1: Copy** `primitives/*`, `text.ts`, `pixi-icon.ts`, `icons.ts` from `packages/pixi-shell/src/` verbatim; fix imports (`./theme`→`@/core/theme`, `./EventEmitter`→`@/core/EventEmitter`, `./motion`→`./motion-pixi`, `./context` stays sibling).

- [ ] **Step 2: Write `motion-pixi.ts`** = pixi-shell `motion.ts`'s `tween` + `countUpText`, importing `prefersReducedMotion`/`easeOutCubic`/`easeInOutQuad` from `@/core/motion` and `setText` from `./text`. Copy those two functions verbatim from `packages/pixi-shell/src/motion.ts`.

- [ ] **Step 3: Write `context.ts`** = pixi-shell `context.ts`, but `ShellHost` becomes `PixiComponentContext extends ShellHost` (the core host) + the pixi-only members the components need (`ticker`, `canvas`, `screenW`, `screenH`, `pushLayer`, `closeLayer`, `fitModals`, `render`, `setLanguage?`). Keep `ShellLayer`/`LayerHandle` as-is. The pixi components currently import `ShellHost`/`ShellLayer` from `./context` — they will now import `PixiComponentContext`/`ShellLayer`; the rename happens in Task 12.

```ts
import type { Container, Ticker } from 'pixi.js';
import type { ShellHost } from '@/core/renderer';

export interface ShellLayer extends Container {
  resize?(w: number, h: number): void;
  fit?(): void;
  onRemove?(): void;
  onKey?(e: KeyboardEvent): boolean;
}
export interface LayerHandle { root: ShellLayer; close(): void; }

/** What pixi components read: the core brain (ShellHost) plus the Pixi-specific surface the
 *  PixiRenderer provides (ticker, screen size, layer stack). */
export interface PixiComponentContext extends ShellHost {
  readonly ticker: Ticker;
  readonly canvas?: HTMLCanvasElement;
  readonly screenW: number;
  readonly screenH: number;
  render(): void;
  pushLayer(node: ShellLayer): LayerHandle;
  closeLayer(): void;
  fitModals(): void;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean (pixi components not yet ported; nothing imports the new ctx yet).

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/pixi
git commit -m "feat(shell/pixi): port pixi primitives, text, icons, motion; pixi component context"
```

### Task 12: Port Pixi components, retargeted to `PixiComponentContext`/`host.actions`

**Files:**
- Create: `packages/shell/src/ui/pixi/components/{BottomBar,Settings,GameInfo,BuyBonus,pickers,Modal,ReplayModal}.ts` ← copy from pixi-shell

**Interfaces:**
- Consumes: `PixiComponentContext`, `ShellLayer` (`./context`), pixi primitives, `@/core`.
- Produces: `BottomBar` (class), `openSettings(ctx)`, `openGameInfo(ctx)`, `openBuyBonus(ctx)`, `openBetPicker(ctx)`, `openAutoplayPicker(ctx)`, `buildModal(ctx, opts)`, `buildReplayModal(ctx, opts)` — each returning a `ShellLayer`.

- [ ] **Step 1: Copy each component** from `packages/pixi-shell/src/components/*` verbatim.

- [ ] **Step 2: Retarget.** The pixi components already depend on `ShellHost` from `./context`; the change is mostly the import + routing logic through actions:
  - Replace `import type { ShellHost } from '../context'` with `import type { PixiComponentContext, ShellLayer } from '../context'` and rename the parameter type `ShellHost` → `PixiComponentContext`.
  - Where a component mutated state / emitted / called `stepBet`/`nextTurbo` directly (BottomBar spin/bet/turbo/autoplay, pickers confirm, buy-bonus confirm), route through `host.actions.*` exactly as in the html retarget (Task 9 Step 2 substitution list). The pixi BottomBar currently calls `host.emit('spin')`, `stepBet(...)`, etc. — change to `host.actions.spin()`, `host.actions.stepBet(dir)`, `host.actions.cycleTurbo()`, `host.actions.stopAutoplay()`, `host.actions.openBetPicker()`, `host.actions.openBuyBonus()`, `host.actions.deactivateFeature()`.
  - Keep ALL Pixi drawing (containers, graphics, layout via flex primitive, fit logic) identical.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/ui/pixi/components
git commit -m "feat(shell/pixi): port pixi components, route input through host.actions"
```

### Task 13: PixiRenderer + `createPixiShell` + migrate the Pixi test suite

**Files:**
- Create: `packages/shell/src/ui/pixi/PixiRenderer.ts`
- Replace: `packages/shell/src/ui/pixi/index.ts` (was stub)
- Test: `packages/shell/tests/pixi/**` (migrated from pixi-shell, incl. `setup-canvas.ts`)

**Interfaces:**
- Consumes: `ShellRenderer`/`ShellHost`/`OverlayRequest` (`@/core`), `PixiComponentContext`/`ShellLayer` (`./context`), the pixi components, `pixi.js`.
- Produces: `PixiRenderer` (class, `new PixiRenderer({ app, parent? })`), `createPixiShell(config: PixiShellConfig): ShellController`, `removePixiShell(shell)`, alias `PixiGameShell = ShellController`. Re-export every `@/core` type + the pixi-typed `BonusOption`/`GameInfoSection` (node = `Container`).

- [ ] **Step 1: Write `PixiRenderer.ts`** — the view half of `PixiGameShell` (root/barLayer/modalLayer containers, `render`→`new BottomBar`, animateMoney via `countUpText`, pushLayer/closeLayer/clearLayer, backdrop blur, fitModals, `app.renderer 'resize'`→`host.notifyResize`, theme repaint, destroy fade). It implements `ShellRenderer` AND builds a `PixiComponentContext` (itself + host) to pass to components. Move the rendering methods of `packages/pixi-shell/src/PixiGameShell.ts` here:

```ts
import { Container, type Application } from 'pixi.js';
import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';
import type { ShellTokens } from '@/core/theme';
import type { PixiComponentContext, ShellLayer } from './context';
import { installShellFont, whenFontReady } from './text';
import { countUpText } from './motion-pixi';
import { BottomBar } from './components/BottomBar';
import { openSettings } from './components/Settings';
import { openGameInfo } from './components/GameInfo';
import { openBuyBonus } from './components/BuyBonus';
import { openBetPicker, openAutoplayPicker } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';

export interface PixiRendererOptions { app: Application; parent?: Container; }

export class PixiRenderer implements ShellRenderer {
  private app: Application;
  private parent?: Container;
  private host!: ShellHost;
  private ctx!: PixiComponentContext;
  private root = new Container();
  private barLayer = new Container();
  private modalLayer = new Container();
  // bar?, currentLayer, backdrop, moneyAnims, prevBalance/prevWin handled as in PixiGameShell
  constructor(opts: PixiRendererOptions) { this.app = opts.app; this.parent = opts.parent; }

  mount(host: ShellHost): void {
    installShellFont();
    this.host = host;
    this.ctx = this.makeContext();   // host + ticker/canvas/screen/pushLayer/closeLayer/fitModals/render
    this.root.eventMode = 'static';
    this.root.addChild(this.barLayer, this.modalLayer);
    (this.parent ?? this.app.stage).addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.renderer.on('resize', this.onResize);
    whenFontReady(() => this.renderBar());
  }

  renderBar(): void { /* cancel money anims; rebuild BottomBar(this.ctx); applyFit */ }
  setLayout(): void { this.renderBar(); }
  applyTheme(_tokens: ShellTokens): void { this.renderBar(); /* tokens are read live from host.tokens by components */ }
  animateMoney(field: 'balance' | 'win', from: number, to: number): void { /* countUpText on the new bar's value node */ }
  openOverlay(req: OverlayRequest): OverlayHandle | void { /* build via switch → pushLayer; return { onKey: layer.onKey, close } */ }
  closeOverlay(): void { /* closeLayer() */ }
  destroy(): Promise<void> { /* off resize; fade root via tween; destroy */ }

  private makeContext(): PixiComponentContext { /* return a proxy/object: spread host + ticker/screen/layer methods */ }
  private onResize = (): void => { this.host.notifyResize(this.app.screen.width, this.app.screen.height); /* + re-fit layer + re-snapshot backdrop */ };
}
```
> Copy `pushLayer`, `clearLayer`, `closeLayer`, `makeBackdrop`, `removeBackdrop`, `fitModals`, `render` (→`renderBar`), `animateMoney`, `cancelMoneyAnims`, the resize re-snapshot logic, and the destroy fade VERBATIM from `packages/pixi-shell/src/PixiGameShell.ts`. The `PixiComponentContext` exposes `screenW=app.screen.width`, `screenH=app.screen.height`, `ticker=app.ticker`, `canvas=app.canvas`, and the layer methods bound to this renderer. `setSoundRefresh` lives on the host (controller); pixi Settings calls `host.setSoundRefresh` — ensure the context forwards it (it extends ShellHost, so it already has it). `refreshSoundIcon` on the renderer is a no-op (the controller's `host.setSoundRefresh` path drives the icon).

- [ ] **Step 2: Write `src/ui/pixi/index.ts`**

```ts
import { createShell, ShellController } from '@/core';
import type { ShellConfig } from '@/core/types';
import { PixiRenderer } from './PixiRenderer';
import type { Application, Container } from 'pixi.js';

export interface PixiShellConfig extends ShellConfig { app: Application; parent?: Container; }

/** Drop-in replacement for the pixi-shell createPixiShell. */
export function createPixiShell(config: PixiShellConfig): ShellController {
  return createShell({ ...config, renderer: new PixiRenderer({ app: config.app, parent: config.parent }) });
}
export function removePixiShell(shell: ShellController): Promise<void> { return shell.destroy(); }

export { PixiRenderer };
export { ShellController as PixiGameShell };
export * from '@/core';
```
> Match the original singleton API of `packages/pixi-shell/src/index.ts` if it differs (it kept a module-level `active`); mirror it exactly.

- [ ] **Step 3: Migrate the Pixi test suite.** Copy `packages/pixi-shell/tests/*` → `packages/shell/tests/pixi/` (incl. `setup-canvas.ts`), retargeting imports from `@/...` (pixi-shell `src`) / `@energy8platform/pixi-shell` to `@energy8platform/shell/pixi` (public) or `@/ui/pixi/...` / `@/core/...` (internals): `flex`, `overlay-scroll`, `safeArea`, `hotkeys-section`, `buybonus-keys`, `keyboard`, `layout`, `picker-keys`, `pure`, `i18n`. (`i18n` may overlap core's — keep the pixi-specific assertions only, or drop if fully covered by `tests/core/i18n`.)

> `safeArea` and `pure` may reference `PixiGameShell`-specific getters (`barHeight`, `safeArea`, `setVisible`). These were on the shell class. Decide per-test: if the host integration (`createSlotGame`) needs `safeArea`/`barHeight`/`setVisible`, expose them on `ShellController` via the pixi path — BUT since game-engine stays on the old package (out of scope), it is acceptable for these tests to assert against `PixiRenderer` internals instead. Keep the assertion intent; retarget the surface.

- [ ] **Step 4: Run the Pixi suite; fix renderer until green**

Run: `npm test --workspace @energy8platform/shell -- tests/pixi`
Expected: PASS. Fix `PixiRenderer`/components to match original behavior; do not weaken tests.

- [ ] **Step 5: Build all three bundles + typecheck**

Run: `npm run build --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: `dist/{index,html,pixi}.*` emit; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/pixi packages/shell/tests/pixi
git commit -m "feat(shell/pixi): PixiRenderer + createPixiShell; migrate pixi test suite (green)"
```

---

## Phase 4 — Wire the examples

### Task 14: Switch `shell-demo` to `@energy8platform/shell/html`

**Files:**
- Modify: `examples/shell-demo/package.json`
- Modify: `examples/shell-demo/src/main.ts:1-2`

- [ ] **Step 1: Update the dependency**

In `examples/shell-demo/package.json`, replace `"@energy8platform/platform-core": "*"` with `"@energy8platform/shell": "*"`.

- [ ] **Step 2: Update the import** in `examples/shell-demo/src/main.ts`

```ts
import { createGameShell } from '@energy8platform/shell/html';
import type { GameShell, ShellMode } from '@energy8platform/shell/html';
```
(Everything else in the demo is unchanged — same config, events, methods.)

- [ ] **Step 3: Re-link + build the package, then build the demo**

Run: `npm install && npm run build --workspace @energy8platform/shell && npm run build --workspace shell-demo-example`
Expected: demo `tsc` + `vite build` succeed.

- [ ] **Step 4: Smoke-run the dev server** (manual visual check)

Run: `npm run dev --workspace shell-demo-example`
Expected: shell renders; spin/bet/turbo/autoplay/settings/info/buy-bonus/replay/theme/language all behave as before. (Examples consume built `dist` — rebuild the package if you change it; see repo memory.)

- [ ] **Step 5: Commit**

```bash
git add examples/shell-demo
git commit -m "feat(shell): point shell-demo at @energy8platform/shell/html"
```

### Task 15: Switch `pixi-shell-demo` to `@energy8platform/shell/pixi`

**Files:**
- Modify: `examples/pixi-shell-demo/package.json`
- Modify: `examples/pixi-shell-demo/src/main.ts:2-3`

- [ ] **Step 1: Update the dependency**

In `examples/pixi-shell-demo/package.json`, replace `"@energy8platform/pixi-shell": "*"` with `"@energy8platform/shell": "*"` (keep `"pixi.js"`).

- [ ] **Step 2: Update the import** in `examples/pixi-shell-demo/src/main.ts`

```ts
import { createPixiShell } from '@energy8platform/shell/pixi';
import type { PixiGameShell, ShellMode } from '@energy8platform/shell/pixi';
```

- [ ] **Step 3: Re-link + build**

Run: `npm install && npm run build --workspace @energy8platform/shell && npm run build --workspace pixi-shell-demo-example`
Expected: succeed.

- [ ] **Step 4: Smoke-run** (visual; use puppeteer Chromium for Pixi screenshot per repo memory if needed)

Run: `npm run dev --workspace pixi-shell-demo-example`
Expected: pixi shell renders over the faux canvas; all controls/overlays behave as before.

- [ ] **Step 5: Commit**

```bash
git add examples/pixi-shell-demo
git commit -m "feat(shell): point pixi-shell-demo at @energy8platform/shell/pixi"
```

---

## Phase 5 — Final verification

### Task 16: Full-repo green + sanity that nothing old changed

- [ ] **Step 1: Build everything**

Run: `npm run build`
Expected: all workspaces build (new `shell` + untouched `platform-core`, `pixi-shell`, `game-engine`).

- [ ] **Step 2: Typecheck + lint everything**

Run: `npm run typecheck && npm run lint`
Expected: clean across workspaces.

- [ ] **Step 3: Test everything**

Run: `npm test`
Expected: new `shell` suite green; `platform-core` and `pixi-shell` suites still green (unchanged).

- [ ] **Step 4: Confirm old packages + game-engine are untouched**

Run: `git diff --name-only main -- packages/platform-core packages/pixi-shell packages/game-engine`
Expected: NO output (no files changed in those packages).

- [ ] **Step 5: Final commit (if any verification fixups)**

```bash
git add -A
git commit -m "test(shell): full-repo build/typecheck/test green; old packages untouched"
```

---

## Self-Review

**Spec coverage:**
- §3.1 ShellController → Task 6. §3.2 ShellRenderer contract → Task 5. §3.3 ShellHost/ShellActions + ResolvedShellConfig → Tasks 4–5. §3.4 flows → Task 6 tests.
- §4 package layout → Tasks 1–13 (core/ui-html/ui-pixi). File mapping table → Tasks 2,3,8,9,11,12.
- §5 exports + sugar → Tasks 7,10,13. §6 build → Task 1 (rollup) + Tasks 10,13 (bundles). §7 examples → Tasks 14,15. §8 tests → Tasks 2,3,10,13. §11 DoD → Task 16.
- Non-goals (don't touch old packages/game-engine) → Global Constraints + Task 16 Step 4 guard.

**Placeholder scan:** Port steps reference exact source files to copy + explicit transform lists (not "implement later"). The few `/* copy verbatim from … */` markers point at a named source file + function — the content exists and is reproduced by copying; this is intentional for a port, not a missing detail.

**Type consistency:** `ShellHost`, `ShellRenderer`, `ShellActions`, `OverlayRequest`, `OverlayHandle`, `ShellLayoutMode`, `ShellController`, `CreateShellOptions`, `resolveConfig`, `ResolvedShellConfig`, `ShellTokens`, `createShell`, `createGameShell`, `createPixiShell`, `PixiComponentContext`, `ShellLayer` are used consistently across tasks. `host.actions` member list is fixed in Task 5 and referenced identically in Tasks 9/12.
