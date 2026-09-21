/**
 * Runtime half of `session-sdk` — the `sessionsdk1` row in `e8-base`, the
 * Energy8 platform's candidate behind the `session` seam (spec §3). Its
 * matcher is `{ buildTarget: 'platform' }`: a game built for the platform
 * composes this row and drops `sessionhost1`; every other build keeps the
 * dev host's row (`{ default: true }`) and never imports this one —
 * `@energy8engine/seam` picks one per composition, `createGame` drops the
 * rest before any import.
 *
 * What it is: `createPlatformSession` from `@energy8platform/platform-core`
 * (the `@energy8platform/game-sdk` handshake with the casino shell that
 * frames the game, or an in-process `DevBridge` when `config.dev` is set)
 * turned into the seam-shaped `SessionService` the flow's `spin`/`step`/
 * `ack` kinds already read leniently — so a flow authored against
 * `session-host` plays unmodified against the real platform.
 *
 * Unlike `session-host`, there is no wallet in this row: the platform has
 * one. `balance` on every result is the platform's `balanceAfter`, the
 * live `$session.balance` root follows the SDK's `balanceUpdate` events
 * (the platform pushes one after every play, and on its own whenever the
 * wallet moves), and `init.balance` stays the handshake value. `ack` is
 * the platform's credit hook: `playAck(raw)` with the very
 * `PlayResultData` the SDK handed back — one `last` stash, replaced by
 * the next play, handed over once the flow says the result was shown.
 *
 * **Why `play()` RETURNS diagnostics instead of reporting them** — the same
 * reason `session-host` gives: `playThrough` in `@energy8engine/flow`'s
 * `kinds.ts` re-reports whatever comes back onto the node that made the
 * call; reporting here too would show every failed spin twice. The one
 * diagnostic this row DOES report is a handshake that never landed —
 * nothing has run yet, there is no node to attach it to. The page still
 * boots on the built-in init and every `play` answers with that same
 * diagnostic, so the reason stays visible instead of a blank shell.
 *
 * Known edges, none of them this row's to fix:
 * - The suite and the typecheck resolve `@energy8platform/platform-core`
 *   and `@energy8platform/game-sdk` through their built `dist/` (their
 *   `exports` maps point there) — build both before running either.
 * - A `ready()` that fails inside `createPlatformSession` (a timeout, a
 *   host that never answers) leaves the SDK's transport listeners
 *   subscribed: the `PlatformSession` that would own them is never
 *   constructed, so there is nothing here to `destroy()`. That leak is
 *   inside platform-core, out of reach.
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
import {
  createPlatformSession,
  type DevBridgeConfig,
  type PlatformSession,
  type SDKOptions,
} from '@energy8platform/platform-core';
import type { InitData, PlayResultData } from '@energy8platform/game-sdk';
import { normalise } from './normalise';

declare module 'cordis' {
  interface Context {
    session: SessionService;
  }
}

export interface SessionSdkConfig {
  /** The casino shell's origin — `sdk.parentOrigin` when `sdk` is not given. */
  parentOrigin?: string;
  /**
   * How long the handshake (and every other SDK request) waits for the
   * casino shell before the row boots on the fallback init — the SDK's
   * `timeout`, default 15000. A page opened outside a casino frame falls
   * back sooner when this is set lower; `sdk.timeout` wins when given.
   */
  handshakeMs?: number;
  /** An in-process `DevBridge` as the platform (tests, offline runs) — see `DevBridgeConfig`. */
  dev?: DevBridgeConfig;
  /** SDK options verbatim; `false` skips the handshake (the row then boots on the fallback init). */
  sdk?: SDKOptions | false;
}

/**
 * What a game plays with when the handshake never landed — the same values
 * `session-host` falls back to when its host is down: a ladder of one so
 * the shell's stepper has a rung, a balance honest about a wallet nothing
 * funded.
 */
const FALLBACK_INIT: SessionInit = {
  balance: 0,
  currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  betLevels: [1],
  defaultBet: 1,
};

/** Spec §3: `init` from `initData`. `report` takes the one warning this can raise. */
function initFrom(initData: InitData, report: (d: Diagnostic) => void): SessionInit {
  const { config } = initData;
  // Artube's block, untyped on `GameConfigData` like `stake` below — read
  // leniently. `currencyMinimalUnit` is the currency's rounding STEP
  // (`0.01`, not `2`; see `packages/artube-bridge`'s `bridge.ts`), turned
  // into the decimals the shell formats with; `defaultBetIndex` is an
  // index into the ladder.
  const artube = config.artube as
    { currencyMinimalUnit?: unknown; defaultBetIndex?: unknown } | undefined;
  const unit = artube?.currencyMinimalUnit;
  const unitDecimals =
    typeof unit === 'number' && unit > 0 && unit <= 1
      ? Math.ceil(-Math.log10(unit) - 1e-9)
      : undefined;
  const meta = config.currency;
  const currency: SessionInit['currency'] = meta?.symbol
    ? {
        code: meta.code,
        symbol: meta.symbol,
        decimals: unitDecimals ?? meta.decimals ?? 2,
        position: meta.symbolAfter ? 'right' : 'left',
      }
    : {
        code: initData.currency,
        symbol: initData.currency,
        decimals: unitDecimals ?? 2,
        position: 'left',
      };

  let betLevels = config.betLevels;
  if (
    !Array.isArray(betLevels) ||
    betLevels.length === 0 ||
    !betLevels.every((b) => typeof b === 'number')
  ) {
    report(
      diagnostic(
        'warning',
        'session-sdk',
        'init',
        'the platform sent no bet levels',
        'the shell plays on a ladder of [1] until the host sends config.betLevels',
      ),
    );
    betLevels = [1];
  }

  // `config.stake` is the Stake bridge's block, untyped on `GameConfigData`
  // (its index signature) — read leniently, then snapped to the ladder:
  // `defaultBet` must be a rung the shell's stepper can select.
  const stake = config.stake as { defaultBetLevel?: unknown } | undefined;
  const index = artube?.defaultBetIndex;
  const wanted =
    typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < betLevels.length
      ? betLevels[index]
      : typeof stake?.defaultBetLevel === 'number'
        ? stake.defaultBetLevel
        : betLevels[0];
  const defaultBet = betLevels.reduce((a, b) =>
    Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a,
  );

  return {
    balance: initData.balance,
    currency,
    betLevels,
    defaultBet,
    language: initData.lang,
    device: initData.device,
  };
}

export const name = 'session';
export const inject = [];

export async function apply(ctx: Context, config: SessionSdkConfig = {}): Promise<void> {
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);

  let session: PlatformSession | undefined;
  let init: SessionInit;
  let failure: Diagnostic | undefined;
  try {
    session = await createPlatformSession({
      dev: config.dev,
      sdk:
        config.sdk === false
          ? false
          : {
              parentOrigin: config.parentOrigin,
              timeout: config.handshakeMs ?? 15000,
              ...config.sdk,
            },
    });
    if (!session.initData) throw new Error('no SDK handshake ran (sdk: false)');
    init = initFrom(session.initData, report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failure = diagnostic(
      'error',
      'session-sdk',
      'handshake',
      `the platform handshake failed: ${message}`,
      'the game boots on a built-in init; every play answers with this diagnostic',
    );
    report(failure);
    init = FALLBACK_INIT;
  }

  // The platform's wallet, as last announced: `balanceUpdate` follows every
  // play (the SDK emits it on each PLAY_RESULT) and every push from the
  // host. Read fresh by the live root's getter; `init.balance` is left as
  // the handshake value.
  const live = { balance: init.balance };
  session?.on('balanceUpdate', ({ balance }) => {
    live.balance = balance;
  });

  // The last raw platform result, for `ack` — `playAck` wants the SDK's own
  // `PlayResultData`, not the seam's `SpinResult`. ONE stash, not a map
  // keyed by round: plays are sequential and a flow that never acks would
  // otherwise grow the map for the life of the page (the same single stash
  // `createSlotPlay` keeps in `packages/game-engine/src/host/slotPlay.ts`).
  let last: PlayResultData | undefined;

  // The bet each OPEN round was started with. A `step` carries no bet of
  // its own (`PlayRequest.betLevel` absent — a gRPC `Step` has no bet field
  // either), but `PlayParams.bet` is mandatory on the platform wire and is
  // the divisor `normalise` turns money back into multipliers with, so the
  // round's own bet has to come from somewhere: set when a result leaves a
  // round open, dropped when one completes it.
  const roundBet = new Map<string, number>();
  // A round this row did not start — the open round a reload came back to,
  // which the handshake reports as `initData.session` with its `betAmount`.
  // Its round ID only comes with `getState()`, which nothing here calls
  // yet, so the bet is kept unkeyed: a step of a round `roundBet` has
  // never seen plays at it. Draining that round at boot is out of scope.
  const resumedBet = session?.initData?.session?.betAmount;

  async function play(
    req: PlayRequest,
  ): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }> {
    if (failure) return { diagnostics: [failure] };
    const stepBet =
      req.roundId === undefined ? undefined : (roundBet.get(req.roundId) ?? resumedBet);
    const bet = req.betLevel ?? stepBet ?? init.defaultBet;
    try {
      // `session` is set whenever `failure` is not — see the try above.
      const raw = await session!.play({
        action: req.action,
        bet,
        roundId: req.roundId,
        params: req.params,
      });
      last = raw;
      const result = withAmounts(normalise(raw, bet));
      if (result.roundComplete) roundBet.delete(result.roundId);
      else roundBet.set(result.roundId, result.bet);
      return { result, diagnostics: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An `SDKError` names its cause in `code` (`INSUFFICIENT_FUNDS`,
      // `TIMEOUT`, `BRIDGE_DESTROYED`); the message alone loses it.
      const code = (error as { code?: unknown } | null)?.code;
      return {
        diagnostics: [
          diagnostic(
            'error',
            'session-sdk',
            'play',
            typeof code === 'string' ? `${code}: ${message}` : message,
          ),
        ],
      };
    }
  }

  function ack(result: SpinResult): void {
    if (!last || last.roundId !== result.roundId) return;
    session?.playAck(last);
    last = undefined;
  }

  ctx.provide('session', { init, play, ack });

  ctx.effect(() => () => session?.destroy(), 'session-sdk:destroy');

  // The live root (`@energy8engine/flow`'s `provideRoot`) — `$session.…` in
  // any node of any run. `ctx.inject`, not a lenient read at apply time:
  // this row composes before `flow1` in `e8-base`, so at its own apply
  // time there is nothing to register with yet (same as `session-host`).
  ctx.inject(['flow'], (c) => {
    c.effect(
      () => c.get('flow').provideRoot('session', () => ({ ...init, balance: live.balance })),
      'session-sdk:root',
    );
  });
}
