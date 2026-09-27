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
/**
 * Anchored to the start of a line: the two token blocks sit at column 0,
 * and nothing else does. The earlier `\[data-theme[^{]*{` also swallowed
 * any rule that merely STARTS with the attribute (`[data-theme='light']
 * .e8-x { color: #fff }`), which is exactly where a literal would hide.
 */
const TOKEN_BLOCKS = /^:root\s*{[^}]*}|^\[data-theme='light'\]\s*{[^}]*}/gm;

describe('styles.css token guard', () => {
  it('strips only the two token blocks, not a themed rule', () => {
    const themedRule = "[data-theme='light'] .e8-x { color: #fff }";
    expect(themedRule.replace(TOKEN_BLOCKS, '')).toBe(themedRule);
    expect(`:root {\n  --e8-fg: #fff;\n}\n${themedRule}`.replace(TOKEN_BLOCKS, '')).toBe(
      `\n${themedRule}`,
    );
    expect("[data-theme='light'] {\n  --e8-fg: #000;\n}".replace(TOKEN_BLOCKS, '')).toBe('');
  });

  it('every colour in the stylesheet is a token, not a literal', () => {
    const css = readFileSync('src/styles.css', 'utf8').replace(TOKEN_BLOCKS, '');
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
    expect(shadows.filter((v) => v !== 'none')).toEqual([]);
  });

  // The sash grip is VS Code's three dots, drawn as a repeating
  // radial-gradient — the one way to get three of them under the
  // no-shadow rule above without three elements.
  it('the sash grip is three gradient dots, not one', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = /\.e8-resize::after\s*{([^}]*)}/.exec(css)![1];
    expect(rule).toMatch(/radial-gradient\(circle,\s*currentColor/);
    expect(rule).toMatch(/repeat-y/);
    expect(rule).not.toMatch(/box-shadow/);
    const horizontal = /\.e8-resize-y::after\s*{([^}]*)}/.exec(css)![1];
    expect(horizontal).toMatch(/repeat-x/);
  });

  // Two shapes, both tokens: 8px for a card, 4px for a thing inside one.
  // A literal `px` in a radius is a third shape nobody decided on.
  it('every border-radius is built from the two radius tokens and 0', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const radii = [...css.matchAll(/border-(?:[a-z]+-)*radius\s*:\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    const part = /^(?:var\(--e8-radius-(?:sm|lg)\)|0)$/;
    const bad = radii.filter((v) => !v.split(/\s+/).every((p) => part.test(p)));
    expect(bad).toEqual([]);
  });
});

describe('I1 — the field hint sits under the control, not beside it', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const rule = (selector: string, body: string) => {
    const re = new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*{([^}]*)}`);
    return re.exec(body)?.[1];
  };

  // `.e8-field` is the 3-column `label | control | badge` grid: with the
  // badge now DOM-before the hint (fields.tsx), the hint must be told to
  // start at column 2 so it lands under the control instead of auto-placing
  // into the (now taken) 3rd column.
  it('the wide 3-column field grid pushes the hint under the control (column 2 through the end)', () => {
    expect(rule('.e8-field > .e8-field-hint', css)).toMatch(/grid-column:\s*2\s*\/\s*-1/);
  });

  // `.e8-properties .e8-field` collapses to ONE column (the sidebar is too
  // narrow for the 3-column layout) — a `grid-column: 2 / -1` there would
  // create a stray implicit column 2 nothing else occupies.
  it('the properties sidebar (one column) resets the hint back to the full row', () => {
    expect(rule('.e8-properties .e8-field > .e8-field-hint', css)).toMatch(
      /grid-column:\s*1\s*\/\s*-1/,
    );
  });

  // The ≤768px media query also collapses `.e8-field` to one column
  // (composition rows on a narrow pane) — same reset needed there. Brace-
  // counted rather than a `[^}]*` regex: the query wraps a whole rule, so
  // its own body contains a nested `{...}` a flat regex would cut short at.
  it('the ≤768px media query also resets the hint back to the full row', () => {
    const start = css.indexOf('@media (max-width: 768px)');
    const open = css.indexOf('{', start);
    let depth = 1;
    let i = open + 1;
    while (depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const media = css.slice(open + 1, i - 1);
    expect(rule('.e8-field > .e8-field-hint', media)).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });
});

// M3: under ~550px of doc pane, cell size + zoom + Play used to clip
// instead of wrapping onto their own row — the group had no `flex-wrap`.
describe('M3 — the symbols toolbar right group wraps', () => {
  it('.e8-symbols-toolbar-right has flex-wrap: wrap', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = /\.e8-symbols-toolbar-right\s*{([^}]*)}/.exec(css)![1];
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
  });
});
