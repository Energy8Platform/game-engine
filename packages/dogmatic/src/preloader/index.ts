import type { PreloaderVariant, PreloaderVariantHandle } from '@energy8platform/platform-core/loading';
import { ART_H, ART_W, MANROPE_WOFF2 } from '../generated/assets';
import { bytes, decodeArt } from '../art';

// The DOGMATIC loader as a CSS-preloader variant: the collar flickers on like neon and settles at
// 1.41s, the wordmark follows at 1.7s, the LOADING line at 2.55s; the bar and the percentage then
// follow the game's real load, and the D tag keeps swinging. Ported from the provider's preview
// loader (time-driven progress there). It replaces the platform's powered-by splash, as
// hellbuddha does. Pass it to the game:
//   createSlotGame({ loading: { preloaderVariant: dogmaticPreloader }, ... })

const ORANGE = '#ff961f';
/** Collar brightness keys [ms, opacity] — the neon switch-on. */
const STOPS = [[0, 0.035], [260, 0.035], [310, 0.32], [355, 0.035], [505, 0.035], [545, 0.17], [590, 0.04], [735, 0.04], [775, 0.8], [810, 0.055], [910, 0.055], [955, 0.98], [1005, 0.08], [1105, 0.08], [1160, 0.5], [1200, 0.13], [1280, 0.13], [1410, 1]];
const COLLAR_ON = 1410;
const WORDMARK_AT = 1700;
const LOADING_AT = 2550;
/** The brand gate holds until the LOADING line is in. */
const INTRO_MS = LOADING_AT + 300;
const FONT = 'DogmaticDigits';

const smooth = (t: number): number => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

function voltage(t: number, reduced: boolean): number {
  if (reduced) return t < 300 ? 0.05 : 1;
  for (let i = 1; i < STOPS.length; i++) {
    const [b, y] = STOPS[i];
    const [a, x] = STOPS[i - 1];
    if (t <= b) return x + (y - x) * Math.max(0, (t - a) / (b - a));
  }
  return 1;
}

let fontAdded = false;
function installFont(): void {
  if (fontAdded || typeof FontFace !== 'function' || typeof document === 'undefined') return;
  fontAdded = true;
  try {
    const f = new FontFace(FONT, bytes(MANROPE_WOFF2), { weight: '800' });
    document.fonts.add(f);
    f.load().catch(() => {});
  } catch {
    /* falls back to the stack */
  }
}

/** A canvas holding the whole artwork; CSS clips each one to its layer. */
const layer = (cls: string): string => `<canvas class="dl-layer ${cls}" width="${ART_W}" height="${ART_H}"></canvas>`;

export const dogmaticPreloader: PreloaderVariant = {
  background: '#000000',
  splash: false,
  introMs: INTRO_MS,

  buildContentHTML() {
    return `<div class="dogmatic-loader" data-phase="neon"><div class="dl-art">
      <div class="dl-collar">${layer('dl-body')}${layer('dl-tag')}</div>
      ${layer('dl-wordmark')}
      <div class="dl-loading"><div class="dl-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="dl-fill"></div></div>
      <div class="dl-label"><div class="dl-loading-word"><canvas width="${ART_W}" height="${ART_H}"></canvas></div><span class="dl-percent">0%</span></div></div>
    </div></div>`;
  },

  css: `
    .dogmatic-loader { position: absolute; inset: 0; background: #000; display: flex; justify-content: center; align-items: center; container-type: size; }
    .dl-art { position: relative; width: min(100cqw, ${((ART_W / ART_H) * 100).toFixed(3)}cqh); aspect-ratio: ${ART_W} / ${ART_H}; container-type: inline-size; }
    .dl-collar { position: absolute; inset: 0; opacity: .035; }
    .dl-layer { position: absolute; inset: 0; display: block; width: 100%; height: 100%; pointer-events: none; }
    .dl-body { clip-path: inset(27% 65.9% 47.821467% 10%); }
    .dl-tag { clip-path: inset(52.178533% 73.78815% 37.725823% 20.227409%); transform-origin: 23.219629% 52.178533%; }
    .dl-wordmark { clip-path: inset(32% 9% 46% 34.2%); opacity: 0; }
    .dl-loading { position: absolute; inset: 0; opacity: 0; }
    .dl-track { position: absolute; left: 28.12687%; top: 66.09989%; width: 43.74626%; height: 1.38151%; background: #303639; border-radius: 100px; overflow: hidden; }
    .dl-fill { height: 100%; width: 0; background: ${ORANGE}; border-radius: inherit; transition: width .2s linear; }
    .dl-label { position: absolute; left: 50%; top: 69.92561%; transform: translateX(-50%); display: flex; align-items: center; gap: .35em; white-space: nowrap; color: #f7f7f7; font: 800 clamp(11px, 2.03471cqw, 34px)/1 ${FONT}, Arial, sans-serif; }
    .dl-loading-word { position: relative; overflow: hidden; width: 5.235294em; height: 1em; flex-shrink: 0; }
    .dl-loading-word canvas { position: absolute; width: 49.147059em; height: 27.676471em; left: -20.588235em; top: -19.382353em; }
    .dl-percent { display: block; min-width: 3.25em; letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
    .dl-percent.dl-tap { animation: dl-pulse 1.2s ease-in-out infinite; }
    @keyframes dl-pulse { 50% { opacity: .35; } }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const q = <T extends Element>(s: string) => overlay.querySelector<T>(s);
    const root = q<HTMLElement>('.dogmatic-loader');
    const collar = q<HTMLElement>('.dl-collar');
    const tag = q<HTMLElement>('.dl-tag');
    const wordmark = q<HTMLElement>('.dl-wordmark');
    const loading = q<HTMLElement>('.dl-loading');
    const fill = q<HTMLElement>('.dl-fill');
    const track = q<HTMLElement>('.dl-track');
    const label = q<HTMLElement>('.dl-percent');
    if (!root || !collar || !tag || !wordmark || !loading || !fill || !track || !label) return null;
    installFont();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // the load drives the bar — never backwards
    let loaded = 0;
    let tapText: string | null = null;
    const show = (): void => {
      const p = Math.round(loaded * 100);
      fill.style.width = `${p}%`;
      track.setAttribute('aria-valuenow', String(p));
      if (tapText == null) label.textContent = `${p}%`;
    };

    // draw the artwork into every layer, then run the switch-on timeline
    void decodeArt().then((bmp) => {
      if (bmp) for (const c of overlay.querySelectorAll('canvas')) c.getContext('2d')?.drawImage(bmp, 0, 0);
      const start = performance.now();
      const tick = (now: number): void => {
        if (!overlay.isConnected) return;
        const t = now - start;
        const light = voltage(t, reduced);
        collar.style.opacity = String(light);
        collar.style.filter = t < COLLAR_ON && !reduced ? `brightness(${1 + Math.max(0, light - 0.2) * 0.9})` : 'none';
        tag.style.transform = `rotate(${reduced ? 0 : 9 * Math.cos((t * Math.PI * 2) / 1900)}deg)`;
        wordmark.style.opacity = String(smooth((t - WORDMARK_AT) / 600));
        loading.style.opacity = String(smooth((t - LOADING_AT) / 300));
        root.dataset.phase = t < COLLAR_ON ? 'neon' : t < WORDMARK_AT ? 'collar' : t < LOADING_AT ? 'wordmark' : 'loading';
        requestAnimationFrame(tick);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
      else tick(start + INTRO_MS);
    });

    return {
      setProgress(p) {
        loaded = Math.max(loaded, p);
        show();
      },
      showTapText(text) {
        tapText = text;
        label.textContent = text;
        label.classList.add('dl-tap');
      },
    };
  },
};
