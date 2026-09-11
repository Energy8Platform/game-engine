import type { Context } from 'cordis';
import { type Diagnostic, type DiagnosticsResponse, diagnostic } from '@energy8engine/contracts';

/**
 * The browser side of `POST /api/check` (`engine/ide/host/src/plugins/schema.ts`):
 * "what is wrong with this text", for `.spin` source that lives only in a
 * browser editor buffer and has never been written to `game/script.spin`.
 *
 * Shaped after `files.ts`'s `diagnosticsFromBody`, not its `tree()`: the
 * answer is a plain `DiagnosticsResponse`, one field, so there is no
 * "own key" for this plugin to check ahead of the host's — the shape
 * `tree()` once got backwards does not exist here. The equivalent mistake
 * would be reading `res.ok` before reading the body: the host's real
 * refusal for a malformed POST is a 400 whose body still carries a real
 * `diagnostics` array (see schema.ts's own route), so this reads the body
 * on every response regardless of status, the same way `diagnosticsFromBody`
 * already does for `write`/`remove`.
 */
declare module 'cordis' {
  interface Context {
    check: CheckService;
  }
}

export interface CheckService {
  /** Diagnostics for this text. Never throws; a dead network is a diagnostic. */
  check(source: string): Promise<{ diagnostics: Diagnostic[] }>;
}

export interface CheckConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

export const name = 'check';

/** The one diagnostic this client authors itself: the request never got a usable answer. */
function ownDiagnostic(message: string): Diagnostic {
  return diagnostic('error', 'check', '/api/check', message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx: Context, config: CheckConfig = {}): void {
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function check(source: string): ReturnType<CheckService['check']> {
    let res: Response;
    try {
      res = await fetchFn('/api/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
    } catch (error) {
      return { diagnostics: [ownDiagnostic(describeError(error))] };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      return { diagnostics: [ownDiagnostic(describeError(error))] };
    }
    const parsed = body as Partial<DiagnosticsResponse>;
    if (!Array.isArray(parsed.diagnostics)) {
      return { diagnostics: [ownDiagnostic('the response has no "diagnostics" array')] };
    }
    return { diagnostics: parsed.diagnostics as Diagnostic[] };
  }

  ctx.provide('check', { check });
}
