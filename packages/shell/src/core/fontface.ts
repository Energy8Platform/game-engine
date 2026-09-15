/**
 * Register embedded (base64 `data:` woff2) `@font-face` rules WITHOUT a `data:` URL load.
 *
 * Stake's CSP is `font-src 'self' https://fonts.gstatic.com`: a `<style>` with
 * `src:url(data:font/woff2;base64,…)` is blocked outright and the shell silently renders in the
 * fallback font. A `FontFace` built from an ArrayBuffer never fetches a URL, so no font-src check
 * applies — the same bytes, decoded in JS and handed to `document.fonts`. Falls back to the plain
 * `<style>` injection where the FontFace API is missing.
 *
 * The CSS is parsed with a deliberately narrow regex — the only producer is our own generators
 * (build-shell-font / build-digit-font / build-hb-fonts), whose output shape is fixed.
 */

interface ParsedFace {
  family: string;
  weight: string;
  b64: string;
  unicodeRange?: string;
}

export function parseFontFaces(css: string): ParsedFace[] {
  const out: ParsedFace[] = [];
  const re = /@font-face\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const body = m[1];
    const family = /font-family:'([^']+)'/.exec(body)?.[1];
    const b64 = /base64,([A-Za-z0-9+/=]+)\)/.exec(body)?.[1];
    if (!family || !b64) continue;
    out.push({
      family,
      weight: /font-weight:([^;]+);/.exec(body)?.[1] ?? '400',
      b64,
      unicodeRange: /unicode-range:([^;]+);/.exec(body)?.[1],
    });
  }
  return out;
}

function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Install every face in `css`. Returns the `FontFace`s added (empty when it fell back to a
 *  `<style id>` tag). Idempotent per `styleId`. */
export function installFontFaces(css: string, styleId: string): FontFace[] {
  if (typeof document === 'undefined') return [];
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  const canBuffer = typeof FontFace === 'function' && !!fonts && typeof fonts.add === 'function';
  if (canBuffer) {
    const added: FontFace[] = [];
    for (const f of parseFontFaces(css)) {
      try {
        const face = new FontFace(f.family, decode(f.b64), {
          weight: f.weight,
          style: 'normal',
          display: 'swap',
          ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
        });
        fonts.add(face);
        // `.load()` returns a promise — a rejection (a face the engine can't decode) must be
        // swallowed here or it trips the host's global `unhandledrejection` handler.
        face.load().catch(() => {/* fallback fonts render meanwhile */});
        added.push(face);
      } catch {
        /* one bad face must not stop the others */
      }
    }
    if (added.length) return added;
  }
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
  return [];
}
