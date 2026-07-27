import type { LoadingScreenConfig } from '../types';
import { VARIANTS, DEFAULT_VARIANT_NAME } from './variants';
import type { PreloaderVariantHandle } from './variants';
import {
  BRAND_FLOOR_MS,
  SPLASH_CSS,
  SPLASH_DURATION_MS,
  buildSplashHTML,
} from './splash';

const PRELOADER_ID = '__ge-css-preloader__';
const REMOVE_FADE_TIMEOUT_MS = 600;

interface PreloaderState {
  container: HTMLElement;
  /** The container's inline `position` before we overrode it — restored on removal so we don't
   *  permanently clobber the host page's layout (e.g. a `#game { position: fixed; inset: 0 }`
   *  stylesheet rule, which an inline `relative` would otherwise defeat, collapsing its height). */
  prevPosition: string;
  overlay: HTMLDivElement;
  styleEl: HTMLStyleElement;
  /** Live binding to the selected variant's DOM; `null` for custom-HTML (inert lifecycle). */
  handle: PreloaderVariantHandle | null;
  /** The powered-by layer, until it has played out and been detached. */
  splashEl: HTMLDivElement | null;
  /** Pending detach of `splashEl` — cleared on removal so it can't fire late. */
  splashTimer: ReturnType<typeof setTimeout> | null;
  /** Mount time, the origin the splash + brand-floor gate is measured from. */
  startedAt: number;
  showPercentage: boolean;
  tapToStart: boolean;
  tapToStartText: string;
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

/**
 * Milliseconds still owed before the game may take over: the powered-by splash
 * plus the floor that keeps the game's own brand readable behind it. Zero once
 * that window has passed, so a slow boot pays nothing.
 */
function brandGateDelay(): number {
  if (!state) return 0;
  const elapsed = Date.now() - state.startedAt;
  return Math.max(0, SPLASH_DURATION_MS + BRAND_FLOOR_MS - elapsed);
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

  // Pick the visual identity. Unknown names fall back to the default so a bad
  // config value degrades to a working preloader rather than a blank overlay.
  const variant =
    VARIANTS[config?.preloaderVariant ?? DEFAULT_VARIANT_NAME] ??
    VARIANTS[DEFAULT_VARIANT_NAME];

  const overlay = document.createElement('div');
  overlay.id = PRELOADER_ID;
  overlay.innerHTML = customHTML || variant.buildContentHTML(config);

  // The platform's powered-by pre-roll, layered over the variant's content
  // inside the SAME overlay — one element to tear down, and no frame where the
  // page shows through between the two. Appended last so it wins the stacking
  // order. The variant content is still mounted underneath from the first
  // frame, so `setCSSPreloaderProgress` has a live target throughout the
  // splash and nothing has to be buffered and replayed on handover.
  overlay.insertAdjacentHTML('beforeend', buildSplashHTML());
  const splashEl = overlay.lastElementChild as HTMLDivElement;

  const styleEl = document.createElement('style');
  // Shared overlay infrastructure (positioning / background / fade) plus the
  // variant's own content styling and animations.
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
${variant.css}
${SPLASH_CSS}
  `;

  // The absolute overlay needs a positioned ancestor to size against. Override ONLY a container
  // whose COMPUTED position is `static`: checking the inline style alone (as this did) misses a
  // `#game { position: fixed; inset: 0 }` STYLESHEET rule — the inline `position` is empty there,
  // so we'd wrongly add an inline `relative` that beats the fixed and collapses #game to content
  // height, leaving the height:100% overlay unable to fill the screen. Remember the prior inline
  // value so removeCSSPreloader can restore it.
  const prevPosition = container.style.position;
  const computedPosition =
    typeof getComputedStyle === 'function' ? getComputedStyle(container).position : prevPosition;
  if (!computedPosition || computedPosition === 'static') {
    container.style.position = 'relative';
  }
  container.appendChild(styleEl);
  container.appendChild(overlay);

  // Custom HTML bypasses the variant's content, so there is no progress target
  // to bind to and the handle stays null (lifecycle API becomes inert).
  const handle = customHTML ? null : variant.mount(overlay, config);

  // Detach the splash once its CSS timeline has played out. Keeping a spent,
  // fully-transparent layer in the tree would otherwise sit over the content
  // for the rest of the boot.
  const splashTimer = setTimeout(() => {
    splashEl.remove();
    if (state) {
      state.splashEl = null;
      state.splashTimer = null;
    }
  }, SPLASH_DURATION_MS);

  state = {
    container,
    prevPosition,
    overlay,
    styleEl,
    handle,
    splashEl,
    splashTimer,
    startedAt: Date.now(),
    showPercentage: config?.showPercentage === true,
    tapToStart: config?.tapToStart !== false,
    tapToStartText: config?.tapToStartText ?? 'TAP TO START',
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
  if (!state.handle) return;

  state.handle.setProgress(clampProgress(progress), state.showPercentage);
}

export function waitCSSPreloaderTap(): Promise<void> {
  if (!state) {
    throw new Error(
      'CSS preloader not initialized — call createCSSPreloader first',
    );
  }
  if (state.removed) return Promise.resolve();
  if (state.tapPromise) return state.tapPromise;

  const requireTap = state.tapToStart;

  // Only the tap path takes over the status text and freezes progress; with
  // tapToStart:false the bar keeps filling behind the gate as it always did.
  if (requireTap) {
    state.handle?.showTapText(state.tapToStartText);
    state.overlay.style.cursor = 'pointer';
    state.tapState = 'waiting';
  }

  state.tapPromise = new Promise<void>((resolve) => {
    let settled = false;
    // Shared exit for every path — the gates below, and removeCSSPreloader
    // short-circuiting a pending wait during teardown.
    const finish = () => {
      if (settled) return;
      settled = true;
      if (state) {
        if (state.tapHandler) {
          state.overlay.removeEventListener('pointerdown', state.tapHandler);
          state.tapHandler = null;
        }
        if (requireTap) state.tapState = 'resolved';
        state.tapResolve = null;
      }
      resolve();
    };
    state!.tapResolve = finish;

    // Gate 1 — the powered-by splash plus the brand floor. This is what stands
    // between the splash and the game when tapToStart is false; without it a
    // fast boot would cut to gameplay while the splash was still animating.
    const gates: Promise<unknown>[] = [
      new Promise<void>((r) => setTimeout(r, brandGateDelay())),
    ];

    // Gate 2 — the player's tap, when one is required.
    if (requireTap) {
      gates.push(
        new Promise<void>((r) => {
          const handler = (_e: Event) => r();
          state!.tapHandler = handler;
          state!.overlay.addEventListener('pointerdown', handler, { once: true });
        }),
      );
    }

    void Promise.all(gates).then(finish);
  });

  return state.tapPromise;
}

export function removeCSSPreloader(_container: HTMLElement): Promise<void> {
  if (!state || state.removed) return Promise.resolve();

  // Drop the splash's pending detach — the whole overlay is going away, and a
  // late callback would touch a torn-down state.
  if (state.splashTimer !== null) {
    clearTimeout(state.splashTimer);
    state.splashTimer = null;
  }
  state.splashEl = null;

  // Detach the pending pointer listener (if any) and resolve a pending tap.
  // Teardown beats the brand gate on purpose: this is also the boot-error path
  // in GameApplication, which must not sit for seconds behind a brand floor.
  if (state.tapHandler) {
    state.overlay.removeEventListener('pointerdown', state.tapHandler);
    state.tapHandler = null;
  }
  if (state.tapResolve) state.tapResolve();

  state.removed = true;
  const { overlay, styleEl, container, prevPosition } = state;
  overlay.classList.add('ge-preloader-hidden');

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      overlay.remove();
      styleEl.remove();
      // Restore the container's original inline position so the game's own layout
      // (e.g. `#game { position: fixed; inset: 0 }`) is no longer defeated by our inline override.
      container.style.position = prevPosition;
      state = null;
      resolve();
    };

    overlay.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, REMOVE_FADE_TIMEOUT_MS);
  });
}
