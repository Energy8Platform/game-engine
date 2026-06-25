import type { LoadingScreenConfig } from '../types';
import { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from './logo';

const PRELOADER_ID = '__ge-css-preloader__';
const RECT_ID = 'ge-pl-loader-rect';
const TEXT_ID = 'ge-pl-loader-text';
const REMOVE_FADE_TIMEOUT_MS = 600;

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
  /** The container's inline `position` before we overrode it — restored on removal so we don't
   *  permanently clobber the host page's layout (e.g. a `#game { position: fixed; inset: 0 }`
   *  stylesheet rule, which an inline `relative` would otherwise defeat, collapsing its height). */
  prevPosition: string;
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

  // The absolute overlay needs a positioned ancestor. Only override a STATIC container, and
  // remember the prior inline value so removeCSSPreloader can restore it (an inline `relative`
  // left behind would beat the game's `#game { position: fixed; inset: 0 }` and collapse it).
  const prevPosition = container.style.position;
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
      prevPosition,
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
    prevPosition,
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
