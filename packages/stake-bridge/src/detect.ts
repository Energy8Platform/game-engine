/**
 * Lightweight, non-throwing detection + validation for a Stake Engine launch.
 *
 * Lives in a leaf module (no RGSClient / StakeBridge imports) so the host can
 * import it to gate whether to lazy-load the heavy bridge — and to enforce the
 * security guard below — without pulling the bridge into the bundle.
 */

function toHref(input: string | URL | Location): string {
  return typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
}

/** Parse the launch URL's query params, or `null` if the URL is malformed. */
function paramsOf(input: string | URL | Location): URLSearchParams | null {
  try {
    return new URL(toHref(input)).searchParams;
  } catch {
    return null;
  }
}

/** True if the URL carries a Stake session marker: a live `sessionID` or `replay=true`. */
function hasSessionMarker(params: URLSearchParams): boolean {
  return params.get('sessionID') != null || params.get('replay') === 'true';
}

/**
 * Open-redirect guard for the `rgs_url` launch param. Stake passes it as a BARE hostname
 * (`rgs_url=rgsd.stake-engine.com`, no scheme — the bridge prepends `https://`), but a tampered
 * value (`evil.com`, `https://evil.com/x`) would otherwise become the API base and exfiltrate the
 * session. Accept ONLY `*.stake-engine.com` (the production RGS) and `localhost`/`127.0.0.1` (the
 * dev harness, which serves the dev-RGS at `/__rgs`). Everything else is rejected.
 *
 * Handles both the bare-hostname form (optionally with `:port` and a path) and a scheme-prefixed
 * URL; in both cases only the HOST is whitelisted.
 */
export function isValidRgsUrl(raw: string): boolean {
  if (!raw) return false;
  let host: string;
  if (/^https?:\/\//i.test(raw)) {
    try {
      host = new URL(raw).hostname;
    } catch {
      return false;
    }
  } else {
    // Bare form: drop any path/query/fragment, then split off an optional :port.
    const hostPort = raw.split(/[/?#]/)[0];
    if (!/^[a-zA-Z0-9.:-]+$/.test(hostPort)) return false; // rejects spaces, slashes, etc.
    host = hostPort.split(':')[0];
  }
  host = host.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true; // dev harness
  return host === 'stake-engine.com' || host.endsWith('.stake-engine.com');
}

/**
 * Returns true iff the URL is a complete, trustworthy Stake launch: a valid `rgs_url`
 * AND either a live `sessionID` or `replay=true`. Any parse failure → false.
 *
 * NOTE: this now also requires the `rgs_url` to pass {@link isValidRgsUrl}. A missing OR tampered
 * `rgs_url` returns false — use {@link classifyStakeLaunch} to tell a genuine non-Stake launch apart
 * from a tampered one (the latter must be refused, not run offline).
 */
export function isStakeLaunch(input: string | URL | Location): boolean {
  const params = paramsOf(input);
  if (!params) return false;
  const rgs = params.get('rgs_url');
  if (!rgs || !isValidRgsUrl(rgs)) return false;
  return hasSessionMarker(params);
}

/**
 * How the host should treat a launch URL:
 *  - `'stake'`   — a complete, valid Stake launch (valid `rgs_url` + session marker); load the bridge.
 *  - `'blocked'` — Stake session markers are present but the `rgs_url` is missing or tampered
 *    (blanked, or not a `*.stake-engine.com`/localhost host). The game MUST refuse to run: without
 *    this, the missing/invalid `rgs_url` would fall through to the offline/dev bridge and let the
 *    player spin for free.
 *  - `'offline'` — no Stake session markers at all; a genuine dev / non-Stake launch (offline bridge).
 */
export type StakeLaunchKind = 'stake' | 'blocked' | 'offline';

export function classifyStakeLaunch(input: string | URL | Location): StakeLaunchKind {
  const params = paramsOf(input);
  if (!params) return 'offline'; // unparseable → nothing Stake-ish to enforce
  if (!hasSessionMarker(params)) return 'offline'; // not a Stake launch → dev/offline path
  // Session markers present → this launch claims to be a Stake session, so it MUST carry a valid
  // rgs_url. Missing or tampered → block (do not silently downgrade to the offline bridge).
  const rgs = params.get('rgs_url');
  return rgs && isValidRgsUrl(rgs) ? 'stake' : 'blocked';
}
