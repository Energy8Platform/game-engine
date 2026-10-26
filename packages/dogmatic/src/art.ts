import { ART_JPG } from './generated/assets';

// The DOGMATIC outline artwork, decoded once from the bundled bytes — createImageBitmap never meets
// the page's img-src CSP the way an <img src="data:…"> would.

let art: Promise<ImageBitmap | null> | null = null;

export function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The artwork bitmap, or null where it cannot be decoded (no createImageBitmap — tests). */
export function decodeArt(): Promise<ImageBitmap | null> {
  art ??= typeof createImageBitmap === 'function'
    ? createImageBitmap(new Blob([bytes(ART_JPG)], { type: 'image/jpeg' })).catch(() => null)
    : Promise.resolve(null);
  return art;
}
