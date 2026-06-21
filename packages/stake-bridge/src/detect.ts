/**
 * Lightweight, non-throwing detector for a Stake Engine launch.
 *
 * Lives in a leaf module (no RGSClient / StakeBridge imports) so it can be
 * imported to gate whether to lazy-load the heavy bridge, without pulling
 * the bridge into the bundle.
 *
 * Returns true iff the URL carries `rgs_url` AND either a live `sessionID`
 * or `replay=true`. Any parse failure → false.
 */
export function isStakeLaunch(input: string | URL | Location): boolean {
  try {
    const href =
      typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
    const params = new URL(href).searchParams;
    if (!params.get('rgs_url')) return false;
    return params.get('sessionID') != null || params.get('replay') === 'true';
  } catch {
    return false;
  }
}
