import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to. */
const RECT_ID = 'ge-hb-loader-rect';
const TEXT_ID = 'ge-hb-loader-text';

/** The lockup is drawn for a black backdrop (the buddha's silhouette is near-black; its detail and the
 *  wordmark are white), so the screen is always black. */
const BACKGROUND = '#000';

/**
 * Length of the lockup's own intro — the artwork's 8s CSS timeline (heartbeat,
 * letters stamping in, a second beat, then settling to white). The loader bar
 * is held back until it has played, and so is the brand gate.
 */
export const HELLBUDDHA_INTRO_MS = 3500;

/** Left edge (SVG units) of the loader bar — just clear of the buddha's right knee. */
const LOADER_BAR_X = 500;

/** Max width (SVG units) of the loader bar fill. Runs to the end of the wordmark's "a". */
export const LOADER_BAR_MAX_WIDTH = 1064;

/** Top (SVG units) of the loader bar — under the wordmark (the "H" leg ends at 624). */
const LOADER_BAR_Y = 652;

/** Thickness (SVG units) of the loader bar. */
const LOADER_BAR_H = 10;

/** The artwork's own red — the heartbeat colour of the lockup. */
const RED = '#FF2A1E';

/**
 * Hellbuddha lockup — the meditating buddha on the left (a near-black silhouette
 * with white detail), the "Hellbuddha" wordmark on the right — the brand's
 * 2026-10-01 artwork (Illustrator export, 1584×1056), paths copied verbatim and
 * regrouped for the intro: the silhouette is `.dark`, the white detail is one
 * `.f` group (the heartbeat fill), and each letter is a `.ltr lN` group, l0..l9
 * left to right (the stamp-in order). The viewBox is cropped to the artwork.
 *
 * The loader bar sits OUTSIDE `.ge-hb`: that group's universal rule pins every
 * descendant to the 8s one-shot timeline, which would kill the bar's shimmer.
 * The status text is not in the SVG at all — it is pinned to the bottom of the
 * screen (see `buildContentHTML`).
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 250 1580 470" class="ge-hb-logo-svg" style="overflow:visible" role="img" aria-label="Hellbuddha">
  <g class="ge-hb">
    <g class="body">
      <polygon class="dark" points="475.75 631.54 443.41 679.36 413.35 687.06 381.37 698.16 352.21 701.12 312.57 707.05 280.03 699.06 257.42 692.98 234.28 687.21 214.88 690.17 162.62 701.12 133.46 698.16 101.48 687.06 71.42 679.36 36.19 631.54 50.41 599.11 27.75 581.65 13.69 544.04 35.45 501.26 12.06 501.85 11.91 496.96 59.95 464.1 106.52 449.44 74.83 537.09 61.5 518.72 54.99 539.15 64.18 554.25 78.8 571.55 87.57 568.18 86.08 545.38 101.48 511.96 113.03 493.46 113.03 471.94 132.58 449.27 151.81 436.7 174.03 436.11 186.75 427.53 224.66 414.2 257.38 433.45 290.17 414.2 328.08 427.53 340.8 436.11 363.02 436.7 382.25 449.27 401.81 471.94 401.81 493.46 413.35 511.96 428.75 545.38 426.04 587.12 451.17 595.12 461.39 599.94 475.75 631.54"/>
      <path class="dark" d="M325.51,327.3s1.03,8.68-.06,12.61l5.01.56,5.79,10.62s-10.55,26.58-10.66,35.02c-.15,10.06,5.18,31.68,5.18,31.68l-6.81,8.59s-10.67,3.78-14.34,2.89c-1.56-.39-6.61-4.52-6.61-4.52l-2.3-6.96s-11.28,9.76-12,10.06c-14.87,6.29-31.31,8.29-31.31,8.29,0,0-16.42-2-31.3-8.29-.72-.3-12-10.06-12-10.06l-2.3,6.96s-5.05,4.13-6.61,4.52c-3.67.89-14.34-2.89-14.34-2.89l-6.81-8.59s5.33-21.62,5.18-31.68c-.12-8.43-10.66-35.02-10.66-35.02l5.8-10.62,4.99-.56c-1.08-3.93-.05-12.61-.05-12.61,0,0-7.54-5.83-12.58-22.33-.63-2.08,5.49-24.73,6.15-25.25,18.95-14.88,23.66-15.27,23.66-15.27,0,0-5.23,13.64-5.84,18.9-.3,2.57,2.56,10.01,2.56,10.01,0,0,7.48,3.94,7.65,3.8,3.13-2.63,13.05-5.89,13.05-5.89,0,0,3.28-6.86,3.93-7.78.79-1.11,11.71-3.78,11.71-3.78,1.46-2.26,17.81-13.76,17.81-13.76,0,0,16.36,11.5,17.82,13.76,0,0,10.91,2.67,11.71,3.78.65.92,3.93,7.78,3.93,7.78,0,0,9.92,3.25,13.03,5.89.17.14,7.66-3.8,7.66-3.8,0,0,2.84-7.44,2.56-10.01-.61-5.26-5.83-18.9-5.83-18.9,0,0,4.7.39,23.66,15.27.65.52,6.77,23.17,6.14,25.25-5.02,16.51-12.58,22.33-12.58,22.33h0Z"/>
      <g class="f">
        <path d="M416.79,554.61c-5.48-19.79-19.43-42.84-19.43-42.84l-3.71,19.98s-1.89-13.36-7.4-31.23l-.81-23.55s-16.61-20.14-24.2-23.99c-3.58-1.81-15.85-2.52-15.85-2.52,0,0-26.4,13.29-35.67,16.58-8.89,3.16-36.53,10.14-36.53,10.14l2.48-4.66s32.38-14.36,41.31-18.51c.66-.3,13.02-10.66,13.02-10.66l-30.11-12.35-4.08,16.35-13.92,9.92,5.63-11.7,2.36-18.06-32.46,41.28-32.46-41.28,2.36,18.06,5.63,11.7-13.92-9.92-4.08-16.35-30.12,12.35s12.37,10.36,13.03,10.66c8.93,4.15,41.31,18.51,41.31,18.51l2.48,4.66s-27.64-6.97-36.53-10.14c-9.27-3.29-35.69-16.58-35.69-16.58,0,0-12.26.71-15.84,2.52-7.59,3.85-24.2,23.99-24.2,23.99l-.81,23.55c-5.52,17.88-7.4,31.23-7.4,31.23l-3.71-19.98s-13.95,23.06-19.43,42.84c-1.41,5.06-.85,20.81-.85,20.81l9.03-6.35,29.32,20.28,31.94,7.04,16.05-5.01s-7.4-5.14-36.75-28.67l-26.94-13.92,20.72,1.33,8.15,2.38,14.07-21.66,1.18-24.98-22.36,4.88,32.28-23.09,12.74,32.14,16.88,11.06,37.75-3.36-36.13,14.21,8.43,15.69.89,15.85,18.35-2.97,19.4-11.25,5.22,4.15,5.22-4.15,19.4,11.25,18.35,2.97.89-15.85,8.43-15.69-36.13-14.21,37.75,3.36,16.88-11.06,12.74-32.14,32.26,23.09-22.34-4.88,1.18,24.98,14.07,21.66,8.15-2.38,20.72-1.33-26.94,13.92c-29.35,23.53-36.75,28.67-36.75,28.67l16.05,5.01,31.94-7.04,29.32-20.28,9.03,6.35s.56-15.74-.85-20.81ZM257.42,510.58l-8.18-17.48,8.18-16.79,8.18,16.79-8.18,17.48Z"/>
        <polygon points="196.23 580.24 206.23 574.91 202.01 559.21 186.91 544.04 196.23 580.24"/>
        <path d="M337.52,604.44l-18.04,13.11-36.19,11.17,14.21-11.84-16.65,6.21s-9.13,1.28-12.22,1.56c-2.79.25-11.21.66-11.21.66,0,0-8.42-.41-11.21-.66-3.1-.28-12.22-1.56-12.22-1.56l-16.66-6.21,14.22,11.84-36.2-11.17-18.04-13.11,36.26-20.65,24.5-4.15,12.58-8.51s2.6,6.23,2.38,7.7c-.41,2.71-7.04,10.73-7.04,10.73,0,0-13.43,3.41-14.88,4-2.26.93-7.76,5.99-7.76,5.99,0,0,14.54,10.02,15.2,10.22,12.06,3.47,18.88,2,18.88,2,0,0,6.81,1.47,18.87-2,.67-.19,15.22-10.22,15.22-10.22,0,0-5.5-5.06-7.78-5.99-1.43-.59-14.88-4-14.88-4,0,0-6.63-8.02-7.03-10.73-.22-1.47,2.36-7.7,2.36-7.7l12.59,8.51,24.5,4.15,36.24,20.65Z"/>
        <path d="M87.92,587.28l-24.05,9.11s-15.76-10.42-24.8-19.92c-.84-.88-13.55-31.98-13.55-31.98,2.84-10.13,13.15-31.41,13.15-31.41l13.94-16.86h-23.09s22.67-15.36,30.57-19.9c9.18-5.27,34.28-16.22,34.28-16.22l-21.03,59.22-10.06-18.95-10.95,15.4s-9.3,24.64-9.05,26.84c.32,2.84,11.81,22.99,12.9,24.09,15.18,15.1,31.75,20.59,31.75,20.59h0Z"/>
        <polygon points="158.48 608.22 140.94 594.9 117.39 587.12 59.95 607.56 49.22 631.54 75.43 667.73 119.61 679.73 97.09 659.52 86.75 628.73 103.86 645.97 125.39 655.75 208.89 644.86 165.8 659.52 132.49 683.28 163.59 689.06 205.12 680.83 270.18 643.97 249.24 638.09 226.66 641.31 195.12 627.54 166.25 618.21 104.95 606.21 128.94 603.33 158.48 608.22"/>
        <polygon points="279.28 651.52 236.43 678.62 297.71 689.06 312.37 695.71 311.26 680.83 306.6 673.62 316.38 679.06 323.04 692.39 330.59 695.71 337.52 688.17 325.48 661.96 279.28 651.52"/>
        <polygon points="285.06 640.64 347.25 618.21 405.2 607.11 382.11 602.66 352.79 607.78 370.12 594.9 393.66 587.12 450.28 608 461.39 631.31 432.52 669.74 391.43 679.73 413.64 659.52 424.34 628.73 406.09 645.97 386.99 654.86 341.02 644.42 388.99 676.4 360.78 685.95 349.24 666.62 330.15 649.08 285.06 640.64"/>
        <polygon points="318.6 580.24 308.6 574.91 312.83 559.21 327.93 544.04 318.6 580.24"/>
        <polygon points="206.04 322.67 216.55 314.75 198.85 306.58 192.12 290.25 194.66 283.37 189.23 290.32 189.77 304.11 196.46 314.89 206.04 322.67"/>
        <path d="M298.28,334.01c-1.54-1.82-7.47-4.82-7.47-4.82v-8.72l-14.54-5,5.99-8.43-12.83,6.51-12.02,8.94-12.02-8.94-12.83-6.51,5.99,8.43-14.54,5v8.72s-5.93,3-7.47,4.82c-1.81,2.14-5.85,10.06-5.85,10.06,0,0,9.6-5.58,13.19-5.7.48,0,14.39,4.26,18.79,7.18,5.26,3.47,9.04,11.47,9.04,11.47,0,0,.28,24.13.28,26.43,0,1.28-2.43-3.72-3.69-3.55-1.82.23-2.82,5.99-2.82,6.81,0,.27,6.23-.74,6.23-.74l5.7,2.36,5.7-2.36s6.23,1.01,6.23.74c0-.81-.99-6.57-2.82-6.81-1.27-.17-3.69,4.83-3.69,3.55,0-2.3.28-26.43.28-26.43,0,0,3.78-8,9.04-11.47,4.4-2.92,18.32-7.18,18.79-7.18,3.59.12,13.19,5.7,13.19,5.7,0,0-4.04-7.92-5.85-10.06h0ZM257.42,348.95l-4.37-8.65,4.37-9.33,4.29,8.99-4.29,8.99h0Z"/>
        <path d="M230.61,368.34c2.96.48,10.41-.72,10.41-.72l-7.67,2.45s-5.06-.12-6.01-.25c-4.37-.63-7.92-5.55-7.92-5.55-1.05-.26,4.4,2.96,11.17,4.07h.01Z"/>
        <path d="M227.88,361.84l-17.18-6.07s10.29-5.49,14.07-5.48c4.11.01,15.25,6.06,15.25,6.06l5.04,8.45-4.74-2.52-12.44-.44Z"/>
        <path d="M294.52,368.71c-1.38,1.72-10.13,3.63-13.63,3.41-3.29-.21-12.76-3.41-12.88-3.41.37,12.85,3.71,14,3.77,17.85.03,1.2-2.7,3.97-2.7,3.97l-5.22,1.87-2.76,2.84-3.69,1.99-3.71-1.99-2.76-2.84-5.22-1.87s-2.73-2.76-2.7-3.97c.06-3.85,3.4-5,3.77-17.85-.12,0-9.58,3.2-12.88,3.41-3.5.22-12.24-1.69-13.63-3.41-3.13-3.86-11.4-3.99-11.4-3.99l3.56,12.14,11.84,9.62.88,25.91,12.59,10.36,3.37-1.86s1.02,5.88,1.65,5.71c9.55-2.56,13.88-3.04,14.61-3.1h.04c.83.08,5.18.58,14.58,3.1.63.17,1.65-5.71,1.65-5.71l3.37,1.86,12.59-10.36.88-25.91,11.84-9.62,3.56-12.14s-8.28.13-11.4,3.99h0ZM257.42,419.54l-3.91-3.85,3.8-.04h.22l3.8.04-3.9,3.85h0ZM264.84,413.8h-14.87l-6.14-6.59,6.65,2.51,6.79-.22h.25l6.79.22,6.65-2.51-6.14,6.59ZM278.53,403.51v-2.31l-4.44,2.61-11.99.04-4.69,1.55-4.7-1.55-11.99-.04-4.46-2.61v2.31l-3.06-4.15,3.27-3.1-.14,2.56,5.17,1.98,11.38-2.53,4.42,2.18.12.05.1-.05,4.42-2.18,11.38,2.53,5.17-1.98-.14-2.56,3.27,3.1-3.07,4.15Z"/>
        <path d="M214.74,413.13l-5.44-4.66-2.51-26.83s4.61,5.06,7.94,31.49h0Z"/>
        <polygon points="309.43 322.67 298.92 314.75 316.61 306.58 323.34 290.25 320.81 283.37 326.23 290.32 325.68 304.11 319 314.89 309.43 322.67"/>
        <path d="M194.2,375.84c.4.45,8.42,10.01,7.67,46.18-.03,1.15-3.85,3.22-3.85,3.22l-2.73-.44-2.44-3.22c6.78-29.44,1.54-45.14,1.34-45.74Z"/>
        <path d="M197.08,368.83s-4.22-9.88-10.33-11.81c0-.15,3.89-4.62,3.89-4.62l1.65.3,2.96,2.09,1.83,14.04h0Z"/>
        <path d="M299.75,412.64l5.44-4.66,2.51-26.83s-4.61,5.06-7.94,31.49h0Z"/>
        <path d="M320.29,375.35c-.4.45-8.42,10.01-7.67,46.18.03,1.15,3.85,3.22,3.85,3.22l2.73-.44,2.44-3.22c-6.78-29.44-1.54-45.14-1.34-45.74Z"/>
        <path d="M327.74,356.53c-6.11,1.92-10.33,11.81-10.33,11.81l1.83-14.04,2.96-2.09,1.65-.3s3.89,4.47,3.89,4.62h0Z"/>
        <path d="M284.22,368.76c-2.96.48-10.41-.72-10.41-.72l7.67,2.45s5.06-.12,6.01-.25c4.37-.63,7.92-5.55,7.92-5.55,1.05-.26-4.4,2.96-11.17,4.07h-.01Z"/>
        <path d="M286.96,362.27l17.18-6.07s-10.29-5.49-14.07-5.48c-4.11.01-15.25,6.06-15.25,6.06l-5.04,8.45,4.74-2.52,12.44-.44Z"/>
      </g>
    </g>
    <g class="ltr l0"><path class="f" d="M629.61,347.58l-2.08.19c-15.37,4.86-34.55,8.67-48.4,13.38-1.06,23.06-1.56,46.12-1.49,69.19v3.45c0,9.74,0,22.96,1.25,31.22-2,.23-5.1.66-8.71,1.15-10.53,1.43-25.39,3.46-29.95,3.19-4.31-4.59,1.07-98.24,2.32-109.52-18.77,4.55-40.6,9.33-58.91,14.67.54,34.41,3.14,69.39,3.42,103.11-7.5.98-32.16,4.24-37.44,7.89.7,5.1,10.59,9.21,15.15,11.82l-2.97,1.28c-.97,5.79,9.07,15.1,14.66,15.98,1.19.18,2.23.23,3.23.28,2.3.12,4.25.22,6.68,1.91,1.18,4.4,1.34,16.61,1.56,21.69l2.43,55c.36,8.37.18,22.94,2.22,30.33l.4.13c1.8-1.18,4.93-2.92,8.63-4.96,11.37-6.28,28.05-15.51,27.8-20.78,1.52.46,2.2.8,3.64,1.49l9.43-2.45c-.1-2.89-.45-8.76-.89-16.17-1.45-24.75-3.9-66.67-2-72.42,10.89-3.49,28.4-3.75,40.12-6.91-.01,14.47,4.34,108.5,7.78,117.56,5.86-.66,17.8-7.3,23.25-10.89.76-.5,1.55-3.29,1.83-4.31l.57-.04c7.49-.48,8.2-1.33,14.27-5.3-2.88-31.63-2.97-64.03-1.45-95.7.31-6.51.08-10.07-1.02-16.46,13.99-5.93,23.73-17.84,30.84-31.01-9.83,1.78-19.71,3.24-29.64,4.38-.36-36.57,2.11-74.55,4.8-111.12l-1.39-1.25h.05Z"/></g>
    <g class="ltr l1"><path class="f" d="M749.46,481.95c-3.64-20.61-16.17-27.37-35.86-27.68-16.03.58-47.79,7.27-57.57,19.57-17.04,21.44-17.32,91.07,2.16,110.74,13.21,13.36,50.48.54,72.49-7.03,4.42-1.52,8.23-2.83,11.1-3.67,2.53-1.34,4.44-1.69,5.05-4.66.96-4.61.74-9.47.52-14.31-.14-3.09-.27-6.16-.1-9.16-11,4.43-22.33,9.62-33.92,12.06-17.71,3.72-24.06.76-28.34-16.62,36.97-4.53,72.63-13.16,64.48-59.23h0ZM709.26,503.08c-3.31,8.05-7.32,9.84-14.93,12.76-.41.13-.79.26-1.15.37-2.84.93-4.4,1.45-7.87,1.36-4.26-6.03,1.27-21.62,4.56-27.41,3.22-5.67,5.75-7.54,11.79-9.26,1.89.05,3.01.43,4.8.88,6.95,5.7,5.89,13.76,2.8,21.29h-.01Z"/></g>
    <g class="ltr l2"><path class="f" d="M803.03,401.83c.57-4.93,1.29-11.15.65-14.8-8.4,1.94-39.78,7.89-43.67,12.64-.75,3.4.17,6.07,1.24,9.21.26.77.53,1.58.8,2.42-.84,1.01-1.85,2.22-3.02,3.63-2.11,36.94-.01,103.85,3.11,137.96,1.15,11.96,2.47,23.89,3.94,35.82.59,1.72.74,3.49,2.11,3.76,5.53,1.12,16.18-2.44,24.49-5.22,2.94-.98,5.59-1.87,7.62-2.42-5.71-58.9-3.16-120.39,2.32-179.13.1-1.12.26-2.44.43-3.86h-.01Z"/></g>
    <g class="ltr l3"><path class="f" d="M866.5,381.92l-1.59-.94c-13.88,3.49-28.44,6.9-42.06,11.21-3.25,26.61-3.14,56.75-3.04,85.39.04,9.84.06,19.49-.03,28.78-.1,9.2,3.35,84.6,5.48,87.93,12.21-2.65,26.98-7.56,39.14-11.26-4.24-39.25-4.16-85.94-2.58-125.09.54-14.32,1.33-28.62,2.36-42.92.21-2.75.7-6.06,1.21-9.58,1.19-8.07,2.53-17.31,1.1-23.51h0Z"/></g>
    <g class="ltr l4"><path class="f" d="M923.27,388.29l-.28-.23c-13.42,3.07-28.2,5.35-41.85,7.71-.3,12.1-.76,23.71-1.21,35.17-.96,24.14-1.87,47.61-1.25,73.53.27,11.4,1.12,24.22,1.96,37.03,1.1,16.64,2.18,33.28,2.05,46.94,20.08-.99,48.62-6.5,67.8-12.85,13.56-5.04,24.45-7.09,30.47-21.56,8.21-19.72,8.47-39.6,7.72-60.49-1.45-39.95-30.39-44.73-62.57-31.53-2.45,1.02-4.86,2.18-7.18,3.47.09-20.38,1.49-39.96,3.58-60.2.06-.68.18-1.6.32-2.66.59-4.73,1.55-12.3.43-14.34h.01ZM918.65,531.73c-.32-13.5-.65-26.8-.54-41.46,6.2-2.3,12.49-4.38,18.83-6.23l2.96.36c11.06,6.82,8.18,33.59,5.63,44.29-2.62,10.99-8.55,17.76-18.13,23.33-2.6,1.7-5.52,3.28-8.23,4.83-.1-8.68-.31-16.93-.5-25.13h-.01Z"/></g>
    <g class="ltr l5"><path class="f" d="M1110.08,457.24c-.7-.17-1.3-.31-1.92-.14-13.87,2.03-28.89,4.42-42.75,5.95-.54,16.16-1.54,57.92,1.14,72.8-.71.34-1.6.79-2.62,1.29-6.52,3.24-18.5,9.2-22.87,8.54-6.43-9.18-2.18-73.22.08-86.36l.14-.77c-14.58,1.99-29.19,3.82-43.81,5.52,0,14.87.31,28.98.63,43.13.21,9.52.43,19.04.54,28.83l.15.85c.66,3.82,1.05,8.11,1.43,12.49,1.7,19.14,3.59,40.25,29.53,34.21,14.54-3.38,29.66-12.31,38.96-23.95,1.64,12.61,2,16.69,11.52,24.77,4.75-.62,12.95-1.36,17.14-3.05.98-2.01.96-2.23.76-3.71-.06-.48-.14-1.1-.22-1.95,5.83,3.4,7.17,5.01,8.89,5.76,1.8.77,3.98.65,11.95.61-9.26-22.93-9.09-44.66-8.93-67.89.05-6.87.09-13.87-.09-21.07-.06-2.76.36-7.31.84-12.3.88-9.09,1.87-19.65.22-23.43-.25-.05-.48-.1-.7-.15h0Z"/></g>
    <g class="ltr l6"><path class="f" d="M1240.23,389.6c-.56-.04-1.12.17-2.94.43-12.54,3.15-23.49,6.41-35.83,10.13-.14,2.8-.57,6.63-1.02,10.6-.74,6.48-1.51,13.37-1.18,16.89,1.58.79,1.68.72,1.95.58.21-.12.54-.28,1.91-.06-.58,2.66-4.44,5.06-4.69,7.05-.87,7.44-.79,17.59-1.11,25.03-23.93-5.08-69.79-1.06-73.14,29.54-2.92,26.58-3.82,59.14,7.44,84.25,1.47,3.19,8.99,8,11.97,9.73,9.04.14,12.08.03,21.13-1.32,14.38-6.01,20.9-9.04,31.48-21.04,2.65,27.23,3.71,27.07,18.63,24.86,3.55-.53,7.9-1.18,13.23-1.59,1.37-1.72,1.37-1.8,1.16-3.44-.06-.53-.15-1.23-.23-2.18,1.77.54,3.42,1.29,5.01,2.01,3.67,1.68,6.95,3.18,10.5,1.46.06-1.38-1.29-3.87-2.84-6.72-1.67-3.05-3.54-6.5-4.11-9.4-8.96-46.43-4.02-93.63.87-140.23l.37-3.55c.26-2.42.92-5.85,1.65-9.62,1.6-8.31,3.53-18.25,2.04-22.55-1.3-.59-1.77-.83-2.25-.87ZM1177.73,544.9c-3.46,1.2-7.8,2.36-11.39,3.44l-.14-.49-.25-.83c-5.4-18.06-6.81-54.21,13.6-63.97,14.34-.8,14.17,5.73,13.92,15.31-.04,1.98-.09,4.08-.03,6.29.34,10.59.43,21.08.98,31.67-5.72,3.22-10.82,5.75-16.7,8.6h0Z"/></g>
    <g class="ltr l7"><path class="f" d="M1353.66,390c-.57-.23-.67-.27-1.64-.05-7.74,2.11-14.85,4.12-22.82,5.13-6.54.83-12.7.79-19.08,2.07.04,11.37-.32,22.45-.68,33.49-.34,10.01-.66,19.98-.68,30.07-24.97-6.34-56.77,2.74-61.87,31.08-3.97,22.09-3.55,47.62,2.39,69.28,5.14,18.77,13.34,23.77,31.61,20.54,13.96-5.19,18.68-8.68,29.04-19.08.25,1.52.45,3.06.66,4.59,1.52,11.29,2.96,21.93,18.07,18.55,3.13-.7,3.69-.89,5.48-3.31l-.17-4.03c.9.43,1.78.87,2.65,1.3,4.55,2.27,8.74,4.37,13.63,2.98.32-.34.61-.58.85-.79.65-.53.97-.83.93-1.91-.34-10.17-3.16-20.47-3.66-30.64-2.07-43.8-.84-87.4,3.49-131.05.25-2.42.7-5.4,1.16-8.58,1.01-6.74,2.16-14.35,1.72-19.26-.5-.15-.84-.28-1.08-.39h.03ZM1309.09,538.02c-5.23,2.26-9.93,3.85-15.31,5.68-2.98.05-4.78-.13-7.75-.43h-.06c-7.36-7.1-3.66-44.1,2.84-52.25,4.78-6.01,5.23-6.41,12.19-8,1.24.09,5.3,1.05,5.49,1.86,2.47,10.4,2.36,43.48,2.61,53.12h-.01Z"/></g>
    <g class="ltr l8"><path class="f" d="M1400.31,452.41l-1.42-.45c-12.74,2.83-25.47,5.55-38.24,8.18-.26,17.42-1.15,112.84,5.31,122.11,5.22,2.4,13.32,1.12,21.16-.1,4.47-.7,8.87-1.39,12.58-1.38-.23-3.28-.49-6.85-.77-10.59-1.23-16.73-2.71-36.97-2.57-51.42,3.81-2.96,15.25-12.86,18.41-14.27,1.76,1.92,1.86,12.13,1.95,20.07.04,3.32.06,6.25.22,8.01.57,16.79.5,34.56,1.37,51.14,9.87.14,19.72.65,29.57,1.5-.18-34.46-.28-68.56,2.17-102.93.34-4.6.54-9.22.4-13.83-30.82-8.09-31.97-5.8-37.25,4.78-2.7,5.41-6.48,12.98-15.87,22.45.08-.92.26-2.56.46-4.68,1.14-11.37,3.67-36.58,2.56-38.57h-.01Z"/></g>
    <g class="ltr l9"><path class="f" d="M1541.94,506.86c-3.32-26.58-6.91-55.42-42-50.71-8.03,1.08-32.76,7.05-39.48,11.22-1.76,3.53.58,13.99,2.08,20.64.32,1.41.59,2.65.79,3.62,1.64-.39,3.99-1.15,6.77-2.05,13.38-4.35,36.36-11.83,34.62,5.71-4.35,2.8-8.38,3-12.94,5.32-15.37,7.62-30,18.69-33.61,36.46-2.29,11.31-1.29,26.37,4.13,36.68,4.87,9.27,16.09,10.46,25.17,10.1,13.48-3.32,23.86-7.47,31.37-19.71.26.94.49,1.87.74,2.8,3.05,11.88,5.7,22.19,21.57,17.63,1.83-1.54,1.81-1.37,2.67-3.59,2.36.28,4.25.56,5.95.8,4.4.63,7.48,1.08,13.9.99-15.93-20.67-16.89-41.6-20.49-66.57-.44-3.04-.83-6.17-1.23-9.34h-.01ZM1512.14,542.11c-6.16,4.31-11.44,7.25-18.47,9.86-11.28-12.83,4.83-25.47,15.16-31.21.57.92,2.76,18.63,3.32,21.36h-.01Z"/></g>
  </g>

  <g class="ge-hb-loader">
    <rect x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="${LOADER_BAR_MAX_WIDTH}" height="${LOADER_BAR_H}" fill="rgba(255,255,255,0.12)"/>
    <clipPath id="ge-hb-loader-clip">
      <rect id="${RECT_ID}" x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="0" height="${LOADER_BAR_H}" class="ge-hb-clip-rect"/>
    </clipPath>
    <rect x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="${LOADER_BAR_MAX_WIDTH}" height="${LOADER_BAR_H}" fill="${RED}" clip-path="url(#ge-hb-loader-clip)"/>
  </g>
</svg>`;

export const hellbuddhaVariant: PreloaderVariant = {
  splash: false,
  introMs: HELLBUDDHA_INTRO_MS,
  background: BACKGROUND,

  buildContentHTML() {
    return `
    <div class="ge-hb-content">
      ${LOGO_SVG}
    </div>
    <div class="ge-hb-status ge-hb-loader">
      <span id="${TEXT_ID}" class="ge-hb-text">Loading...</span>
    </div>
  `;
  },

  css: `
    .ge-hb-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 88%;
      max-width: 780px;
    }

    .ge-hb-logo-svg {
      width: 100%;
      height: auto;
    }

    /* ── The lockup's own intro, verbatim from the export (rescoped .hb → .ge-hb) ── */
    .ge-hb *{animation-duration:8.0s;animation-timing-function:ease-in-out;animation-fill-mode:both;animation-iteration-count:1}
    .ge-hb .body{transform-box:fill-box;transform-origin:50% 60%}
    .ge-hb .ltr{transform-box:fill-box;transform-origin:50% 100%}
    .ge-hb .dark{fill:#000}
    @keyframes hbBodyFill{0%{fill:#FEFEFE}15%{fill:#FEFEFE}17%{fill:#FFD2C2}20%{fill:#FF2A1E}22%{fill:#D9231A}24%{fill:#FF2A1E}27%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    @keyframes hbThump{0%{transform:scale(1)}15%{transform:scale(1)}16.5%{transform:scale(1.045)}19%{transform:scale(1)}21%{transform:scale(1.03)}24%{transform:scale(1)}68%{transform:scale(1)}69.5%{transform:scale(1.045)}72%{transform:scale(1)}74%{transform:scale(1.03)}77%{transform:scale(1)}100%{transform:scale(1)}}
    @keyframes hbL0{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}30%{opacity:0;transform:scale(1.7) rotate(-8deg)}33.575%{opacity:1;transform:scale(.9) rotate(1.5deg)}36.5%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF0{0%{fill:#FFFFFF}30%{fill:#FFFFFF}32.275%{fill:#FFD2C2}36.5%{fill:#FF2A1E}42.5%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l0{animation-name:hbL0}
    .ge-hb .l0 .f{animation-name:hbLF0}
    @keyframes hbL1{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}33.2%{opacity:0;transform:scale(1.7) rotate(-8deg)}36.775%{opacity:1;transform:scale(.9) rotate(1.5deg)}39.7%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF1{0%{fill:#FFFFFF}33.2%{fill:#FFFFFF}35.475%{fill:#FFD2C2}39.7%{fill:#FF2A1E}45.7%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l1{animation-name:hbL1}
    .ge-hb .l1 .f{animation-name:hbLF1}
    @keyframes hbL2{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}36.4%{opacity:0;transform:scale(1.7) rotate(-8deg)}39.975%{opacity:1;transform:scale(.9) rotate(1.5deg)}42.9%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF2{0%{fill:#FFFFFF}36.4%{fill:#FFFFFF}38.675%{fill:#FFD2C2}42.9%{fill:#FF2A1E}48.9%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l2{animation-name:hbL2}
    .ge-hb .l2 .f{animation-name:hbLF2}
    @keyframes hbL3{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}39.6%{opacity:0;transform:scale(1.7) rotate(-8deg)}43.175%{opacity:1;transform:scale(.9) rotate(1.5deg)}46.1%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF3{0%{fill:#FFFFFF}39.6%{fill:#FFFFFF}41.875%{fill:#FFD2C2}46.1%{fill:#FF2A1E}52.1%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l3{animation-name:hbL3}
    .ge-hb .l3 .f{animation-name:hbLF3}
    @keyframes hbL4{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}42.8%{opacity:0;transform:scale(1.7) rotate(-8deg)}46.375%{opacity:1;transform:scale(.9) rotate(1.5deg)}49.3%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF4{0%{fill:#FFFFFF}42.8%{fill:#FFFFFF}45.075%{fill:#FFD2C2}49.3%{fill:#FF2A1E}55.3%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l4{animation-name:hbL4}
    .ge-hb .l4 .f{animation-name:hbLF4}
    @keyframes hbL5{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}46%{opacity:0;transform:scale(1.7) rotate(-8deg)}49.575%{opacity:1;transform:scale(.9) rotate(1.5deg)}52.5%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF5{0%{fill:#FFFFFF}46%{fill:#FFFFFF}48.275%{fill:#FFD2C2}52.5%{fill:#FF2A1E}58.5%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l5{animation-name:hbL5}
    .ge-hb .l5 .f{animation-name:hbLF5}
    @keyframes hbL6{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}49.2%{opacity:0;transform:scale(1.7) rotate(-8deg)}52.775%{opacity:1;transform:scale(.9) rotate(1.5deg)}55.7%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF6{0%{fill:#FFFFFF}49.2%{fill:#FFFFFF}51.475%{fill:#FFD2C2}55.7%{fill:#FF2A1E}61.7%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l6{animation-name:hbL6}
    .ge-hb .l6 .f{animation-name:hbLF6}
    @keyframes hbL7{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}52.4%{opacity:0;transform:scale(1.7) rotate(-8deg)}55.975%{opacity:1;transform:scale(.9) rotate(1.5deg)}58.9%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF7{0%{fill:#FFFFFF}52.4%{fill:#FFFFFF}54.675%{fill:#FFD2C2}58.9%{fill:#FF2A1E}64.9%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l7{animation-name:hbL7}
    .ge-hb .l7 .f{animation-name:hbLF7}
    @keyframes hbL8{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}55.6%{opacity:0;transform:scale(1.7) rotate(-8deg)}59.175%{opacity:1;transform:scale(.9) rotate(1.5deg)}62.1%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF8{0%{fill:#FFFFFF}55.6%{fill:#FFFFFF}57.875%{fill:#FFD2C2}62.1%{fill:#FF2A1E}68.1%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l8{animation-name:hbL8}
    .ge-hb .l8 .f{animation-name:hbLF8}
    @keyframes hbL9{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}58.8%{opacity:0;transform:scale(1.7) rotate(-8deg)}62.375%{opacity:1;transform:scale(.9) rotate(1.5deg)}65.3%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF9{0%{fill:#FFFFFF}58.8%{fill:#FFFFFF}61.075%{fill:#FFD2C2}65.3%{fill:#FF2A1E}71.3%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l9{animation-name:hbL9}
    .ge-hb .l9 .f{animation-name:hbLF9}
    .ge-hb .body{animation-name:hbThump}
    .ge-hb .body .f{animation-name:hbBodyFill}

    /* Bar + status text fade in once the intro has played. */
    .ge-hb-loader {
      opacity: 0;
      animation: ge-hb-loader-in 0.5s ease-out ${HELLBUDDHA_INTRO_MS}ms forwards;
    }

    @keyframes ge-hb-loader-in {
      to { opacity: 1; }
    }

    /* Shimmer the loader bar while waiting */
    .ge-hb-clip-rect {
      animation: ge-hb-fill 2s ease-in-out infinite;
    }

    @keyframes ge-hb-fill {
      0%   { width: 0; }
      50%  { width: ${LOADER_BAR_MAX_WIDTH}px; }
      100% { width: 0; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-hb-clip-rect.driven {
      animation: none;
    }

    /* Status text — pinned to the bottom of the screen, not to the lockup. */
    .ge-hb-status {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 8%;
      text-align: center;
    }

    .ge-hb-text {
      display: inline-block;
      color: rgba(255, 255, 255, 0.6);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 3px;
      animation: ge-hb-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-hb-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-hb-text rule, swapping the animation cleanly. */
    .ge-hb-text.ge-hb-tap-pulse {
      animation: ge-hb-tap 1.2s ease-in-out infinite;
    }

    @keyframes ge-hb-tap {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }

    /* Last so it outranks the intro + fade-in rules above: still artwork, bar up at once. */
    @media (prefers-reduced-motion: reduce) {
      .ge-hb * { animation: none !important; }
      .ge-hb .f { fill: #FEFEFE; }
      .ge-hb .ltr { opacity: 1; }
      .ge-hb-loader { opacity: 1; animation: none; }
    }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
    const textEl = overlay.querySelector(`#${TEXT_ID}`) as HTMLElement | null;
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
        textEl.classList.add('ge-hb-tap-pulse');
      },
    };
  },
};
