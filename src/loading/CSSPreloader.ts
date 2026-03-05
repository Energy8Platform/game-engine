import type { LoadingScreenConfig } from '../types';
import { buildLogoSVG } from './logo';

const PRELOADER_ID = '__ge-css-preloader__';

/**
 * Inline SVG logo with animated loader bar.
 * The `#loader` path acts as the progress fill — animated via clipPath.
 */
const LOGO_SVG = buildLogoSVG({
  idPrefix: 'pl',
  svgClass: 'ge-logo-svg',
  clipRectClass: 'ge-clip-rect',
  textClass: 'ge-preloader-svg-text',
});

/**
 * Creates a lightweight CSS-only preloader that appears instantly,
 * BEFORE PixiJS/WebGL is initialized.
 *
 * Displays the Energy8 logo SVG with an animated loader bar.
 */
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

  const bgGradient = config?.backgroundGradient ?? `linear-gradient(135deg, ${bgColor} 0%, #1a1a3e 100%)`;

  const customHTML = config?.cssPreloaderHTML ?? '';

  const el = document.createElement('div');
  el.id = PRELOADER_ID;
  el.innerHTML = customHTML || `
    <div class="ge-preloader-content">
      ${LOGO_SVG}
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
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
  `;

  container.style.position = container.style.position || 'relative';
  container.appendChild(style);
  container.appendChild(el);
}

/**
 * Remove the CSS preloader with a smooth fade-out transition.
 */
export function removeCSSPreloader(container: HTMLElement): void {
  const el = document.getElementById(PRELOADER_ID);
  if (!el) return;

  el.classList.add('ge-preloader-hidden');

  // Remove after transition
  el.addEventListener('transitionend', () => {
    el.remove();
    // Also remove the style element
    const styles = container.querySelectorAll('style');
    for (const style of styles) {
      if (style.textContent?.includes(PRELOADER_ID)) {
        style.remove();
      }
    }
  });
}
