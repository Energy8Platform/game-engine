import type { PreloaderVariant, PreloaderVariantHandle } from '@energy8platform/platform-core/loading';
import { INTRO_SVG } from '../generated/intro-svg';
import { LIME, parseColor } from '../shell/theme';
import { EASE, LAYERS, MIN_MS, PRELOAD_FILL, SKIP_AFTER_MS, STAGE, TIMELINE, frame, type Props } from './intro';

// Bad Manners studio intro as a CSS-preloader variant (BRANDBOOK §6). Pass it to the game:
//   createSlotGame({ loading: { preloaderVariant: badMannersPreloader }, ... })
//
// The intro is the studio's own pre-roll, so it skips the platform's powered-by splash (as hellbuddha
// does); `introMs` holds the brand gate until it has played, and a skip lifts it. It plays in full on
// every launch — nothing is kept in storage.

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Every layer's props once the whole timeline has played (each track's last key, in order). */
function finalProps(): Record<string, Props> {
  const out: Record<string, Props> = {};
  for (const [id, l] of Object.entries(LAYERS)) out[id] = { ...l.init };
  for (const t of TIMELINE) if (t.target !== 'stage') Object.assign(out[t.target], t.keys[t.keys.length - 1][1]);
  return out;
}

/** The kit's lime as it is written in the intro SVGs and boxes. */
const KIT_LIME = /#B6FF3B/gi;

function layerHTML(id: string, accent: string): string {
  const l = LAYERS[id];
  const box = `left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;transform-origin:${l.pivot[0] * 100}% ${l.pivot[1] * 100}%`;
  const paint = l.kind ? `;background:${l.fill!.replace(KIT_LIME, accent)};border-radius:${l.kind === 'circle' ? '50%' : `${l.radius}px`}` : '';
  return `<div data-bm-layer="${id}" style="${box}${paint}">${l.svg ? INTRO_SVG[l.svg].replace(KIT_LIME, accent) : ''}</div>`;
}

export interface BadMannersPreloaderOptions {
  /** The accent — the kit's acid lime by default (any CSS colour or 0xRRGGBB). Recolours the tongue,
   *  the !@#$ bubble, the landing bursts and the progress underline. Use the shell's accent. */
  accent?: string | number;
}

/** The intro in another accent: `loading: { preloaderVariant: createBadMannersPreloader({ accent }) }`. */
export function createBadMannersPreloader(opts: BadMannersPreloaderOptions = {}): PreloaderVariant {
  const a = parseColor(opts.accent) ?? LIME;
  const accent = `#${a.toString(16).padStart(6, '0')}`;
  return {
    ...intro,
    introMs: MIN_MS, // the brand gate waits for the intro
    buildContentHTML: () =>
      `<div class="bm-intro"><div class="bm-intro-stage">${Object.keys(LAYERS).map((id) => layerHTML(id, accent)).join('')}</div><div class="bm-intro-tap"></div></div>`,
  };
}

const intro: Omit<PreloaderVariant, 'buildContentHTML' | 'introMs'> = {
  background: '#000000',
  splash: false,

  css: `
    .bm-intro { position: absolute; inset: 0; overflow: hidden; }
    .bm-intro-stage { position: absolute; left: 50%; top: 50%; width: ${STAGE.w}px; height: ${STAGE.h}px; transform-origin: 0 0; }
    .bm-intro-stage > div { position: absolute; }
    .bm-intro-stage svg { display: block; width: 100%; height: 100%; }
    .bm-intro-tap {
      position: absolute; left: 0; right: 0; bottom: 8%; text-align: center; color: #fff;
      font: 900 16px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase;
    }
    .bm-intro-tap.bm-pulse { animation: bm-intro-pulse 1.2s ease-in-out infinite; }
    @keyframes bm-intro-pulse { 50% { opacity: .35; } }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const stage = overlay.querySelector<HTMLElement>('.bm-intro-stage');
    const tap = overlay.querySelector<HTMLElement>('.bm-intro-tap');
    if (!stage || !tap) return null;
    const els: Record<string, HTMLElement> = { stage };
    for (const el of stage.querySelectorAll<HTMLElement>('[data-bm-layer]')) els[el.dataset.bmLayer!] = el;

    const fit = (): void => {
      if (!overlay.isConnected && stage.style.transform) {
        removeEventListener('resize', fit);
        return;
      }
      const s = Math.min(overlay.clientWidth / STAGE.w, overlay.clientHeight / STAGE.h) * STAGE.fit || STAGE.fit;
      stage.style.transform = `scale(${s}) translate(${-STAGE.w / 2}px, ${-STAGE.h / 2}px)`;
    };
    fit();
    addEventListener('resize', fit);
    // the overlay is laid out a frame after mount
    globalThis.requestAnimationFrame?.(fit);

    const paint = (id: string, p: Props): void => {
      const k = frame(id, p);
      const st = els[id].style;
      st.transform = String(k.transform);
      if (k.opacity != null) st.opacity = String(k.opacity);
      if (k.width != null) st.width = String(k.width);
    };

    // the underline: the intro fills it to 70%, then it follows the real load — never backwards
    const bar = LAYERS.progress.w;
    let loaded = 0;
    let driven = false;
    const drive = (): void => {
      driven = true;
      els.progress.style.width = `${bar * Math.max(PRELOAD_FILL, loaded)}px`;
    };

    const animated = !reducedMotion() && typeof stage.animate === 'function';
    // no motion: the final lockup from the start
    if (!animated) {
      for (const [id, p] of Object.entries(finalProps())) paint(id, p);
      drive();
    } else {
      for (const [id, l] of Object.entries(LAYERS)) paint(id, l.init);
    }

    const tracks = animated ? TIMELINE : [];
    const seen = new Set<string>();
    const anims = tracks.map((t) => {
      const first = !seen.has(t.target);
      seen.add(t.target);
      return els[t.target].animate(
        t.keys.map(([offset, p]) => ({ offset, ...frame(t.target, p) })),
        { delay: t.at, duration: Math.max(t.dur, 1), easing: EASE[t.ease], fill: first ? 'both' : 'forwards' },
      );
    });
    // the intro's last track is the underline fill: once it lands, the load drives the width
    const fill = anims[anims.length - 1];
    if (fill) {
      fill.onfinish = () => {
        drive();
        fill.cancel();
      };
    }

    // skip: tap / click / space after 500ms → the final frame, and the brand gate lifts (a loaded game
    // takes over at once)
    const startedAt = performance.now();
    let skipped!: () => void;
    const skippedP = new Promise<void>((r) => (skipped = r));
    const skip = (): void => {
      if (performance.now() - startedAt < SKIP_AFTER_MS) return;
      for (const a of anims) a.finish();
      skipped();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!overlay.isConnected) removeEventListener('keydown', onKey);
      else if (e.code === 'Space') skip();
    };
    overlay.addEventListener('pointerdown', skip);
    addEventListener('keydown', onKey);

    return {
      skipped: skippedP,
      setProgress(p, showPercentage) {
        loaded = Math.max(loaded, p);
        if (driven) drive();
        if (showPercentage) tap.textContent = `${Math.round(p * 100)}%`;
      },
      showTapText(text) {
        tap.textContent = text;
        tap.classList.add('bm-pulse');
      },
    };
  },
};

/** The intro in the kit's lime. */
export const badMannersPreloader: PreloaderVariant = createBadMannersPreloader();
