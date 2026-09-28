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
 * durable as the TAB — `sessionStorage['e8:wallet:<gameId>:<balance>:
 * <currency code>']`, written after every play the host ANSWERED (see
 * `play`: a fetch that throws charges the tab, not the store) and read back
 * on the next load, so a reload keeps the balance and a new tab starts over
 * at `init.balance` (1000, or whatever `/api/session` answered). The game
 * id comes with that answer; without one (a host that predates it, the
 * fallback init) or without `sessionStorage` (a node test) nothing
 * persists. A real ledger is `session-sdk`'s platform.
 *
 * **Why the key also carries `balance`/`currency` (slice 39), not `gameId`
 * alone.** The Preview toolbar's own address can seed a DIFFERENT wallet on
 * the very next load — a different `balance=`, a different `currency=` —
 * and that is a fresh wallet to start, not the old tab's leftover balance
 * read back under a seed that no longer describes it. Keying on `gameId`
 * alone could not tell those two loads apart; keying on the triple means a
 * changed seed is itself what selects a fresh key, while the SAME toolbar
 * (a plain reload) still finds its own key and keeps the balance it left
 * off at.
 *
 * **Why the key's last segment is the Preview's wallet number (slice 43),
 * carried separately from the seed above.** The Preview's `?wallet=<n>`
 * is not part of what `GET /api/session` is even asked — `sessionQuery`
 * forwards none of it, the host never sees it — because it is the Preview
 * itself, not the seed, that owns it: it is bumped on every balance pick
 * or `↺`, so the SAME seed can be told to start over without touching
 * `balance`/`currency` at all. Folding it into this row's own key does
 * exactly that: a pick changes the number, so the next load finds no
 * stored value under it and starts fresh at `init.balance`; a refresh
 * keeps the same address, so the same number finds the same key and keeps
 * the wallet where it left off. No `wallet` in the address (a shell that
 * predates the Preview, or any host run outside it) leaves the key exactly
 * as it was before this paragraph existed.
 *
 * What an opening play charges is `betLevel × init.actions[req.action]`, not
 * `betLevel` alone — an unpriced action (no `init.actions`, or one that
 * names no entry for it) charges `× 1`, same as before `actions` existed.
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
  /** Tests only; the page's own `location.search` otherwise. */
  search?: string;
}

/** The Preview toolbar's parameters (slice 39), in this order — the only part of the page's address the dev host is told. */
const FORWARDED = ['lang', 'currency', 'balance', 'social', 'device'] as const;

/** `?lang=…&currency=…` from a page's `location.search`, or `''` when it carries none of them. */
export function sessionQuery(search: string): string {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = from.get(key);
    if (value !== null) to.set(key, value);
  }
  const query = to.toString();
  return query ? `?${query}` : '';
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
 *
 * Keyed on `init.balance`/`init.currency.code` too (see the module doc's
 * "why the key also carries balance/currency"): a new seed from the toolbar
 * starts a fresh wallet under a fresh key; the same toolbar (same seed on
 * reload) keeps finding the old one. `wallet` — the address's `?wallet=<n>`
 * — is a further, separate segment (see the module doc's "why the key's
 * last segment is the Preview's wallet number"): `null` when the address
 * carries none, which reproduces today's key unchanged.
 */
function walletStore(gameId: string | undefined, init: SessionInit, wallet: string | null) {
  try {
    if (!gameId || typeof sessionStorage === 'undefined') return undefined;
    const key = `e8:wallet:${gameId}:${init.balance}:${init.currency.code}${wallet === null ? '' : `:${wallet}`}`;
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
  const search = config.search ?? (globalThis as { location?: { search?: string } }).location?.search ?? '';
  try {
    const res = await fetchFn(`/api/session${sessionQuery(search)}`);
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
  const store = walletStore(gameId, init, new URLSearchParams(search).get('wallet'));
  let balance = store?.read() ?? init.balance;

  async function play(req: PlayRequest): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }> {
    // A step of an OPEN round (a `roundId` carried forward from the result
    // that started it) costs nothing — the bet was already charged when the
    // round started. Only a fresh round (`roundId` absent) debits.
    //
    // Charged in memory now, STORED only once the host has answered (ok or
    // not — a 502 is an answer; a thrown fetch is not). The in-memory
    // charge stands for the tab's life either way (slice 26: every play
    // is charged, a failed one too), but a store written before the fetch
    // drained the persisted balance one bet per reload against a dead
    // server — reload, charge, nothing answers, reload, charge again.
    if (req.roundId === undefined) balance -= (req.betLevel ?? 0) * (init.actions?.[req.action] ?? 1);

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
        store?.write(balance);
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

  // `init.balance` is what the player can spend right now — the stored
  // wallet after a reload, not the seed. A copy: `init` may be the shared
  // `FALLBACK_INIT`, and the wallet's key above stays the fetched seed.
  ctx.provide('session', { init: { ...init, balance }, play });

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
