/**
 * Screen presets — pure, browser-safe. Core harness concept: framing the game
 * at the screen sizes we test behaviour on (not backend-specific).
 */

export interface ScreenPreset {
  name: string;
  w: number;
  h: number;
}

/** The 7 screen presets, in bar order. */
export const SCREEN_PRESETS: ScreenPreset[] = [
  { name: 'Desktop', w: 1200, h: 675 },
  { name: 'Laptop', w: 1024, h: 576 },
  { name: 'Popout S', w: 400, h: 225 },
  { name: 'Popout L', w: 800, h: 450 },
  { name: 'Mobile L', w: 425, h: 812 },
  { name: 'Mobile M', w: 375, h: 667 },
  { name: 'Mobile S', w: 320, h: 568 },
];

/** Look up a screen preset by name. `undefined` for unknown names. */
export function screenPreset(name: string): ScreenPreset | undefined {
  return SCREEN_PRESETS.find((p) => p.name === name);
}
