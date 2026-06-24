// A stub 2D canvas context so Pixi v8 Text can measure under jsdom (node-canvas won't build here).
// Text widths are approximate (per-glyph ≈ 0.52em, space ≈ 0.28em) and font metrics derive from
// the font size — enough to verify LAYOUT logic (centering, wrapping, overflow) deterministically.
// Imported first by layout tests so the patch lands before pixi.js loads.

function makeCtx(canvas: unknown): unknown {
  const store: Record<string, unknown> = {
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    globalAlpha: 1,
    lineWidth: 1,
  };
  const fontSize = (): number => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(store.font));
    return m ? parseFloat(m[1]) : 10;
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') {
        return (s: string) => {
          const sz = fontSize();
          const w = [...String(s)].reduce((a, c) => a + (c === ' ' ? sz * 0.28 : sz * 0.52), 0);
          return {
            width: w,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: w,
            actualBoundingBoxAscent: sz * 0.72,
            actualBoundingBoxDescent: sz * 0.2,
            fontBoundingBoxAscent: sz * 0.8,
            fontBoundingBoxDescent: sz * 0.2,
          };
        };
      }
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (a: number, b: number, w?: number, h?: number) => {
          const ww = (w ?? a) | 0;
          const hh = (h ?? b) | 0;
          return { data: new Uint8ClampedArray(Math.max(4, ww * hh * 4)), width: ww, height: hh };
        };
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (prop in store) return store[prop];
      return () => {};
    },
    set(_t, prop: string, val: unknown) {
      store[prop] = val;
      return true;
    },
  };
  return new Proxy({}, handler);
}

// Pixi probes `'letterSpacing' in CanvasRenderingContext2D.prototype` — jsdom doesn't define the
// class, so provide a stub (empty prototype → Pixi uses its manual letter-spacing path).
const gg = globalThis as { CanvasRenderingContext2D?: unknown };
if (typeof gg.CanvasRenderingContext2D === 'undefined') {
  const Ctx = function CanvasRenderingContext2D() {};
  Ctx.prototype = {};
  gg.CanvasRenderingContext2D = Ctx;
}

const proto = (globalThis as { HTMLCanvasElement?: { prototype: { getContext: unknown } } }).HTMLCanvasElement;
if (proto) {
  proto.prototype.getContext = function (this: unknown) {
    return makeCtx(this);
  };
}
const off = (globalThis as { OffscreenCanvas?: { prototype: { getContext: unknown } } }).OffscreenCanvas;
if (off) {
  off.prototype.getContext = function (this: unknown) {
    return makeCtx(this);
  };
}
