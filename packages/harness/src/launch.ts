/**
 * Generic launch-URL builder — pure, browser-safe.
 *
 * The backend contributes the constant params (`base` / `replayBase`, e.g.
 * `rgs_url`, `sessionID`, `game`, `version`); the core adds the params it owns
 * (`currency`, `social`, `lang`, `device`) plus the replay inputs
 * (`mode`, `event`, `amount`). No backend knowledge lives here.
 */

export interface CoreLaunchState {
  currency: string;
  social: boolean;
  lang: string;
  device: string;
}

export interface ReplayInput {
  mode: string;
  event: string | number;
  /** In MINOR units (already multiplied). */
  amount: number;
}

/**
 * Sentinel param the launcher always adds so the plugin can tell the game iframe
 * request (has it) from the bare wrapper document request (does not) regardless
 * of whether a backend contributes an `rgs_url`.
 */
export const GAME_MARKER = '__harness_game';

/** Build the iframe query string (with leading '?') for a normal launch. */
export function buildLaunchUrl(base: Record<string, string>, s: CoreLaunchState): string {
  const p = new URLSearchParams({
    ...base,
    currency: s.currency,
    social: String(s.social),
    lang: s.lang,
    device: s.device,
    [GAME_MARKER]: '1',
  });
  return `?${p.toString()}`;
}

/** Build the iframe query string (with leading '?') for a replay launch. */
export function buildReplayUrl(
  replayBase: Record<string, string>,
  s: CoreLaunchState,
  r: ReplayInput,
): string {
  const p = new URLSearchParams({
    ...replayBase,
    mode: r.mode,
    event: String(r.event),
    amount: String(r.amount),
    currency: s.currency,
    social: String(s.social),
    lang: s.lang,
    [GAME_MARKER]: '1',
  });
  return `?${p.toString()}`;
}
