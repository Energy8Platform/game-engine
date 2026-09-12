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
    // are not colours a palette would own and stay allowed.
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:white|black|red|blue|green|gray|grey|silver|orange|yellow)\b/gi;
    expect(css.match(literal) ?? []).toEqual([]);
  });
});
