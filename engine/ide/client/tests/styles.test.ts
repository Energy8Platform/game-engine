import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the token system, not any one screen's look: every colour this
 * stylesheet paints has to come from a `--e8-*` custom property, so the
 * Cal.com palette (or any other literal palette) cannot leak back in one
 * hex code at a time as screens get touched. The two blocks allowed to
 * define colours are stripped before the check — `:root` (dark, the
 * default) and `[data-theme="light"]` (the light override) — everything
 * else in the file must reference a token, never spell one out.
 */
describe('styles.css token guard', () => {
  it('every colour in the stylesheet is a token, not a literal', () => {
    const css = readFileSync('src/styles.css', 'utf8').replace(
      /:root\s*{[^}]*}|\[data-theme[^{]*{[^}]*}/g,
      '',
    );
    // Hex, functional and named forms alike. The named list is the handful
    // that show up in stylesheets by habit; `transparent` and `currentColor`
    // are not colours a palette would own and stay allowed — and neither is
    // the `white-space` property, which shares a word with one.
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:white(?!-space)|black|red|blue|green|gray|grey|silver|orange|yellow)\b/gi;
    expect(css.match(literal) ?? []).toEqual([]);
  });

  // Spec §4 retired the background ladder and the one radius. A rule that
  // still says `--e8-bg-1` resolves to NOTHING in the browser — the
  // property is undefined — and paints transparent, which no test that
  // reads a token by its new name would notice.
  it('no rule reads a retired token name', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css.match(/--e8-bg-\d|--e8-radius(?![-\w])/g) ?? []).toEqual([]);
  });

  // Modern UI's `shadows.css` sets every workbench shadow to `none`; a
  // card that floats does so by gap and border, never by blur.
  it('every box-shadow is none', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(shadows.length).toBeGreaterThan(0);
    expect(shadows.filter((v) => v !== 'none')).toEqual([]);
  });

  // Two shapes, both tokens: 8px for a card, 4px for a thing inside one.
  // A literal `px` in a radius is a third shape nobody decided on.
  it('every border-radius is built from the two radius tokens and 0', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const radii = [...css.matchAll(/border-(?:[a-z]+-)*radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    const part = /^(?:var\(--e8-radius-(?:sm|lg)\)|0)$/;
    const bad = radii.filter((v) => !v.split(/\s+/).every((p) => part.test(p)));
    expect(bad).toEqual([]);
  });
});
