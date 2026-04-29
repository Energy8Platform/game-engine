# CSS Preloader Lifecycle API — Design

**Date:** 2026-04-29
**Package:** `@energy8platform/platform-core` (>= 0.18.0)
**Status:** Approved, ready for implementation plan.

## Problem

`LoadingScreenConfig` in `@energy8platform/platform-core` declares
`tapToStart`, `tapToStartText`, and `showPercentage`, but
`createCSSPreloader` ignores all three. The preloader is currently a
fire-and-forget DOM widget that:

- Renders a CSS shimmer animation on the loader bar (no real progress).
- Has no way to receive progress from outside.
- Has no tap-to-start gate (the click handler doesn't exist).
- Is removed by a separate function `removeCSSPreloader(container)` that
  takes the container element and finds the DOM node by id.

The fields work in `LoadingScene` (game-engine), but that's a separate
HTML overlay built on top of pixi-managed DOM. The platform-core
preloader stays inert.

## Goal

Give `createCSSPreloader` (renderer-agnostic, no pixi/react/DOM-engine
integration) a real lifecycle API so any consumer can:

1. Push real progress into the preloader bar and percentage text.
2. Show a tap-to-start gate and await the user's tap.
3. Remove the preloader programmatically (already exists, slight contract
   tweak).

The mechanism stays inside platform-core; game-engine's `LoadingScene`
is **not** modified by this change.

## Non-goals

- No changes to `LoadingScene` in `@energy8platform/game-engine`.
- No audio unlock coordination (platform-core stays
  renderer/audio-agnostic). `AudioManager.setupMobileUnlock` keeps its
  own global listener.
- No multi-instance support. One preloader per page.
- No replacement for `removeCSSPreloader(container)` — only the return
  type widens from `void` to `Promise<void>`.

## Public API

Exported from `@energy8platform/platform-core/loading` and from the
package root:

```ts
function createCSSPreloader(container: HTMLElement, config?: LoadingScreenConfig): void;
function setCSSPreloaderProgress(progress: number): void;            // 0..1, clamped
function waitCSSPreloaderTap(): Promise<void>;
function removeCSSPreloader(container: HTMLElement): Promise<void>;  // was void; now resolves after fade
```

Sub-path re-exports from `@energy8platform/game-engine/loading` follow
automatically — they re-export the parent module.

## `LoadingScreenConfig` semantics

Existing fields, now actually wired through `CSSPreloader.ts`:

- **`tapToStart?: boolean`** — default `true`. If `false`, calling
  `waitCSSPreloaderTap()` resolves on the next microtask (skip flag for
  games that don't want a manual gate).
- **`tapToStartText?: string`** — default `'TAP TO START'`. Shown in the
  SVG text element while waiting for tap.
- **`showPercentage?: boolean`** — default `false`. If `true`,
  `setCSSPreloaderProgress(p)` updates the SVG text to
  `${Math.round(p*100)}%`. If `false`, percentage text stays at its
  initial value (the existing default `'Loading...'`).
- Other fields (`backgroundColor`, `backgroundGradient`,
  `cssPreloaderHTML`, `minDisplayTime`) — unchanged. `minDisplayTime` is
  not enforced here; consumers wishing to enforce it can call
  `setCSSPreloaderProgress(1)` and then delay before
  `removeCSSPreloader`.

## Internal state machine

Module-level state in `CSSPreloader.ts`:

```
idle ──create──▶ shimmering ──setProgress──▶ driven
                     │                          │
                     └──────waitTap────────┐    │
                                            ▼    ▼
                                       tap-waiting
                                            │
                                          tap (or skip if tapToStart=false)
                                            │
                                            ▼
                              shimmering/driven (handle still alive)
                                            │
                                          remove
                                            │
                                            ▼
                                        removed
```

- **shimmering** — initial visual state. CSS `@keyframes ge-loader-fill`
  oscillates the rect width. Existing behavior, unchanged.
- **driven** — first `setCSSPreloaderProgress` switches the rect from
  CSS-animated to JS-driven: kill the shimmer animation
  (`animation: none` via a `.driven` modifier on the rect), set
  `width="${p * LOADER_BAR_MAX_WIDTH}"` directly. Subsequent
  `setCSSPreloaderProgress` calls update the width and (if
  `showPercentage`) the percentage text. No way back to shimmering.
- **tap-waiting** — `waitCSSPreloaderTap()` swaps the SVG text to
  `tapToStartText`, adds a CSS pulse class (`ge-svg-pulse`), sets
  `cursor: pointer` on the overlay, attaches a single
  `pointerdown` listener on the overlay. On the event, listener is
  removed and the Promise resolves.
- **removed** — `removeCSSPreloader` adds `ge-preloader-hidden`, awaits
  `transitionend` (with safety timeout), removes the overlay and the
  `<style>` block. Promise resolves after cleanup.

## Edge cases (defaults — no interaction required)

- `setCSSPreloaderProgress` while in `tap-waiting`: ignored. Text reads
  "TAP TO START"; we don't flash percentages over it.
- `setCSSPreloaderProgress` before `createCSSPreloader` or after
  `removeCSSPreloader`: silent no-op.
- `waitCSSPreloaderTap` called twice: returns the same memoized Promise.
- `waitCSSPreloaderTap` called before `createCSSPreloader`: throws
  `Error('CSS preloader not initialized — call createCSSPreloader first')`.
  Treated as a programmer error, not a runtime race; asymmetric with
  `setCSSPreloaderProgress` (which is a silent no-op) because await-ing
  on a non-resolving Promise is a footgun, while ignoring a stray
  progress update is harmless.
- `removeCSSPreloader` called twice: idempotent. Second call resolves
  immediately.
- `removeCSSPreloader` called while `tap-waiting`: cancels the pending
  tap Promise (resolves it) and proceeds with fade-out.
- `setCSSPreloaderProgress(NaN | -1 | 1.5 | 999)`: clamped to `[0, 1]`
  via `Math.max(0, Math.min(1, p))`. `NaN` falls through `Math.min` as
  `NaN`; we treat it as `0` explicitly (`Number.isFinite(p) ? clamp(p) : 0`).

## Implementation outline

### File: `packages/platform-core/src/loading/CSSPreloader.ts`

Module-level state (no class, matches the "free functions" API style):

```ts
interface PreloaderState {
  container: HTMLElement;
  overlay: HTMLDivElement;
  styleEl: HTMLStyleElement;
  rectEl: SVGRectElement;       // #ge-pl-loader-rect
  textEl: SVGTextElement;       // #ge-pl-loader-text
  config: Required<Pick<LoadingScreenConfig, 'tapToStart' | 'tapToStartText' | 'showPercentage'>> & LoadingScreenConfig;
  driven: boolean;
  tapState: 'idle' | 'waiting' | 'resolved';
  tapPromise: Promise<void> | null;
  tapResolve: (() => void) | null;
  tapHandler: ((e: Event) => void) | null;
  removed: boolean;
}

let state: PreloaderState | null = null;
```

Functions:

- `createCSSPreloader(container, config)` — same DOM build as today, plus
  resolve `clipRectId: 'ge-pl-loader-rect'` and
  `textId: 'ge-pl-loader-text'` in the `buildLogoSVG` call so JS can
  grab the rect and text. Stash the resolved config (with defaults
  applied) and DOM refs into module state. Existing early-return on
  `document.getElementById(PRELOADER_ID)` stays — second `create` call
  is a no-op until `remove` runs.

- `setCSSPreloaderProgress(progress)` — guard: `if (!state || state.removed || state.tapState === 'waiting') return`.
  Clamp + finite-check `progress`. On first call, add `.driven` class
  to `rectEl` (CSS rule sets `animation: none`). Set
  `rectEl.setAttribute('width', String(p * LOADER_BAR_MAX_WIDTH))`.
  If `state.config.showPercentage`, set
  `textEl.textContent = '${pct}%'`.

- `waitCSSPreloaderTap()` — guard: throw if `!state`. If
  `state.removed`, resolve immediately. If `state.config.tapToStart === false`, resolve immediately.
  If `state.tapPromise` exists, return it. Otherwise:
  - swap text content to `tapToStartText`
  - add `.ge-svg-pulse` class to `textEl`
  - `state.overlay.style.cursor = 'pointer'`
  - create promise + handler, attach `pointerdown` to overlay
  - on event: remove handler, resolve promise, update `tapState = 'resolved'`

- `removeCSSPreloader(container)` — guard: `if (!state || state.removed) return Promise.resolve()`.
  If `state.tapState === 'waiting'`, resolve the pending tap promise
  first (so awaiters don't hang). Then add `.ge-preloader-hidden`,
  return a Promise that resolves on `transitionend` or after a 600ms
  safety timeout, removes overlay + style element, sets
  `state = null`.

### CSS additions

Inside the `<style>` block built in `createCSSPreloader`. Existing
shimmer keyframes (`ge-loader-fill`) and existing pulse on
`.ge-preloader-svg-text` (`ge-pulse`) stay unchanged.

```css
/* Stop shimmer once JS-driven progress takes over.
   .ge-clip-rect.driven beats .ge-clip-rect by specificity. */
.ge-clip-rect.driven {
  animation: none;
}

/* Tap-to-start CTA pulse. Compound selector
   (.ge-preloader-svg-text.ge-svg-pulse) outweighs the ambient
   .ge-preloader-svg-text rule, swapping the animation cleanly. */
.ge-preloader-svg-text.ge-svg-pulse {
  animation: ge-tap-pulse 1.2s ease-in-out infinite;
}

@keyframes ge-tap-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}
```

The new pulse is intentionally slightly different from the ambient one
(lower min opacity, faster cycle) so the tap-to-start state reads as
an active CTA rather than passive "loading" feedback.

### Type changes

In `packages/platform-core/src/types.ts`:

- No new fields. Existing `LoadingScreenConfig` is unchanged shape.
- The doc comment on `tapToStart` is rewritten:
  ```ts
  /**
   * If true, waitCSSPreloaderTap() blocks until the user clicks the
   * preloader. Default true. Set false to skip the gate.
   */
  tapToStart?: boolean;
  ```

In `packages/platform-core/src/loading/index.ts`:

- Add exports for `setCSSPreloaderProgress`, `waitCSSPreloaderTap`.

In `packages/platform-core/src/index.ts`:

- Re-export the two new functions alongside the existing
  `createCSSPreloader` / `removeCSSPreloader`.

### Sub-path mirror in game-engine

`packages/game-engine/src/loading/index.ts` re-exports from
`@energy8platform/platform-core/loading`. Add the two new function
re-exports so `@energy8platform/game-engine/loading` keeps parity. No
runtime change in game-engine itself; `LoadingScene` is untouched.

## Tests

New file: `packages/platform-core/tests/CSSPreloader.test.ts`.

`packages/platform-core/vitest.config.ts` currently sets
`environment: 'node'` and the package has no `jsdom`/`happy-dom`
devDependency. To keep existing node-mode tests (LuaEngine,
SimulationRunner, etc.) intact, do this without touching the global
config:

1. Add `jsdom` to `packages/platform-core/devDependencies` (vitest 2.x
   supports it out of the box).
2. Use the per-file directive at the top of `CSSPreloader.test.ts`:
   ```ts
   // @vitest-environment jsdom
   ```

This isolates the DOM environment to this single file. No other test
suites change behavior.

Cases:

1. `createCSSPreloader` mounts overlay, style, SVG with `#ge-pl-loader-rect` and `#ge-pl-loader-text`.
2. `setCSSPreloaderProgress(0.42)` adds `.driven` to rect, sets `width="${0.42 * 174}"`.
3. With `showPercentage: true`, `setCSSPreloaderProgress(0.42)` updates text to `42%`.
4. With `showPercentage: false` (default), text stays at `Loading...`.
5. `waitCSSPreloaderTap()` with `tapToStart: false` resolves immediately.
6. `waitCSSPreloaderTap()` with `tapToStart: true` does not resolve until a `pointerdown` is dispatched on the overlay.
7. `waitCSSPreloaderTap()` swaps text to default `'TAP TO START'` and to a custom `tapToStartText`.
8. `waitCSSPreloaderTap()` called twice returns the same Promise (referential equality).
9. `setCSSPreloaderProgress` after `waitCSSPreloaderTap` started is ignored (text stays `'TAP TO START'`).
10. `setCSSPreloaderProgress` before `createCSSPreloader` is a silent no-op.
11. `removeCSSPreloader` removes the overlay and style, resolves after `transitionend`.
12. `removeCSSPreloader` called twice is idempotent.
13. `removeCSSPreloader` while `waitCSSPreloaderTap` is pending — pending tap resolves, then preloader fades out.
14. `setCSSPreloaderProgress(NaN)` is treated as `0` (no throw).
15. `setCSSPreloaderProgress(1.5)` clamps to `1` (`width="174"`).

## Risks / open questions

- **`Promise<void>` return for `removeCSSPreloader`**: anyone calling
  `removeCSSPreloader(container)` without `await` keeps working — the
  returned Promise is just discarded. Anyone with `await
  removeCSSPreloader(container)` now actually awaits the fade. Net
  improvement; no breakage.
- **`pointerdown` vs `click`**: chose `pointerdown` because it fires
  earlier and works for both touch and mouse without double-firing. iOS
  Safari fires `pointerdown` reliably for synthetic dispatch in tests
  too.
- **Audio unlock**: deliberately left to `AudioManager`'s global
  listener (also `pointerdown`-compatible). If iOS Safari ever requires
  same-tick resume from THIS exact gesture, we'd add a sync
  `onTap?: () => void` config callback. Not needed today.
