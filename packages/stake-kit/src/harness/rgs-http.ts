/**
 * Transport-agnostic RGS request → dev-RGS glue.
 *
 * Maps one HTTP-shaped request (already parsed) to a `DevRgs` call and
 * returns a `{ status, json }` result that a vite middleware (Task 4)
 * can stream back as-is. No vite, no DOM, no HTTP server.
 *
 * Path matching is suffix-based — robust to a `/__rgs` prefix mounted
 * by the vite plugin.
 */

import type { RGSPlayResponse } from '@energy8platform/stake-bridge';
import type { DevRgs } from './dev-rgs';
import { NoBooksError } from './dev-rgs';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RgsRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface RgsResult {
  status: number;
  json: unknown;
}

/**
 * Optional Lua fallback invoked when a mode has no curated books
 * (`NoBooksError`). Task 4 supplies the real implementation; tests
 * can pass a stub.
 */
export type LuaPlay = (params: { mode: string; amount: number }) => Promise<RGSPlayResponse>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse body: already an object → return as-is; string → JSON.parse; else {}. */
function parseBody(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty
    }
  }
  return {};
}

/** Returns true if the request path ends with the given suffix (after stripping trailing slash). */
function pathEndsWith(path: string, suffix: string): boolean {
  const normalised = path.replace(/\/+$/, '');
  return normalised === suffix || normalised.endsWith('/' + suffix.replace(/^\//, ''));
}

/**
 * Extract the 4 trailing segments from a replay GET path.
 * Splits on `/bet/replay/` and takes `game/version/mode/event`.
 * Returns null if the path does not contain that prefix with 4 segments.
 */
function parseReplayPath(
  path: string,
): { game: string; version: string; mode: string; event: string } | null {
  const idx = path.indexOf('/bet/replay/');
  if (idx === -1) return null;
  const tail = path.slice(idx + '/bet/replay/'.length);
  const parts = tail.split('/');
  if (parts.length < 4) return null;
  const [game, version, mode, event] = parts;
  return { game, version, mode, event };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Map one RGS HTTP request to a dev-RGS call.
 *
 * Route table (matched by path SUFFIX):
 *   POST .../wallet/authenticate  → devRgs.authenticate()
 *   POST .../wallet/balance       → devRgs.balance()
 *   POST .../wallet/play          → devRgs.play({ mode, amount })
 *   POST .../wallet/end-round     → devRgs.endRound()
 *   POST .../bet/event            → devRgs.event(value)
 *   GET  .../bet/replay/{g}/{v}/{m}/{e} → devRgs.replay({ mode, event })
 *
 * Error handling:
 *   - NoBooksError from play + luaPlay provided → delegate to luaPlay
 *   - NoBooksError from play + no luaPlay       → 503
 *   - NoBooksError from replay                  → 404
 *   - Unknown path                              → 404
 */
export async function handleRgsRequest(
  devRgs: DevRgs,
  req: RgsRequest,
  luaPlay?: LuaPlay,
): Promise<RgsResult> {
  const { method, path } = req;
  const body = parseBody(req.body);
  const M = method.toUpperCase();

  // POST /wallet/authenticate
  if (M === 'POST' && pathEndsWith(path, '/wallet/authenticate')) {
    const json = await devRgs.authenticate();
    return { status: 200, json };
  }

  // POST /wallet/balance
  if (M === 'POST' && pathEndsWith(path, '/wallet/balance')) {
    const json = await devRgs.balance();
    return { status: 200, json };
  }

  // POST /wallet/play
  if (M === 'POST' && pathEndsWith(path, '/wallet/play')) {
    const mode = typeof body.mode === 'string' ? body.mode : '';
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount ?? 0);
    try {
      const json = await devRgs.play({ mode, amount });
      return { status: 200, json };
    } catch (err) {
      if (err instanceof NoBooksError) {
        if (luaPlay) {
          const json = await luaPlay({ mode, amount });
          return { status: 200, json };
        }
        return {
          status: 503,
          json: {
            error: 'ERR_NO_BOOKS',
            message: (err as NoBooksError).message,
          },
        };
      }
      throw err;
    }
  }

  // POST /wallet/end-round
  if (M === 'POST' && pathEndsWith(path, '/wallet/end-round')) {
    const json = await devRgs.endRound();
    return { status: 200, json };
  }

  // POST /bet/event
  if (M === 'POST' && pathEndsWith(path, '/bet/event')) {
    const value = typeof body.event === 'string' ? body.event : String(body.event ?? '');
    const json = await devRgs.event(value);
    return { status: 200, json };
  }

  // GET /bet/replay/{game}/{version}/{mode}/{event}
  if (M === 'GET') {
    const segments = parseReplayPath(path);
    if (segments) {
      const { mode, event } = segments;
      try {
        const json = await devRgs.replay({ mode, event });
        return { status: 200, json };
      } catch (err) {
        if (err instanceof NoBooksError) {
          return {
            status: 404,
            json: {
              error: 'ERR_NO_BOOKS',
              message: (err as NoBooksError).message,
            },
          };
        }
        throw err;
      }
    }
  }

  return { status: 404, json: { error: 'ERR_NOT_FOUND', message: `Unknown path: ${path}` } };
}
