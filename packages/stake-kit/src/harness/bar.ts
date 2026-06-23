/**
 * Stake harness bar helpers — pure, browser-safe, NO node imports.
 *
 * Provides the 7 Stake screen presets and the launch URL builder used
 * by both the control bar (Component 3) and the vite plugin wrapper page.
 */

// ---------------------------------------------------------------------------
// Screen presets
// ---------------------------------------------------------------------------

export interface ScreenPreset {
  name: string;
  w: number;
  h: number;
}

/** The 7 Stake screen presets, in bar order. */
export const SCREEN_PRESETS: ScreenPreset[] = [
  { name: 'Desktop',  w: 1200, h: 675 },
  { name: 'Laptop',   w: 1024, h: 576 },
  { name: 'Popout S', w: 400,  h: 225 },
  { name: 'Popout L', w: 800,  h: 450 },
  { name: 'Mobile L', w: 425,  h: 812 },
  { name: 'Mobile M', w: 375,  h: 667 },
  { name: 'Mobile S', w: 320,  h: 568 },
];

/**
 * Look up a screen preset by name. Returns `undefined` for unknown names.
 */
export function screenPreset(name: string): ScreenPreset | undefined {
  return SCREEN_PRESETS.find((p) => p.name === name);
}

// ---------------------------------------------------------------------------
// Launch URL
// ---------------------------------------------------------------------------

export interface LaunchOpts {
  /** e.g. 'localhost:5173/__rgs' — host + prefix, no scheme. RGSClient prepends the protocol. */
  rgsUrl: string;
  /** ISO 4217, e.g. 'USD'. */
  currency: string;
  social: boolean;
  /** Default 'en'. */
  lang?: string;
  /** Default 'desktop'. */
  device?: string;
  replay?: {
    game: string;
    version: string;
    mode: string;
    event: string | number;
    amount: number;
  };
}

/**
 * Build the iframe query string (with leading '?') the inner game launches with.
 *
 * Normal:  ?rgs_url&sessionID=dev&currency&social&lang&device
 * Replay:  ?replay=true&game&version&mode&event&amount&rgs_url
 *
 * Uses `URLSearchParams` for correct percent-encoding.
 */
export function buildLaunchUrl(opts: LaunchOpts): string {
  const { rgsUrl, currency, social, lang = 'en', device = 'desktop', replay } = opts;

  if (replay) {
    const params = new URLSearchParams({
      replay: 'true',
      game: replay.game,
      version: replay.version,
      mode: replay.mode,
      event: String(replay.event),
      amount: String(replay.amount),
      rgs_url: rgsUrl,
    });
    return `?${params.toString()}`;
  }

  const params = new URLSearchParams({
    rgs_url: rgsUrl,
    sessionID: 'dev',
    currency,
    social: String(social),
    lang,
    device,
  });
  return `?${params.toString()}`;
}
