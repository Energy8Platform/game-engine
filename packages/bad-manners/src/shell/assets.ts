import { CanvasSource, ImageSource, Rectangle, Texture } from 'pixi.js';
import { ATLAS_FRAMES, ATLAS_PNG, FACE_PNG } from '../generated/atlas';
import { recolorPixels } from './recolor';
import { LIME, accentShades } from './theme';
import { FONT_FACES } from '../generated/fonts';

// The kit, decoded from the bundled bytes (no URL is ever fetched — Stake's CSP blocks data: URLs for
// fonts and images, bytes handed to FontFace / createImageBitmap never meet it).

export type IconName =
  | 'autoplay' | 'back' | 'bomb' | 'buy' | 'check' | 'chevron-left' | 'chevron-right' | 'close' | 'face'
  | 'fullscreen' | 'grawlix-asterisk' | 'grawlix-at' | 'grawlix-dollar' | 'grawlix-excl' | 'grawlix-hash'
  | 'grawlix-percent' | 'history-list' | 'history' | 'home' | 'info' | 'lock' | 'menu' | 'minus' | 'music-off'
  | 'music' | 'plus' | 'replay' | 'rules' | 'settings' | 'skull' | 'sound-off' | 'sound-on' | 'spin' | 'spiral'
  | 'stop' | 'trophy' | 'turbo';

export type BubbleVariant = 'ink' | 'ink-outline' | 'ink-outline-white' | 'lime' | 'grey';
export type PillVariant = 'lime' | 'lime-hover' | 'lime-press' | 'grey' | 'ink' | 'ink-outline' | 'ink-outline-white';
export type UiName =
  | `bubble-${BubbleVariant}-tail${'l' | 'r'}`
  | `pill-${PillVariant}`
  | 'spin-base' | 'spin-base-hover' | 'spin-base-press' | 'spin-base-disabled'
  | 'slider-track' | 'slider-fill' | 'underline';

/** 9-slice insets (§3.4), in @1x units. */
export const SLICE = {
  taill: { left: 38, right: 22, top: 18, bottom: 30 },
  tailr: { left: 22, right: 38, top: 18, bottom: 30 },
  pill: { left: 26, right: 26, top: 25, bottom: 25 },
  slider: { left: 8, right: 8, top: 0, bottom: 0 },
  underline: { left: 4, right: 4, top: 0, bottom: 0 },
} as const;

const textures = new Map<string, Texture>();
let face = Texture.EMPTY;
let fonts: Promise<void> | null = null;
let decoded: Promise<{ atlas: ImageBitmap; face: ImageBitmap } | null> | null = null;
/** The accent the current textures were painted in, and the load in flight. */
let painted: number | null = null;
let pending: { accent: number; done: Promise<void> } | null = null;

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decode(): Promise<{ atlas: ImageBitmap; face: ImageBitmap } | null> {
  if (typeof createImageBitmap !== 'function') return null; // headless test env: textures stay empty
  const png = (b64: string) => createImageBitmap(new Blob([bytes(b64)], { type: 'image/png' }));
  const [atlas, faceBmp] = await Promise.all([png(ATLAS_PNG), png(FACE_PNG)]);
  return { atlas, face: faceBmp };
}

async function loadFonts(): Promise<void> {
  const set = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!set || typeof FontFace !== 'function') return;
  await Promise.all(
    FONT_FACES.map(async (f) => {
      try {
        const ff = new FontFace(f.family, bytes(f.b64), { weight: f.weight, style: 'normal', display: 'swap', unicodeRange: f.range });
        set.add(ff);
        await ff.load();
      } catch {
        /* a face that will not decode falls back to the stack */
      }
    }),
  );
}

/** The bitmap as a texture source — repainted in `accent` unless it is the kit's own lime. */
function source(bmp: ImageBitmap, accent: number): ImageSource | CanvasSource {
  if (accent === LIME || typeof document === 'undefined') return new ImageSource({ resource: bmp, resolution: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const from = accentShades(LIME);
  const to = accentShades(accent);
  recolorPixels(img.data, [from.base, from.hover, from.press], [to.base, to.hover, to.press]);
  ctx.putImageData(img, 0, 0);
  return new CanvasSource({ resource: canvas, resolution: 2 });
}

async function paint(accent: number): Promise<void> {
  decoded ??= decode();
  const bmps = await decoded;
  if (!bmps) return;
  // ponytail: an earlier accent's sources are left to GC with the views that used them, not destroyed
  const atlas = source(bmps.atlas, accent);
  for (const [name, f] of Object.entries(ATLAS_FRAMES)) {
    textures.set(name, new Texture({ source: atlas, frame: new Rectangle(f.x / 2, f.y / 2, f.w / 2, f.h / 2) }));
  }
  face = new Texture({ source: source(bmps.face, accent) });
}

/** Decode the fonts once and paint the kit in `accent` (default: the lime). Resolves when every
 *  texture and face is usable. */
export function loadBmAssets(accent: number = LIME): Promise<void> {
  if (painted === accent && !pending) return Promise.resolve();
  if (pending?.accent === accent) return pending.done;
  fonts ??= loadFonts();
  const job: { accent: number; done: Promise<void> } = {
    accent,
    done: Promise.all([fonts, paint(accent)])
      .catch(() => {})
      .then(() => {
        if (pending === job) {
          painted = accent;
          pending = null;
        }
      }),
  };
  pending = job;
  return job.done;
}

/** The kit is painted in `accent` (and no repaint is in flight). */
export function bmAssetsLoaded(accent: number = LIME): boolean {
  return painted === accent && !pending;
}

export function iconTex(name: IconName): Texture {
  return textures.get(`icon/${name}`) ?? Texture.EMPTY;
}

export function uiTex(name: UiName): Texture {
  return textures.get(`ui/${name}`) ?? Texture.EMPTY;
}

/** The face mark (bm-mark-face; its tongue is the accent) — never tinted. 246×256 source. */
export function faceTex(): Texture {
  return face;
}
export const FACE_ASPECT = 246 / 256;
