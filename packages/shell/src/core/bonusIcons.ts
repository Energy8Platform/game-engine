/**
 * Provider BUY BONUS icons. Like platform-core's preloader variants, one entry per provider:
 * `ShellConfig.bonusIcon` picks one by name, and every renderer draws it on its BUY BONUS button
 * (and the matching game-info legend row) in place of its own skin's glyph — html and pixi on their
 * accent disc, pixi-hb on its orange plaque, pixi-s on its yellow slab. Unset or unknown → the
 * skin's own icon.
 *
 * Each icon is a 24×24 fragment with one colour slot (`currentColor`, the skin's ink), the same
 * format as the skins' icon sheets. Details are cut out (`fill-rule="evenodd"`), so the button's
 * face shows through them. Add a provider by adding one entry here — `BonusIconName` widens.
 */
export const BONUS_ICONS = {
  /** The energy8 ticket with an "8" cut through it (e82.svg #bonus-icon, fitted to the 24 box). Absolute M/L/C
   *  only: Pixi's parser picks the evenodd body by subpath area, which it misjudges on relative commands. */
  energy8: `<path fill="currentColor" fill-rule="evenodd" d="M23.45 10.33L23.5 7.27C23.47 6.87 23.26 6.5 22.94 6.26L19 3.31C18.67 3.1 18.27 3.02 17.88 3.07L2.06 5.22C1.34 5.38 0.66 5.88 0.5 6.86L0.5 10.35C0.5 10.35 3.01 10.59 3.07 12.8C3.13 14.97 0.5 15.37 0.5 15.37L0.55 18.83C0.66 19.72 1.38 20.4 2.27 20.48L11.77 20.93L21.8 20.47C22.66 20.4 23.35 19.73 23.45 18.88L23.46 15.36C23.46 15.36 20.89 15.27 20.89 12.81C20.89 10.6 23.46 10.32 23.46 10.32ZM18.24 16.48C17.46 19.71 12.78 20.07 12.78 20.07C12.78 20.07 6.95 20.85 5.96 16.4C5.4 13.91 8.09 12.65 8.09 12.65C8.09 12.65 13.34 9.65 13.49 9.43C14.94 7.28 10.69 6.96 10.49 8.64C10.37 9.66 11.47 10.11 11.47 10.11L8.58 11.64C8.58 11.64 5.16 8.8 8.68 6.06C11.63 3.77 15.06 5.6 15.18 5.66C15.62 5.87 18.73 8.64 15.78 10.84L9.8 14.59C9.8 14.59 8.57 15.73 9.74 16.68C11.85 18.4 14.15 16.68 14.15 16.68C16 14.83 12.39 13.53 12.39 13.53L15.14 11.86C15.14 11.86 19 13.34 18.25 16.47Z"/>`,
} as const;

export type BonusIconName = keyof typeof BONUS_ICONS;

export function isBonusIcon(name: unknown): name is BonusIconName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(BONUS_ICONS, name);
}

/** A standalone, parseable 24×24 SVG document with the colour resolved. */
export function bonusIconSVG(name: BonusIconName, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${BONUS_ICONS[name].split('currentColor').join(color)}</svg>`;
}
