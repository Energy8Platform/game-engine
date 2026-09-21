/**
 * Runtime half of `session-host` — the `sessionhost1` row in `e8-base`, and
 * today's only candidate behind the `session` seam (spec §3; `sessionsdk1`
 * joins it in Task 4 — `@energy8engine/seam` picks one per composition,
 * `createGame` drops the rest).
 *
 * Before this row existed, a flow's `spin`/`step` kinds had nowhere to go
 * but a hand-written `fetch('/api/spin')` baked into the flow interpreter —
 * every consumer of a play result had to know it was talking to THIS host,
 * on THIS route, in THIS shape. This row is that knowledge moved to one
 * place: it turns the dev host's `GET /api/session` / `POST /api/spin` into
 * the seam-shaped `SessionService` (`@energy8engine/contracts`) every flow
 * kind already reads leniently (`ctx.reflect.get('session', false)`,
 * `kinds.ts`'s `playThrough`) — so a flow authored against this row plays
 * unmodified against `session-sdk`'s real-platform version later.
 *
 * **Why the wallet lives HERE, in the browser, and not on the host.**
 * `/api/spin` itself has no ledger — `dev-game.ts`'s route is a pass-
 * through to `session-dev`'s `e8-server` process, which speaks bet
 * multipliers (`SpinResult.win`/`totalWin`), never currency, and remembers
 * nothing between calls. Something has to turn "bet 1, win 2×" into a
 * balance a shell can show, and the alternative to doing it here — teaching
 * the HOST to track one — would mean a wallet that outlives the tab it
 * belongs to, survives a restart of `e8-server`, and needs its own reset
 * story. None of that is wanted for a DEV wallet: this one is exactly as
 * durable as the TAB — `sessionStorage['e8:wallet:<gameId>']`, written
 * after every play and read back on the next load, so a reload keeps the
 * balance and a new tab starts over at `init.balance` (1000, or whatever
 * `/api/session` answered). The game id comes with that answer; without
 * one (a host that predates it, the fallback init) or without
 * `sessionStorage` (a node test) nothing persists. A real ledger is
 * `session-sdk`'s platform.
 *
 * **Why every diagnostic here names `'session-host'`, not `'session'`.**
 * `session` is the cordis *service key* both candidates behind this seam
 * provide — `session-sdk` (Task 4) answers to the exact same name, on a
 * different composition. A diagnostic's `plugin` field is how a reader
 * tells who is speaking (see `@energy8engine/contracts`'s `diagnostic.ts`);
 * naming the seam instead of the row would make every failure look like it
 * came from whichever provider the reader assumed was composed.
 *
 * **Why `play()` RETURNS diagnostics instead of reporting them.** The flow
 * kind that calls `play()` — `playThrough` in `@energy8engine/flow`'s
 * `kinds.ts` — already re-reports whatever comes back, at the severity the
 * provider chose, onto the node that made the call. Reporting a second time
 * from inside this row would put every failed spin on screen twice: once
 * with the node that asked, once with no node at all. The one diagnostic
 * this row DOES report itself — a failed `GET /api/session` at boot — has
 * no node to attach to; nothing has run yet.
 */
import type { Context } from 'cordis';
import {
  diagnostic,
  withAmounts,
  type Diagnostic,
  type PlayRequest,
  type SessionInit,
  type SessionService,
  type SpinResult,
} from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';

declare module 'cordis' {
  interface Context {
    session: SessionService;
  }
}

export interface SessionHostConfig {
  /** Tests only; the page's `fetch` otherwise — same device as `flow1`'s `FlowConfig.fetchFn`. */
  fetchFn?: typeof fetch;
}

/**
 * What a game plays with when `GET /api/session` itself could not be read —
 * a down host, or a project with no game at all. `betLevels: [1]` keeps the
 * shell's bet stepper from being handed an empty ladder; `balance: 0` is
 * honest about a wallet nothing actually funded.
 */
const FALLBACK_INIT: SessionInit = {
  balance: 0,
  currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  betLevels: [1],
  defaultBet: 1,
};

/**
 * The persisted wallet, or `undefined` when there is nowhere to keep one.
 * `typeof sessionStorage` is inside the try on purpose: in a browser the
 * property is a getter that throws when storage is denied to the frame.
 */
function walletStore(gameId: string | undefined) {
  try {
    if (!gameId || typeof sessionStorage === 'undefined') return undefined;
    const key = `e8:wallet:${gameId}`;
    return {
      read(): number | undefined {
        const stored = Number(sessionStorage.getItem(key) ?? NaN);
        return Number.isFinite(stored) ? stored : undefined;
      },
      write(balance: number): void {
        sessionStorage.setItem(key, String(balance));
      },
    };
  } catch {
    return undefined;
  }
}

export const name = 'session';
export const inject = [];

export async function apply(ctx: Context, config: SessionHostConfig = {}): Promise<void> {
  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);

  let init: SessionInit;
  let gameId: string | undefined;
  try {
    const res = await fetchFn('/api/session');
    if (!res.ok) throw new Error(`the host answered ${res.status}`);
    // `gameId` is the wallet's key, not part of `init` — the flow's
    // `$session` root is the seam's shape and nothing more.
    ({ gameId, ...init } = (await res.json()) as SessionInit & { gameId?: string });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report(
      diagnostic(
        'warning',
        'session-host',
        '/api/session',
        `could not read the session: ${message}`,
        'the dev wallet starts at 0 until the host answers',
      ),
    );
    init = FALLBACK_INIT;
  }

  // The dev wallet (see the module doc). Charged/credited by `play` below;
  // read fresh by the live root's getter on every `$session.balance`. A
  // stored balance (this tab's earlier load) wins over the seed.
  const store = walletStore(gameId);
  let balance = store?.read() ?? init.balance;

  async function play(req: PlayRequest): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }> {
    // A step of an OPEN round (a `roundId` carried forward from the result
    // that started it) costs nothing — the bet was already charged when the
    // round started. Only a fresh round (`roundId` absent) debits.
    if (req.roundId === undefined) balance -= req.betLevel ?? 0;
    store?.write(balance);

    try {
      const res = await fetchFn('/api/spin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `JSON.stringify` already drops a key whose value is `undefined` —
        // the "omit undefined keys" the wire body wants costs nothing extra.
        body: JSON.stringify({
          action: req.action,
          betLevel: req.betLevel,
          roundId: req.roundId,
          params: req.params,
        }),
      });

      if (!res.ok) {
        // `dev-game.ts`'s route answers `{ diagnostics }` on a failure it
        // understands (a session that never started, a bad request); a
        // status this row wasn't told the shape of still gets ONE
        // diagnostic naming it, rather than silently losing the failure.
        const body = (await res.json().catch(() => undefined)) as
          | { diagnostics?: Diagnostic[] }
          | undefined;
        return {
          diagnostics: Array.isArray(body?.diagnostics)
            ? body.diagnostics
            : [diagnostic('error', 'session-host', '/api/spin', `POST /api/spin → ${res.status}`)],
        };
      }

      const result = withAmounts((await res.json()) as SpinResult);
      balance += result.winAmount ?? 0;
      store?.write(balance);
      result.balance = balance;
      return { result, diagnostics: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { diagnostics: [diagnostic('error', 'session-host', '/api/spin', message)] };
    }
  }

  ctx.provide('session', { init, play });

  // The live root (`@energy8engine/flow`'s `provideRoot`) — `$session.…` in
  // any node of any run. `ctx.inject`, not a lenient read at apply time:
  // `sessionhost1` composes before `flow1` in `e8-base`, so at THIS row's
  // own apply time there is nothing to register with yet — the same reason
  // `play-loop`'s `ui.skip` subscription rides `ctx.inject(['flow'])`
  // rather than reading `flow` straight off `ctx`.
  ctx.inject(['flow'], (c) => {
    c.effect(
      () => c.get('flow').provideRoot('session', () => ({ ...init, balance })),
      'session-host:root',
    );
  });
}
