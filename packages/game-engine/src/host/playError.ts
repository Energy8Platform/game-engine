/**
 * Classify a play/settle error into a player-facing modal payload.
 *
 * The SDK rejects `play()` with an `SDKError` carrying a `.code` (e.g. `ACTIVE_SESSION_EXISTS`,
 * `INSUFFICIENT_FUNDS`, `TIMEOUT`). The bridge ALSO emits a `connectionStateChanged: 'lost'` for
 * some of these, which would otherwise surface a misleading "Reconnecting…" overlay while the real
 * fix is "reload to resume". The host routes every play error through this classifier so the player
 * sees the right message + action, and suppresses the connection overlay while a play-error modal
 * is up.
 *
 * `reload: true` → the round must be recovered by reloading (an unfinished round blocks new plays);
 * the modal offers a Reload button. Otherwise it's a dismissible OK.
 */
export interface PlayErrorView {
  title: string;
  body: string;
  /** Offer a Reload action (the round can only be recovered by reloading). */
  reload: boolean;
  /**
   * The LINK failed, not the round: the bridge is already reconnecting, and the connection overlay
   * (driven by `connectionStateChanged`) owns the screen. Such a failure gets NO modal of its own —
   * a "reload the page" screen over a blip the bridge heals by itself is exactly the wrong answer,
   * and it was the one the player used to get, because every autoplay round is a play in flight.
   */
  connection?: boolean;
}

/**
 * Codes that mean "the connection died", per bridge:
 *  - `ConnectionLost` / `ConnectionFailed` — Artube's WS client (a pending play on a dropped
 *    socket, or a play attempted while the socket is down);
 *  - `ERR_NET` — Stake's RGS client, after its retries are exhausted on a network-level failure.
 */
const CONNECTION_CODES = new Set(['ConnectionLost', 'ConnectionFailed', 'ERR_NET']);

/** Pull a Stake/SDK error code off an unknown thrown value. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

export function resolvePlayError(err: unknown): PlayErrorView {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (code && CONNECTION_CODES.has(code)) {
    return {
      title: 'Connection lost',
      body: 'Lost connection to the game server. Trying to reconnect…',
      reload: false,
      connection: true,
    };
  }
  switch (code) {
    case 'ACTIVE_SESSION_EXISTS':
      return {
        title: 'Round in progress',
        body: 'You have an unfinished round. Reload to resume it.',
        reload: true,
      };
    case 'NO_ACTIVE_SESSION':
      return {
        title: 'Round expired',
        body: 'This round is no longer active. Reload to continue.',
        reload: true,
      };
    case 'INSUFFICIENT_FUNDS':
      return {
        title: 'Insufficient balance',
        body: 'You don’t have enough balance for this bet. Lower your bet or top up.',
        reload: false,
      };
    case 'TIMEOUT':
      return {
        title: 'Connection timed out',
        body: 'The game server did not respond in time. Please try again.',
        reload: false,
      };
    default:
      // Unknown code: surface the server message verbatim under a generic heading (never the
      // connection overlay), so an operator can diagnose without a code change.
      return {
        title: 'Game error',
        body: message || 'Something went wrong. Please reload the game.',
        reload: true,
      };
  }
}
