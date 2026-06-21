import { TextureSource } from 'pixi.js';

/** Preload web fonts so Pixi text rasterizes with the right glyphs. Never throws. */
export async function loadFonts(specs?: string[]): Promise<void> {
  if (!specs || specs.length === 0) return;
  try {
    await Promise.all(specs.map((s) => document.fonts.load(s)));
    await document.fonts.ready;
  } catch {
    /* font CDN unreachable → fall back to system fonts */
  }
}

/** Smoother default downscaling for art-heavy slots. Pixel-art games omit this. */
export function applyTextureDefaults(): void {
  TextureSource.defaultOptions.autoGenerateMipmaps = true;
}

/** Idempotent double-boot guard. Returns true the first time, false thereafter. */
export function bootGuard(flag = '__e8SlotBooted__'): boolean {
  const w = window as unknown as Record<string, boolean>;
  if (w[flag]) return false;
  w[flag] = true;
  return true;
}
