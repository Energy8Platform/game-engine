# CSS Preloader Lifecycle API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `setCSSPreloaderProgress`, `waitCSSPreloaderTap`, and a `Promise<void>`-returning `removeCSSPreloader` into `@energy8platform/platform-core/loading` so consumers can drive the existing CSS preloader's full lifecycle (progress in, tap-to-start gate, fade out) without touching `LoadingScene` or any renderer.

**Architecture:** Module-scoped state inside `CSSPreloader.ts` holds DOM refs and a small state machine (idle → shimmering ↔ driven → tap-waiting → removed). Free functions read/mutate that state. The existing CSS shimmer runs by default; first `setCSSPreloaderProgress` swaps it for JS-driven width updates; `waitCSSPreloaderTap` swaps the SVG text to "TAP TO START" and resolves on `pointerdown`. No class introduced — keeps the API surface flat (free functions, as decided). One preloader per page.

**Tech Stack:** TypeScript, vitest 2.x with per-file `jsdom` env, Rollup bundle config (no changes — `src/loading/index.ts` already drives the `loading` sub-path bundle). Renderer-agnostic — no pixi/react/sound dependencies introduced.

**Spec:** [docs/superpowers/specs/2026-04-29-css-preloader-lifecycle-design.md](../specs/2026-04-29-css-preloader-lifecycle-design.md)

---

## File Structure

- **Modify:** `packages/platform-core/src/loading/CSSPreloader.ts` — convert from stateless functions to module-scoped state; add `setCSSPreloaderProgress`, `waitCSSPreloaderTap`; widen `removeCSSPreloader` return type; add SVG ids and new CSS rules to the `<style>` block.
- **Modify:** `packages/platform-core/src/loading/index.ts` — export the two new functions.
- **Modify:** `packages/platform-core/src/index.ts` — re-export the two new functions from the package root.
- **Modify:** `packages/platform-core/src/types.ts` — refresh the doc comment on `tapToStart`. No shape change.
- **Modify:** `packages/platform-core/package.json` — add `jsdom` to `devDependencies`.
- **Modify:** `packages/game-engine/src/loading/index.ts` — re-export the two new functions for sub-path parity.
- **Create:** `packages/platform-core/tests/CSSPreloader.test.ts` — full lifecycle suite using `// @vitest-environment jsdom`.

`LoadingScene.ts` is intentionally NOT modified.

---

## Task 1: Test scaffolding (jsdom + smoke test)

**Files:**
- Modify: `packages/platform-core/package.json` (add `jsdom` devDep)
- Create: `packages/platform-core/tests/CSSPreloader.test.ts`

- [ ] **Step 1: Install jsdom devDependency**

Run from repo root:
```bash
npm install --save-dev --workspace @energy8platform/platform-core jsdom@^25
```

Expected: `package.json` of `@energy8platform/platform-core` gains `"jsdom": "^25.x"` under `devDependencies`. `package-lock.json` updated.

- [ ] **Step 2: Write a smoke test that fails until jsdom env is wired**

Create `packages/platform-core/tests/CSSPreloader.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCSSPreloader, removeCSSPreloader } from '../src/loading';

describe('CSSPreloader smoke', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('mounts the preloader overlay into the container', () => {
    createCSSPreloader(container);
    expect(document.getElementById('__ge-css-preloader__')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the smoke test and verify it passes**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: 1 passed. (Existing `removeCSSPreloader` returns `void` here — `await void` is fine in JS, the await is a forward-compat for Task 6.)

- [ ] **Step 4: Verify the rest of platform-core suite still passes**

```bash
npm test --workspace @energy8platform/platform-core
```

Expected: all suites green. The jsdom env is scoped to `CSSPreloader.test.ts` via the directive, other tests stay on `node`.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/package.json package-lock.json packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "test(platform-core): scaffold jsdom env + CSSPreloader smoke test"
```

---

## Task 2: Add SVG ids and new CSS rules (structural prep)

Adds the `id` attributes the new functions will need to grab DOM refs, plus the `.driven` and `.ge-svg-pulse` CSS rules. No behavior change yet — just preparation.

**Files:**
- Modify: `packages/platform-core/src/loading/CSSPreloader.ts:10-15` (`buildLogoSVG` call) and `packages/platform-core/src/loading/CSSPreloader.ts:48-102` (`<style>` block)
- Modify: `packages/platform-core/tests/CSSPreloader.test.ts` (add ID + style assertions)

- [ ] **Step 1: Write failing test for SVG ids**

Add to `CSSPreloader.test.ts` inside the existing `describe('CSSPreloader smoke')` block:

```ts
  it('exposes a rect with id ge-pl-loader-rect and a text with id ge-pl-loader-text', () => {
    createCSSPreloader(container);
    const rect = container.querySelector('#ge-pl-loader-rect');
    const text = container.querySelector('#ge-pl-loader-text');
    expect(rect).not.toBeNull();
    expect(text).not.toBeNull();
    expect(rect!.tagName.toLowerCase()).toBe('rect');
    expect(text!.tagName.toLowerCase()).toBe('text');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts -t "ge-pl-loader-rect"
```

Expected: FAIL — `rect` is `null` because `clipRectId` isn't set in the current `buildLogoSVG` call.

- [ ] **Step 3: Add `clipRectId` and `textId` to the `buildLogoSVG` call**

Edit `packages/platform-core/src/loading/CSSPreloader.ts` lines 10-15. Replace:

```ts
const LOGO_SVG = buildLogoSVG({
  idPrefix: 'pl',
  svgClass: 'ge-logo-svg',
  clipRectClass: 'ge-clip-rect',
  textClass: 'ge-preloader-svg-text',
});
```

with:

```ts
const LOGO_SVG = buildLogoSVG({
  idPrefix: 'pl',
  svgClass: 'ge-logo-svg',
  clipRectClass: 'ge-clip-rect',
  clipRectId: 'ge-pl-loader-rect',
  textClass: 'ge-preloader-svg-text',
  textId: 'ge-pl-loader-text',
});
```

- [ ] **Step 4: Run the id test, verify it passes**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts -t "ge-pl-loader-rect"
```

Expected: PASS.

- [ ] **Step 5: Add the new CSS rules to the `<style>` block**

In `packages/platform-core/src/loading/CSSPreloader.ts`, append the following inside the `style.textContent` template literal (after the existing `@keyframes ge-pulse` block, before the closing backtick on line 102):

```css

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-clip-rect.driven {
      animation: none;
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-preloader-svg-text rule, swapping the animation cleanly. */
    .ge-preloader-svg-text.ge-svg-pulse {
      animation: ge-tap-pulse 1.2s ease-in-out infinite;
    }

    @keyframes ge-tap-pulse {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }
```

- [ ] **Step 6: Run full file, lint, typecheck**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
npm run lint --workspace @energy8platform/platform-core
npm run typecheck --workspace @energy8platform/platform-core
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-core/src/loading/CSSPreloader.ts packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "feat(platform-core): add SVG ids and lifecycle CSS rules to CSSPreloader"
```

---

## Task 3: Module state + `setCSSPreloaderProgress`

Refactors `CSSPreloader.ts` to keep module-scoped state, then implements the progress driver.

**Files:**
- Modify: `packages/platform-core/src/loading/CSSPreloader.ts`
- Modify: `packages/platform-core/tests/CSSPreloader.test.ts`

- [ ] **Step 1: Write failing tests for `setCSSPreloaderProgress`**

Add a new `describe('setCSSPreloaderProgress')` block to `CSSPreloader.test.ts`. It needs `setCSSPreloaderProgress` imported (which doesn't exist yet — that's expected, the import will fail compile and the test will fail):

```ts
import {
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
} from '../src/loading';

// (keep the smoke describe as-is)

describe('setCSSPreloaderProgress', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('updates the rect width to progress * LOADER_BAR_MAX_WIDTH (174)', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * 174));
  });

  it('adds .driven class to the rect on first progress update', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.1);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.classList.contains('driven')).toBe(true);
  });

  it('updates percentage text when showPercentage: true', () => {
    createCSSPreloader(container, { showPercentage: true });
    setCSSPreloaderProgress(0.42);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('42%');
  });

  it('does NOT update text when showPercentage is unset (default false)', () => {
    createCSSPreloader(container);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    const before = text.textContent;
    setCSSPreloaderProgress(0.42);
    expect(text.textContent).toBe(before);
  });

  it('clamps progress to [0, 1]', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(1.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe('174');

    setCSSPreloaderProgress(-0.5);
    expect(rect.getAttribute('width')).toBe('0');
  });

  it('treats NaN as 0', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.5);
    setCSSPreloaderProgress(Number.NaN);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe('0');
  });

  it('is a silent no-op when called before createCSSPreloader', () => {
    expect(() => setCSSPreloaderProgress(0.5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail at the import (function not yet exported)**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: TypeScript compile error / import error — `setCSSPreloaderProgress` not exported.

- [ ] **Step 3: Refactor `CSSPreloader.ts` to module-scoped state and add `setCSSPreloaderProgress`**

Replace the entire body of `packages/platform-core/src/loading/CSSPreloader.ts` with the version below. Key changes from current:

- Module-level `state: PreloaderState | null` holds DOM refs and config.
- `createCSSPreloader` populates `state` (queries `#ge-pl-loader-rect` and `#ge-pl-loader-text` after appending).
- `setCSSPreloaderProgress` reads `state`, clamps + finite-checks input, sets `width` and (conditionally) text.
- `removeCSSPreloader` clears `state` after fade-out.

```ts
import type { LoadingScreenConfig } from '../types';
import { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from './logo';

const PRELOADER_ID = '__ge-css-preloader__';
const RECT_ID = 'ge-pl-loader-rect';
const TEXT_ID = 'ge-pl-loader-text';

const LOGO_SVG = buildLogoSVG({
  idPrefix: 'pl',
  svgClass: 'ge-logo-svg',
  clipRectClass: 'ge-clip-rect',
  clipRectId: RECT_ID,
  textClass: 'ge-preloader-svg-text',
  textId: TEXT_ID,
});

interface PreloaderState {
  container: HTMLElement;
  overlay: HTMLDivElement;
  styleEl: HTMLStyleElement;
  rectEl: SVGRectElement;
  textEl: SVGTextElement;
  showPercentage: boolean;
  tapToStart: boolean;
  tapToStartText: string;
  driven: boolean;
  tapState: 'idle' | 'waiting' | 'resolved';
  tapPromise: Promise<void> | null;
  tapResolve: (() => void) | null;
  tapHandler: ((e: Event) => void) | null;
  removed: boolean;
}

let state: PreloaderState | null = null;

function clampProgress(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}

export function createCSSPreloader(
  container: HTMLElement,
  config?: LoadingScreenConfig,
): void {
  if (document.getElementById(PRELOADER_ID)) return;

  const bgColor =
    typeof config?.backgroundColor === 'string'
      ? config.backgroundColor
      : typeof config?.backgroundColor === 'number'
        ? `#${config.backgroundColor.toString(16).padStart(6, '0')}`
        : '#0a0a1a';

  const bgGradient =
    config?.backgroundGradient ?? `linear-gradient(135deg, ${bgColor} 0%, #1a1a3e 100%)`;

  const customHTML = config?.cssPreloaderHTML ?? '';

  const overlay = document.createElement('div');
  overlay.id = PRELOADER_ID;
  overlay.innerHTML = customHTML || `
    <div class="ge-preloader-content">
      ${LOGO_SVG}
    </div>
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #${PRELOADER_ID} {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: ${bgGradient};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: opacity 0.4s ease-out;
    }

    #${PRELOADER_ID}.ge-preloader-hidden {
      opacity: 0;
      pointer-events: none;
    }

    .ge-preloader-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 80%;
      max-width: 700px;
    }

    .ge-logo-svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0 30px rgba(121, 57, 194, 0.4));
    }

    /* Animate the loader clip-rect to shimmer while waiting */
    .ge-clip-rect {
      animation: ge-loader-fill 2s ease-in-out infinite;
    }

    @keyframes ge-loader-fill {
      0%   { width: 0; }
      50%  { width: 174; }
      100% { width: 0; }
    }

    /* Animate the SVG text opacity */
    .ge-preloader-svg-text {
      animation: ge-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-clip-rect.driven {
      animation: none;
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-preloader-svg-text rule, swapping the animation cleanly. */
    .ge-preloader-svg-text.ge-svg-pulse {
      animation: ge-tap-pulse 1.2s ease-in-out infinite;
    }

    @keyframes ge-tap-pulse {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }
  `;

  container.style.position = container.style.position || 'relative';
  container.appendChild(styleEl);
  container.appendChild(overlay);

  const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
  const textEl = overlay.querySelector(`#${TEXT_ID}`) as SVGTextElement | null;
  if (!rectEl || !textEl) {
    // Custom HTML mode — no logo SVG, lifecycle API becomes mostly inert.
    // We still record state so removeCSSPreloader works.
    state = {
      container,
      overlay,
      styleEl,
      rectEl: null as unknown as SVGRectElement,
      textEl: null as unknown as SVGTextElement,
      showPercentage: false,
      tapToStart: config?.tapToStart !== false,
      tapToStartText: config?.tapToStartText ?? 'TAP TO START',
      driven: false,
      tapState: 'idle',
      tapPromise: null,
      tapResolve: null,
      tapHandler: null,
      removed: false,
    };
    return;
  }

  state = {
    container,
    overlay,
    styleEl,
    rectEl,
    textEl,
    showPercentage: config?.showPercentage === true,
    tapToStart: config?.tapToStart !== false,
    tapToStartText: config?.tapToStartText ?? 'TAP TO START',
    driven: false,
    tapState: 'idle',
    tapPromise: null,
    tapResolve: null,
    tapHandler: null,
    removed: false,
  };
}

export function setCSSPreloaderProgress(progress: number): void {
  if (!state || state.removed) return;
  if (state.tapState === 'waiting' || state.tapState === 'resolved') return;
  if (!state.rectEl) return;

  const p = clampProgress(progress);

  if (!state.driven) {
    state.rectEl.classList.add('driven');
    state.driven = true;
  }

  state.rectEl.setAttribute('width', String(p * LOADER_BAR_MAX_WIDTH));

  if (state.showPercentage && state.textEl) {
    state.textEl.textContent = `${Math.round(p * 100)}%`;
  }
}

export function removeCSSPreloader(container: HTMLElement): void {
  const el = document.getElementById(PRELOADER_ID);
  if (!el) return;

  el.classList.add('ge-preloader-hidden');

  el.addEventListener('transitionend', () => {
    el.remove();
    const styles = container.querySelectorAll('style');
    for (const style of styles) {
      if (style.textContent?.includes(PRELOADER_ID)) {
        style.remove();
      }
    }
  });
}
```

Note: `removeCSSPreloader` still returns `void` here. It gets widened in Task 6.

- [ ] **Step 4: Export `setCSSPreloaderProgress` from `loading/index.ts`**

Edit `packages/platform-core/src/loading/index.ts`. Replace:

```ts
export { createCSSPreloader, removeCSSPreloader } from './CSSPreloader';
```

with:

```ts
export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  removeCSSPreloader,
} from './CSSPreloader';
```

- [ ] **Step 5: Run progress tests, verify they pass**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: all `setCSSPreloaderProgress` cases PASS plus the prior smoke + id tests still PASS.

- [ ] **Step 6: Lint + typecheck**

```bash
npm run lint --workspace @energy8platform/platform-core
npm run typecheck --workspace @energy8platform/platform-core
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-core/src/loading/CSSPreloader.ts packages/platform-core/src/loading/index.ts packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "feat(platform-core): setCSSPreloaderProgress drives bar + percentage text"
```

---

## Task 4: `waitCSSPreloaderTap` — skip path

Implements the no-op-when-disabled half first: `tapToStart: false` resolves immediately. This task pins down the function signature and the export wiring before the active path's DOM event work.

**Files:**
- Modify: `packages/platform-core/src/loading/CSSPreloader.ts`
- Modify: `packages/platform-core/src/loading/index.ts`
- Modify: `packages/platform-core/tests/CSSPreloader.test.ts`

- [ ] **Step 1: Write failing tests for the skip path**

Append to `CSSPreloader.test.ts`:

```ts
import {
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
} from '../src/loading';

describe('waitCSSPreloaderTap (skip path)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('resolves immediately when config.tapToStart === false', async () => {
    createCSSPreloader(container, { tapToStart: false });
    await expect(waitCSSPreloaderTap()).resolves.toBeUndefined();
  });

  it('throws when called before createCSSPreloader', () => {
    expect(() => waitCSSPreloaderTap()).toThrow(
      /CSS preloader not initialized/,
    );
  });
});
```

(Update the import line at the top of the file rather than duplicating it. The block above shows the desired final import shape.)

- [ ] **Step 2: Run tests, verify they fail at the import**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: import error — `waitCSSPreloaderTap` not exported.

- [ ] **Step 3: Add `waitCSSPreloaderTap` skeleton to `CSSPreloader.ts`**

Append after `setCSSPreloaderProgress`:

```ts
export function waitCSSPreloaderTap(): Promise<void> {
  if (!state) {
    throw new Error(
      'CSS preloader not initialized — call createCSSPreloader first',
    );
  }
  if (state.removed) return Promise.resolve();
  if (!state.tapToStart) return Promise.resolve();
  if (state.tapPromise) return state.tapPromise;

  // Active path is implemented in Task 5. Until then, fall through to a
  // resolved Promise so the package stays usable; Task 5's failing
  // tests will drive the real listener wiring.
  return Promise.resolve();
}
```

- [ ] **Step 4: Export `waitCSSPreloaderTap` from `loading/index.ts`**

Update `packages/platform-core/src/loading/index.ts` to:

```ts
export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
} from './CSSPreloader';
```

- [ ] **Step 5: Run skip-path tests, verify they pass**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts -t "waitCSSPreloaderTap"
```

Expected: both skip-path tests PASS. (Active-path tests don't exist yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/loading/CSSPreloader.ts packages/platform-core/src/loading/index.ts packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "feat(platform-core): waitCSSPreloaderTap skip path (tapToStart=false)"
```

---

## Task 5: `waitCSSPreloaderTap` — active path

Wires the actual `pointerdown` listener, swaps the SVG text to "TAP TO START", and resolves on event.

**Files:**
- Modify: `packages/platform-core/src/loading/CSSPreloader.ts`
- Modify: `packages/platform-core/tests/CSSPreloader.test.ts`

- [ ] **Step 1: Write failing tests for the active path**

Append to `CSSPreloader.test.ts`:

```ts
describe('waitCSSPreloaderTap (active path)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('swaps text to default "TAP TO START" while waiting', () => {
    createCSSPreloader(container);
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
    expect(text.classList.contains('ge-svg-pulse')).toBe(true);
  });

  it('honors a custom tapToStartText', () => {
    createCSSPreloader(container, { tapToStartText: 'PLAY' });
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('PLAY');
  });

  it('sets cursor: pointer on the overlay while waiting', () => {
    createCSSPreloader(container);
    void waitCSSPreloaderTap();
    const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
    expect(overlay.style.cursor).toBe('pointer');
  });

  it('resolves when a pointerdown is dispatched on the overlay', async () => {
    createCSSPreloader(container);
    const tap = waitCSSPreloaderTap();

    const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
    overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    await expect(tap).resolves.toBeUndefined();
  });

  it('returns the same Promise on subsequent calls (memoized)', () => {
    createCSSPreloader(container);
    const a = waitCSSPreloaderTap();
    const b = waitCSSPreloaderTap();
    expect(a).toBe(b);
  });

  it('ignores setCSSPreloaderProgress while waiting (text stays as tap label)', () => {
    createCSSPreloader(container, { showPercentage: true });
    setCSSPreloaderProgress(0.3);
    void waitCSSPreloaderTap();
    setCSSPreloaderProgress(0.9);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts -t "waitCSSPreloaderTap \\(active path\\)"
```

Expected: all six FAIL — current implementation throws "active path not yet implemented".

- [ ] **Step 3: Replace the throw stub with the real active path**

In `packages/platform-core/src/loading/CSSPreloader.ts`, replace the body of `waitCSSPreloaderTap` with:

```ts
export function waitCSSPreloaderTap(): Promise<void> {
  if (!state) {
    throw new Error(
      'CSS preloader not initialized — call createCSSPreloader first',
    );
  }
  if (state.removed) return Promise.resolve();
  if (!state.tapToStart) return Promise.resolve();
  if (state.tapPromise) return state.tapPromise;

  if (state.textEl) {
    state.textEl.textContent = state.tapToStartText;
    state.textEl.classList.add('ge-svg-pulse');
  }
  state.overlay.style.cursor = 'pointer';

  state.tapState = 'waiting';
  state.tapPromise = new Promise<void>((resolve) => {
    state!.tapResolve = resolve;
    const handler = (_e: Event) => {
      if (!state) return;
      state.overlay.removeEventListener('pointerdown', handler);
      state.tapHandler = null;
      state.tapState = 'resolved';
      resolve();
    };
    state!.tapHandler = handler;
    state!.overlay.addEventListener('pointerdown', handler);
  });

  return state.tapPromise;
}
```

- [ ] **Step 4: Run all CSSPreloader tests, verify they pass**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: every test in the file passes (smoke, ids, progress, skip path, active path).

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint --workspace @energy8platform/platform-core
npm run typecheck --workspace @energy8platform/platform-core
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/loading/CSSPreloader.ts packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "feat(platform-core): waitCSSPreloaderTap active path with pointerdown"
```

---

## Task 6: `removeCSSPreloader` returns `Promise<void>` + idempotency + cancels pending tap

Widens the return type and integrates state-based cleanup, including cancelling a pending `waitCSSPreloaderTap`.

**Files:**
- Modify: `packages/platform-core/src/loading/CSSPreloader.ts`
- Modify: `packages/platform-core/tests/CSSPreloader.test.ts`

- [ ] **Step 1: Write failing tests for the new contract**

Append to `CSSPreloader.test.ts`:

```ts
describe('removeCSSPreloader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('returns a Promise that resolves after the overlay is removed', async () => {
    createCSSPreloader(container);
    const result = removeCSSPreloader(container);
    expect(result).toBeInstanceOf(Promise);

    // jsdom does not fire transitionend automatically — use the
    // safety-timeout path. The Promise must still resolve.
    await result;

    expect(document.getElementById('__ge-css-preloader__')).toBeNull();
  });

  it('is idempotent — second call resolves without throwing', async () => {
    createCSSPreloader(container);
    await removeCSSPreloader(container);
    await expect(removeCSSPreloader(container)).resolves.toBeUndefined();
  });

  it('resolves a pending waitCSSPreloaderTap before fading', async () => {
    createCSSPreloader(container);
    const tap = waitCSSPreloaderTap();
    const removed = removeCSSPreloader(container);

    // The tap Promise resolves first (synchronously inside removeCSSPreloader),
    // then the fade-out completes and removed resolves.
    await expect(tap).resolves.toBeUndefined();
    await expect(removed).resolves.toBeUndefined();
    expect(document.getElementById('__ge-css-preloader__')).toBeNull();
  });

  it('setCSSPreloaderProgress after remove is a silent no-op', async () => {
    createCSSPreloader(container);
    await removeCSSPreloader(container);
    expect(() => setCSSPreloaderProgress(0.5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts -t "removeCSSPreloader"
```

Expected: FAIL — current `removeCSSPreloader` returns `void`, never resolves the pending tap, and the second call writes `null` listener but that's not the bug — first test fails because the function returns `undefined` not a Promise.

- [ ] **Step 3: Reimplement `removeCSSPreloader` with state-aware cleanup and Promise return**

In `packages/platform-core/src/loading/CSSPreloader.ts`:
1. Add the constant `REMOVE_FADE_TIMEOUT_MS` near the top of the file, alongside the other module constants (after the `TEXT_ID` definition).
2. Replace the entire body of the existing `removeCSSPreloader` export with the new version below.

```ts
const REMOVE_FADE_TIMEOUT_MS = 600;

export function removeCSSPreloader(_container: HTMLElement): Promise<void> {
  if (!state || state.removed) return Promise.resolve();

  // Detach the pending pointer listener (if any) and resolve a pending tap.
  if (state.tapHandler) {
    state.overlay.removeEventListener('pointerdown', state.tapHandler);
    state.tapHandler = null;
  }
  if (state.tapState === 'waiting' && state.tapResolve) {
    state.tapState = 'resolved';
    state.tapResolve();
    state.tapResolve = null;
  }

  state.removed = true;
  const { overlay, styleEl } = state;
  overlay.classList.add('ge-preloader-hidden');

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      overlay.remove();
      styleEl.remove();
      state = null;
      resolve();
    };

    overlay.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, REMOVE_FADE_TIMEOUT_MS);
  });
}
```

The `_container` parameter is kept for backwards-compat with the existing signature (callers already pass it). Cleanup now uses the stashed `styleEl` reference instead of scanning the container's `<style>` children.

- [ ] **Step 4: Run all CSSPreloader tests, verify they pass**

```bash
npx vitest run packages/platform-core/tests/CSSPreloader.test.ts
```

Expected: every test passes.

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint --workspace @energy8platform/platform-core
npm run typecheck --workspace @energy8platform/platform-core
```

Expected: green. (The `_container` underscore prefix communicates it's intentionally unused; ESLint's `no-unused-vars` should accept it.)

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/loading/CSSPreloader.ts packages/platform-core/tests/CSSPreloader.test.ts
git commit -m "feat(platform-core): removeCSSPreloader returns Promise, idempotent, cancels pending tap"
```

---

## Task 7: Re-export from package root + update doc comment + game-engine sub-path

**Files:**
- Modify: `packages/platform-core/src/index.ts`
- Modify: `packages/platform-core/src/types.ts`
- Modify: `packages/game-engine/src/loading/index.ts`

- [ ] **Step 1: Re-export from `platform-core/src/index.ts`**

Edit `packages/platform-core/src/index.ts`. Replace the existing branded loading export block (lines 40-49) with:

```ts
// ─── Branded loading screen ─────────────────────────────
// Renderer-agnostic CSS preloader showing the Energy8 platform logo.
// Use this in any host (Pixi, Phaser, Three.js, custom) to keep the
// brand consistent across games on the platform.
export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from './loading';
```

- [ ] **Step 2: Re-export from game-engine sub-path**

Edit `packages/game-engine/src/loading/index.ts`. Replace:

```ts
export {
  createCSSPreloader,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from '@energy8platform/platform-core/loading';
```

with:

```ts
export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from '@energy8platform/platform-core/loading';
```

- [ ] **Step 3: Update doc comment on `tapToStart` in `types.ts`**

Edit `packages/platform-core/src/types.ts:58-61`. Replace:

```ts
  /** Show "Tap to start" after loading (needed for mobile audio unlock) */
  tapToStart?: boolean;
  /** "Tap to start" label text */
  tapToStartText?: string;
```

with:

```ts
  /**
   * If true (default), `waitCSSPreloaderTap()` blocks until the user
   * clicks the preloader. Set to `false` to make `waitCSSPreloaderTap()`
   * resolve immediately (skip-flag for games that don't want a manual
   * gate). Useful for mobile audio unlock — the click satisfies the
   * browser's user-gesture requirement.
   */
  tapToStart?: boolean;
  /** Label shown in the SVG text element while waiting for tap. Default: 'TAP TO START'. */
  tapToStartText?: string;
```

- [ ] **Step 4: Typecheck both packages**

```bash
npm run typecheck --workspace @energy8platform/platform-core
npm run typecheck --workspace @energy8platform/game-engine
```

Expected: both green. (game-engine's typecheck pulls in the updated platform-core types from source via path aliases / project refs — confirm by checking `packages/game-engine/tsconfig.json` if anything fails, but no edit should be needed.)

- [ ] **Step 5: Build platform-core to verify the new sub-path bundle is correct**

```bash
npm run build --workspace @energy8platform/platform-core
```

Expected: green build. Inspect `packages/platform-core/dist/loading.d.ts` — it should contain declarations for `setCSSPreloaderProgress`, `waitCSSPreloaderTap`, plus the existing exports.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/index.ts packages/platform-core/src/types.ts packages/game-engine/src/loading/index.ts
git commit -m "feat(platform-core,game-engine): re-export new CSS preloader lifecycle fns"
```

---

## Task 8: Full verification across both packages

Catches anything Task 7 missed and confirms `LoadingScene` (the unrelated game-engine path) didn't regress.

- [ ] **Step 1: Lint + typecheck both packages**

```bash
npm run lint
npm run typecheck
```

Expected: green across both workspaces.

- [ ] **Step 2: Run full test suites**

```bash
npm test
```

Expected: green. Specifically confirm:
- `packages/platform-core/tests/CSSPreloader.test.ts` — all new cases pass.
- `packages/platform-core/tests/PlatformSession.test.ts` — still passes (renderer-agnostic smoke is untouched).
- `packages/platform-core/tests/LuaEngine.test.ts`, `ActionRouter.test.ts`, `SimulationRunner.test.ts`, `DevBridge.test.ts` — still pass on `node` env (the per-file `jsdom` directive only scoped to the new file).
- `packages/game-engine/tests/*` — still pass (LoadingScene wasn't touched).

- [ ] **Step 3: Build both packages**

```bash
npm run build
```

Expected: green. Spot-check `packages/platform-core/dist/index.d.ts` and `packages/platform-core/dist/loading.d.ts` for the new exports.

- [ ] **Step 4: Verify no `LoadingScene` regression by searching for stale references**

```bash
grep -n "createCSSPreloader\|removeCSSPreloader\|setCSSPreloaderProgress\|waitCSSPreloaderTap" \
  packages/game-engine/src/core/GameApplication.ts \
  packages/game-engine/src/loading/LoadingScene.ts
```

Expected: only the existing `createCSSPreloader` / `removeCSSPreloader` calls in `GameApplication.ts` (still pre-pixi early gate). `LoadingScene.ts` does not call the new lifecycle functions — it keeps its own SVG overlay, by design.

- [ ] **Step 5: Final commit (if anything was tweaked) or confirm clean tree**

```bash
git status
```

Expected: clean working tree (nothing to commit). If lint/typecheck flagged something in Task 8 Step 1, fix it inline with a targeted commit message.
