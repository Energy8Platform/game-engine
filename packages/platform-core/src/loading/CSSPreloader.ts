import type { LoadingScreenConfig } from '../types';
import { VARIANTS, DEFAULT_VARIANT_NAME } from './variants';
import type { PreloaderVariantHandle } from './variants';

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
  `;

  // The absolute overlay needs a positioned ancestor. Only override a STATIC container, and
  // remember the prior inline value so removeCSSPreloader can restore it (an inline `relative`
  // left behind would beat the game's `#game { position: fixed; inset: 0 }` and collapse it).
  const prevPosition = container.style.position;
  container.style.position = container.style.position || 'relative';
  container.appendChild(styleEl);
  container.appendChild(overlay);

  // Custom HTML bypasses the variant's content, so there is no progress target
  // to bind to and the handle stays null (lifecycle API becomes inert).
  const handle = customHTML ? null : variant.mount(overlay, config);

  state = {
    container,
    prevPosition,
    overlay,
    styleEl,
    handle,
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
  if (!state.tapToStart) return Promise.resolve();
  if (state.tapPromise) return state.tapPromise;

  state.handle?.showTapText(state.tapToStartText);
  state.overlay.style.cursor = 'pointer';

  state.tapState = 'waiting';
  state.tapPromise = new Promise<void>((resolve) => {
    state!.tapResolve = resolve;
    const handler = (_e: Event) => {
      if (!state) return;
      state.overlay.removeEventListener('pointerdown', handler);
      state.tapHandler = null;
      state.tapState = 'resolved';
      state.tapResolve = null;
      resolve();
    };
    state!.tapHandler = handler;
    state!.overlay.addEventListener('pointerdown', handler);
  });

  return state.tapPromise;
}

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
