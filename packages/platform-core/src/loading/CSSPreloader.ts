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
  if (state.tapState === 'waiting') return;
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
  if (!el) {
    state = null;
    return;
  }

  el.classList.add('ge-preloader-hidden');

  el.addEventListener('transitionend', () => {
    el.remove();
    const styles = container.querySelectorAll('style');
    for (const style of styles) {
      if (style.textContent?.includes(PRELOADER_ID)) {
        style.remove();
      }
    }
    state = null;
  });
}
