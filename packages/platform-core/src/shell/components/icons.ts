// Duotone icon set — the shell's signature. Base tone uses --shell-icon,
// accent tone --shell-icon-bright; monochrome glyphs use currentColor so the
// caller's color cascades. All return an inline <svg> string sized 1em.
const BASE = 'var(--shell-icon)';
const BRIGHT = 'var(--shell-icon-bright)';

const SVGS: Record<string, string> = {
  // two curved arrows forming a ring (used dark-on-white inside SPIN)
  spin: `<path d="M18.5 9a7 7 0 0 0-12-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5.5 15a7 7 0 0 0 12 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19 5v4h-4M5 19v-4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  turbo: `<path d="M13 2 4 13.5h5.2L8 22l9-11.5h-5.2z" fill="${BRIGHT}"/>`,
  autoplay: `<circle cx="12" cy="12" r="9" fill="${BASE}"/><path d="M10 8.5v7l6-3.5z" fill="${BRIGHT}"/>`,
  menu: `<rect x="4" y="6" width="16" height="2.4" rx="1.2" fill="${BRIGHT}"/><rect x="4" y="10.8" width="11" height="2.4" rx="1.2" fill="${BASE}"/><rect x="4" y="15.6" width="16" height="2.4" rx="1.2" fill="${BRIGHT}"/>`,
  betUp: `<path d="M8 14l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  betDown: `<path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  betMinus: `<path d="M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  betPlus: `<path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  gift: `<rect x="4" y="9" width="16" height="11" rx="2" fill="currentColor"/><path d="M9 9a2.5 2.5 0 1 1 3-3 2.5 2.5 0 1 1 3 3z" fill="currentColor"/><rect x="11" y="9" width="2" height="11" fill="rgba(0,0,0,.35)"/>`,
  info: `<circle cx="12" cy="12" r="9" fill="${BASE}"/><rect x="11" y="11" width="2" height="6" rx="1" fill="var(--shell-surface)"/><circle cx="12" cy="8" r="1.2" fill="var(--shell-surface)"/>`,
  sound: `<path d="M5 9v6h3l5 4V5L8 9z" fill="${BASE}"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="${BRIGHT}" stroke-width="2" stroke-linecap="round"/>`,
  close: `<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  back: `<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronRight: `<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  star: `<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.9 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor"/>`,
};

export type IconName = keyof typeof SVGS;
export const ICON_NAMES = Object.keys(SVGS) as IconName[];

/** Inline SVG string for an icon, sized to 1em (scale via font-size/width). */
export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">${SVGS[name]}</svg>`;
}
