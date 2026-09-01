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
 * Registrable domains whose hosts may serve the RGS. A value here admits the apex AND any
 * subdomain of it — and NOTHING else, in particular nothing that merely ends in the same
 * characters. Keep that distinction in mind before adding one: an entry is a promise that the
 * whole domain is ours, because whoever holds it receives the player's session.
 */
const RGS_DOMAINS = ['stake-engine.com', 'engine.io'] as const;

/** Loopback hosts for the dev harness, which serves the dev-RGS at `/__rgs`. */
const RGS_LOOPBACK = ['localhost', '127.0.0.1'] as const;

/**
 * Open-redirect guard for the `rgs_url` launch param. Stake passes it as a BARE hostname
 * (`rgs_url=rgsd.stake-engine.com`, no scheme — the bridge prepends `https://`), but a tampered
 * value (`evil.com`, `https://evil.com/x`) would otherwise become the API base and exfiltrate the
 * session. Accept ONLY the {@link RGS_DOMAINS} and {@link RGS_LOOPBACK} hosts; everything else is
 * rejected.
 *
 * The match is apex-or-dotted-suffix, never a bare `endsWith`. A bare suffix test on `engine.io`
 * would also admit `stake-engine.io` and `evilengine.io` — names anyone can register, and ones
 * that read as legitimate at a glance in a log.
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
  if ((RGS_LOOPBACK as readonly string[]).includes(host)) return true; // dev harness
  return RGS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
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
 *    (blanked, or not an allowed RGS host — see {@link RGS_DOMAINS}). The game MUST refuse to run:
 *    without this, the missing/invalid `rgs_url` would fall through to the offline/dev bridge and let the
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
