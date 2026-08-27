/**
 * Can the player in front of this client actually press a key?
 *
 * The shell documents its shortcuts in a Hotkeys section and binds Spacebar to spin. On a phone
 * neither is reachable, and showing a keycap chart to someone holding a touchscreen is a promise
 * the game can't keep — a certification lab reads it as a feature offered where it doesn't work.
 *
 * The question is deliberately NOT "is the layout narrow" (a portrait desktop window still has a
 * keyboard) and NOT "is there a touchscreen" (a touch laptop has both). It is: what does the
 * PRIMARY pointer look like, and can it hover? Coarse-and-hoverless is a touchscreen, and a
 * touchscreen is the one case where the keys genuinely aren't there.
 *
 * A tablet with a keyboard case answers "coarse, no hover" too and loses the chart. That is the
 * right side to be wrong on: the chart is a convenience, and the keys keep working for anyone who
 * has them — the media query only decides what the shell ADVERTISES (hosts can still say outright,
 * via `features.hotkeys`, and the platform's own `device` field does exactly that).
 */

interface MediaQueryHost {
  matchMedia?(query: string): { matches: boolean };
}

/** A touchscreen: the primary pointer is a finger, and nothing can hover. */
const TOUCH_ONLY = '(pointer: coarse) and (hover: none)';

export function keyboardCapable(
  win: MediaQueryHost | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  // No window (SSR, node tests) or a browser too old for matchMedia: assume a keyboard rather than
  // silently stripping shortcuts from a desktop we simply failed to measure.
  if (typeof win?.matchMedia !== 'function') return true;
  try {
    return !win.matchMedia(TOUCH_ONLY).matches;
  } catch {
    return true;
  }
}
