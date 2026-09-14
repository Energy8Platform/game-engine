import type { ShellTokens } from '@/core/theme';

/** The Hellbuddha palette. Fixed by brand: `theme.scheme` / `theme.accent` from ShellConfig are
 *  ignored by this renderer. */
export const HB = {
  orange: '#ff7a00',
  gold: '#f5b800', // orange's hover
  red: '#e0301e', // volatility fill, feature (Ante) CTA
  beige: '#f5efe3',
  beigeHover: '#e3d8c4',
  ink: '#1a120a', // borders, glyphs and text on beige/orange
  panel: '#1e1410', // solid modal / popover ground
  bar: 'rgba(30,20,16,.72)',
  fg: '#f5efe3',
  muted: 'rgba(245,239,227,.6)',
  track: 'rgba(245,239,227,.18)',
  line: 'rgba(245,239,227,.25)', // card borders on the panel ground
  backdrop: 'rgba(10,6,4,.55)',
  winOk: '#4ade80',
  winNo: '#f87171',
} as const;

export const BORDER = 3;
export const RADIUS = 8;

/** A ShellTokens-shaped view of the palette so `createShell`'s host typing keeps working. HB
 *  components read `HB` directly; this only feeds core (e.g. the popover's default colours). */
export function resolveHbTokens(): ShellTokens {
  return {
    fg: HB.fg,
    muted: HB.muted,
    icon: HB.fg,
    iconActive: HB.orange,
    surface: HB.panel,
    hairline: HB.line,
    veil: 'rgba(245,239,227,.05)',
    veilStrong: 'rgba(245,239,227,.1)',
    track: HB.track,
    soft: HB.beige,
    spin: HB.orange,
    spinFg: HB.beige,
    plaqueDark: HB.panel,
    plaqueGlass: HB.panel,
    plaqueGlassHover: '#2a1c16',
    plaqueSolid: HB.panel,
    plaqueLine: HB.line,
    plaqueLabel: HB.muted,
    bar: HB.bar,
    btn: HB.beige,
    btnInk: HB.ink,
    accent: HB.orange,
    backdrop: HB.backdrop,
    white: HB.beige,
    winOk: HB.winOk,
    winNo: HB.winNo,
  };
}
