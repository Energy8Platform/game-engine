/**
 * Shared Energy8 SVG logo with a loader bar underneath.
 *
 * The wordmark is the official ENERGY8 artwork as vector outlines, kept at its
 * native coordinates (836.01 × 185.55). Two deviations from the Illustrator
 * export:
 *
 * - Fourteen zero-area `<path d="M…"/>` stubs are dropped (export artifacts),
 *   same as in splash.ts.
 * - The export gives every shape its own `<linearGradient>` even though they
 *   collapse to two distinct ramps — one over the letters that sit on the
 *   baseline (y 0..160.85), one over the two that descend (y 0..185.55).
 *   Colours are attributes rather than a `<style>` block on purpose: inlining
 *   the export's `<style>` would leak rules for the generic `.st0` selector
 *   into the host page.
 *
 * The loader bar is NOT part of the artwork — it is a pill drawn below the
 * wordmark, with the fill controlled via a `<clipPath>` whose `<rect>` width
 * is animatable. Different consumers customise gradient IDs and the clip
 * element's ID/class to avoid collisions when both CSSPreloader and
 * LoadingScene appear in the same DOM.
 */

/** Full width of the artwork in SVG units — the bar spans it edge to edge. */
const LOGO_WIDTH = 836.01;
/** Loader bar geometry, in SVG units, below the wordmark's 185.55 baseline. */
const BAR_Y = 215;
const BAR_H = 24;

/** SVG path data for the Energy8 wordmark, in reading order: E N E R G Y 8 */
const WORDMARK_PATHS = `
  <polygon points="133.44 0 34.47 0 0 160.84 98.96 160.89 106.94 123.69 45.07 123.72 50.37 98.97 87.48 99.01 95.46 61.78 58.31 61.89 63.63 37.09 125.48 37.15 133.44 0" fill="url(#GID0)"/>
  <polygon points="205.08 185.4 176.15 185.55 164.37 86.6 148.43 161.13 111.28 161.1 145.81 0 182.93 0 191.76 74.24 207.67 0 244.79 0 205.08 185.4" fill="url(#GID1)"/>
  <polygon points="356.14 0 257.15 0 222.7 160.82 321.67 160.8 329.64 123.59 267.78 123.61 273.07 98.96 310.18 98.94 318.16 61.73 281.02 61.84 286.34 37.02 348.18 37.14 356.14 0" fill="url(#GID0)"/>
  <path d="M455.1,0h-86.6c-11.53,53.8-22.93,107.03-34.46,160.82h37.12l13.24-61.85h12.38s-.88,61.86-.88,61.86l37.12-.04.88-61.83,15.02-12.37,15.91-74.24L455.1,0ZM417.1,61.87l-24.74-.03c1.76-8.22,6.2-28.9,7.96-37.12l24.76-.06-7.97,37.21Z" fill="url(#GID0)"/>
  <polygon points="457.75 160.84 455.99 111.33 477.21 12.3 492.22 0 578.83 0 588.59 12.19 580.6 49.49 543.46 49.53 546.13 37.08 509.01 37.11 490.46 123.69 527.57 123.7 532.87 98.98 520.5 98.96 525.8 74.24 575.31 74.2 559.4 148.42 544.35 160.9 457.75 160.84" fill="url(#GID0)"/>
  <polygon points="624.78 74.24 603.58 0 640.69 0 654.85 49.4 690.17 0 727.3 0 656.6 98.95 643.37 160.81 600.95 185.55 624.78 74.24" fill="url(#GID1)"/>
  <path d="M836.01,12.37L826.27,0h-74.23s-15.02,12.36-15.02,12.36l-13.23,61.84,15.9,6.69-18.56,5.71-13.25,61.84,9.72,12.37h74.23s15.03-12.39,15.03-12.39l13.25-61.82-18.56-5.76,21.2-6.6,13.26-61.87ZM772.38,136.13l-24.73-.04c1.76-8.22,6.19-28.89,7.95-37.1h24.74s-7.96,37.14-7.96,37.14ZM788.29,61.86l-24.74-.02c1.76-8.21,6.19-28.88,7.95-37.09l24.75-.02-7.96,37.13Z" fill="url(#GID0)"/>`;

/**
 * Gradient definitions template (gradient IDs are replaced per-consumer).
 * GID0/GID1 are the wordmark's two vertical ramps — bottom-to-top, so y1 is
 * the shape's baseline and y2 its top. GID2 is the cyan loader fill.
 */
const GRADIENT_DEFS = `
    <linearGradient id="GID0" x1="0" x2="0" y1="160.85" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#892ebf"/><stop stop-color="#862fbf" offset=".23"/><stop stop-color="#7f35c1" offset=".36"/><stop stop-color="#7539be" offset=".67"/><stop stop-color="#7139b7" offset=".72"/><stop stop-color="#6c3aae" offset=".83"/><stop stop-color="#6b3bac" offset="1"/>
    </linearGradient>
    <linearGradient id="GID1" x1="0" x2="0" y1="185.55" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#892ebf"/><stop stop-color="#862fbf" offset=".23"/><stop stop-color="#7f35c1" offset=".36"/><stop stop-color="#7539be" offset=".67"/><stop stop-color="#7139b7" offset=".72"/><stop stop-color="#6c3aae" offset=".83"/><stop stop-color="#6b3bac" offset="1"/>
    </linearGradient>
    <linearGradient id="GID2" x1="0" x2="${LOGO_WIDTH}" y1="${BAR_Y}" y2="${BAR_Y}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#316FB0"/><stop stop-color="#1FCDE6" offset=".5"/><stop stop-color="#29FEE7" offset="1"/>
    </linearGradient>`;

/** Max width of the loader bar in SVG units */
export const LOADER_BAR_MAX_WIDTH = LOGO_WIDTH;

interface LogoSVGOptions {
  /** Prefix for gradient/clip IDs to avoid collisions (e.g. 'pl' or 'ls') */
  idPrefix: string;
  /** Optional CSS class on the root <svg> */
  svgClass?: string;
  /** Optional inline style on the root <svg> */
  svgStyle?: string;
  /** Optional CSS class on the clip <rect> */
  clipRectClass?: string;
  /** Optional id on the clip <rect> (for JS access) */
  clipRectId?: string;
  /** Optional id on the percentage <text> */
  textId?: string;
  /** Default text content */
  textContent?: string;
  /** Optional CSS class on the <text> */
  textClass?: string;
}

/**
 * Build the Energy8 SVG logo with a loader bar, using unique IDs.
 *
 * @param opts - Configuration to avoid element ID collisions
 * @returns SVG markup string
 */
export function buildLogoSVG(opts: LogoSVGOptions): string {
  const { idPrefix, svgClass, svgStyle, clipRectClass, clipRectId, textId, textContent, textClass } = opts;

  // Replace gradient ID placeholders with prefixed versions
  const paths = WORDMARK_PATHS.replace(/GID(\d)/g, `${idPrefix}$1`);
  const defs = GRADIENT_DEFS.replace(/GID(\d)/g, `${idPrefix}$1`);

  const clipId = `${idPrefix}-loader-clip`;
  const fillGradientId = `${idPrefix}2`;

  const classAttr = svgClass ? ` class="${svgClass}"` : '';
  const styleAttr = svgStyle ? ` style="${svgStyle}"` : '';
  const rectClassAttr = clipRectClass ? ` class="${clipRectClass}"` : '';
  const rectIdAttr = clipRectId ? ` id="${clipRectId}"` : '';
  const txtIdAttr = textId ? ` id="${textId}"` : '';
  const txtClassAttr = textClass ? ` class="${textClass}"` : '';

  const bar = `x="0" y="${BAR_Y}" width="${LOGO_WIDTH}" height="${BAR_H}" rx="${BAR_H / 2}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_WIDTH} 310" fill="none"${classAttr}${styleAttr}>
${paths}
  <clipPath id="${clipId}">
    <rect${rectIdAttr} x="0" y="${BAR_Y}" width="0" height="${BAR_H}"${rectClassAttr}/>
  </clipPath>
  <rect ${bar} fill="url(#${fillGradientId})" opacity=".18"/>
  <rect ${bar} fill="url(#${fillGradientId})" clip-path="url(#${clipId})"/>
  <text${txtIdAttr} x="${LOGO_WIDTH / 2}" y="294" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="26" font-weight="600" letter-spacing="5"${txtClassAttr}>${textContent ?? 'Loading...'}</text>
  <defs>
${defs}
  </defs>
</svg>`;
}
