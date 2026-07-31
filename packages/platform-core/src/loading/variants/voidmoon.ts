import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to. */
const RECT_ID = 'ge-vm-loader-rect';
const TEXT_ID = 'ge-vm-loader-text';

/** Left edge (SVG units) of the loader bar — aligned with the "V" of the wordmark. */
const LOADER_BAR_X = 249.79;

/** Max width (SVG units) of the voidmoon loader bar fill. Spans the wordmark: "V" → end of the final "N". */
const LOADER_BAR_MAX_WIDTH = 519;

/**
 * voidmoon logo — the official lockup, embedded verbatim as SVG outlines:
 * the crescent-moon-and-spark mark on the left, the "VOIDMOON" wordmark on the
 * right, all in #f5f5f5 (filled *and* stroked, exactly as exported — the stroke
 * is what gives the thin glyphs their weight). The export's `.st0` / `.st1`
 * classes are inlined as presentation attributes on two wrapper groups so the
 * logo carries no global CSS into the host page.
 *
 * The loader bar + status text are added beneath the lockup in the same
 * viewBox space; the viewBox is taller than the artwork (140.2) to make room.
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 769.28 215" class="ge-vm-logo-svg" style="overflow:visible" role="img">
  <title>voidmoon</title>
  <g fill="#f5f5f5" stroke="#f5f5f5" stroke-miterlimit="10">
    <polygon points="274.76 98.02 249.79 48.07 256.03 48.07 274.76 85.54 293.49 48.07 299.74 48.07 274.76 98.02"/>
    <path d="M325.51,70.2h6.24c1.12-8.22,7.63-14.65,15.83-15.85v-6.24c-11.99,1.24-20.85,10.36-22.07,22.1ZM353.82,48.1v6.24c9.03,1.32,15.48,9.27,15.48,18.67,0,10.33-8.4,18.73-18.73,18.73-9.33,0-17.41-6.36-18.82-15.3h-6.24c1.49,12.45,11.94,21.55,25.06,21.55,14.14,0,24.97-11.14,24.97-24.97,0-12.92-8.88-23.58-21.72-24.91Z"/>
    <rect x="400.39" y="48.08" width="6.24" height="49.95"/>
    <path d="M437.62,54.32l-6.14-6.24h19.14c13.15,0,23.81,10.85,23.81,24.22v.63c0,13.91-10.99,25.1-24.54,25.1-9.62,0-18.41,0-18.41,0l6.14-6.24h12.27c10.17,0,18.41-8.39,18.41-18.73h0c0-10.34-8.24-18.73-18.41-18.73h-12.27Z"/>
    <polygon points="499.59 98.02 505.83 98.02 505.85 63.24 524.56 79.29 543.29 64.35 543.29 98.02 549.54 98.02 549.54 48.07 524.62 70.2 499.59 48.07 499.59 98.02"/>
    <polygon points="725.07 68.91 731.32 74.56 731.32 98.02 725.07 98.02 725.07 68.91"/>
    <polygon points="768.78 48.07 768.78 98.01 762.53 92.38 753.31 84.06 753.31 84.05 725.07 58.51 725.07 48.1 731.32 53.73 762.53 81.87 762.53 48.07 768.78 48.07"/>
    <path d="M602.55,48.03v6.24c8.22,1.12,14.65,7.63,15.85,15.83h6.24c-1.24-11.99-10.36-20.85-22.1-22.07ZM624.65,76.34h-6.24c-1.32,9.03-9.27,15.48-18.67,15.48-10.33,0-18.73-8.4-18.73-18.73,0-9.33,6.36-17.41,15.3-18.82v-6.24c-12.45,1.49-21.55,11.94-21.55,25.06,0,14.14,11.14,24.97,24.97,24.97,12.92,0,23.58-8.88,24.91-21.72Z"/>
    <path d="M699.92,75.89h-6.24c-1.12,8.22-7.63,14.65-15.83,15.85v6.24c11.99-1.24,20.85-10.36,22.07-22.1ZM671.6,97.99v-6.24c-9.03-1.32-15.48-9.27-15.48-18.67,0-10.33,8.4-18.73,18.73-18.73,9.33,0,17.41,6.36,18.82,15.3h6.24c-1.49-12.45-11.94-21.55-25.06-21.55-14.14,0-24.97,11.14-24.97,24.97,0,12.92,8.88,23.58,21.72,24.91Z"/>
  </g>
  <g fill="#f5f5f5" stroke="#f5f5f5" stroke-miterlimit="10" stroke-width="2">
    <path d="M199.39,73.47h.01c-1.76,36.6-31.98,65.73-69.01,65.73s-67.52-29.39-69.04-66.2c-.9-.53-1.53-1.47-1.63-2.57l-22.61,2.67c-1.75.2-3.12,1.6-3.3,3.35l-2.47,24.86-3.11-24.95c-.21-1.7-1.56-3.06-3.28-3.25L.12,70.11l25.29-1.97c1.83-.14,3.28-1.57,3.46-3.38l2.47-25.88,2.47,25.88c.18,1.81,1.63,3.24,3.45,3.38l22.45,1.74c.06-1.14.7-2.13,1.64-2.68C62.87,30.38,93.2,1,130.39,1s67.25,29.12,69.01,65.72h0s-.01,0-.01,0c-1.74-30.76-27.24-55.15-58.43-55.15s-58.52,26.2-58.52,58.52,26.2,58.52,58.52,58.52,56.69-24.4,58.43-55.15Z"/>
    <path d="M202.84,70.1c0,1.86-1.51,3.38-3.37,3.38-.02,0-.05,0-.07,0,.02-.25.02-.49.03-.74-.01.25-.03.49-.04.74-1.83-.04-3.3-1.53-3.3-3.37s1.47-3.34,3.3-3.37c.01.25.03.49.04.74-.01-.25-.01-.49-.03-.74.02,0,.05,0,.07,0,1.86,0,3.37,1.51,3.37,3.38Z"/>
    <line x1="232.26" y1="70.1" x2="202.84" y2="70.1"/>
    <line x1="196.09" y1="70.1" x2="166.58" y2="70.1"/>
  </g>

  <rect x="${LOADER_BAR_X}" y="170" width="${LOADER_BAR_MAX_WIDTH}" height="6.5" rx="3.25" fill="rgba(255,255,255,0.12)"/>
  <clipPath id="vm-loader-clip">
    <rect id="${RECT_ID}" x="${LOADER_BAR_X}" y="170" width="0" height="6.5" rx="3.25" class="ge-vm-clip-rect"/>
  </clipPath>
  <rect x="${LOADER_BAR_X}" y="170" width="${LOADER_BAR_MAX_WIDTH}" height="6.5" rx="3.25" fill="#9D63FE" clip-path="url(#vm-loader-clip)"/>

  <text id="${TEXT_ID}" x="${LOADER_BAR_X + LOADER_BAR_MAX_WIDTH / 2}" y="205" text-anchor="middle" class="ge-vm-text">Loading...</text>
</svg>`;

export const voidmoonVariant: PreloaderVariant = {
  buildContentHTML() {
    return `
    <div class="ge-vm-content">
      ${LOGO_SVG}
    </div>
  `;
  },

  css: `
    .ge-vm-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 82%;
      max-width: 680px;
    }

    .ge-vm-logo-svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0 26px rgba(157, 99, 254, 0.3));
    }

    /* Shimmer the loader bar while waiting */
    .ge-vm-clip-rect {
      animation: ge-vm-fill 2s ease-in-out infinite;
    }

    @keyframes ge-vm-fill {
      0%   { width: 0; }
      50%  { width: 519px; }
      100% { width: 0; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-vm-clip-rect.driven {
      animation: none;
    }

    .ge-vm-text {
      fill: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 2.2px;
      animation: ge-vm-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-vm-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-vm-text rule, swapping the animation cleanly. */
    .ge-vm-text.ge-vm-tap-pulse {
      animation: ge-vm-tap 1.2s ease-in-out infinite;
    }

    @keyframes ge-vm-tap {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
    const textEl = overlay.querySelector(`#${TEXT_ID}`) as SVGTextElement | null;
    if (!rectEl || !textEl) return null;

    let driven = false;

    return {
      setProgress(p, showPercentage) {
        if (!driven) {
          rectEl.classList.add('driven');
          driven = true;
        }
        rectEl.setAttribute('width', String(p * LOADER_BAR_MAX_WIDTH));
        if (showPercentage) {
          textEl.textContent = `${Math.round(p * 100)}%`;
        }
      },
      showTapText(text) {
        textEl.textContent = text;
        textEl.classList.add('ge-vm-tap-pulse');
      },
    };
  },
};
