/**
 * The `session` seam's contract — what a page's shell needs to show a
 * balance and a bet ladder, and how it plays a round. Designed, not
 * measured: see `docs/superpowers/specs/2026-09-20-shell-session-build-design.md`
 * §3 for the two rows that will provide it (`session-host`, over the IDE's
 * own `/api/spin`; `session-sdk`, over `@energy8platform/game-sdk`) and the
 * per-field normalisation each one does to land here. Nothing in this file
 * decides which provider wins a given game — that is
 * `@energy8engine/seam`'s `selectProvider`, over the same `E8SeamDeclaration`
 * mechanism `renderer` already uses.
 *
 * `SpinResult` (`spin.ts`) speaks in bet multipliers, because that is what
 * e8-server's wire actually sends. A shell shows money. `withAmounts` below
 * is the one place that gap gets closed, so both providers convert the same
 * way instead of each reimplementing `× bet`.
 */
import type { Diagnostic } from './diagnostic';
import type { SpinResult } from './spin';

/**
 * What a `session` provider resolves before the row providing it applies —
 * a shell reading `ctx.session.init` at its own `apply` time always finds a
 * settled value, never a promise or a partial one filled in later.
 */
export interface SessionInit {
  /** Currency units — what the player can spend right now, not a multiplier. */
  balance: number;
  /**
   * A provider that only has a currency code (no symbol/decimals of its
   * own) falls back to `symbol = code`, `decimals = 2` — see
   * `session-sdk`'s doc in the design spec for the one place that fallback
   * is actually spelled out; this type only declares that all four travel
   * together.
   */
  currency: { code: string; symbol: string; decimals: number; position: 'left' | 'right' };
  /** Currency units, ascending — the ladder the shell's bet stepper walks. */
  betLevels: number[];
  /** One entry of `betLevels`. Not validated here — a provider that gets this wrong hands the shell a bet it cannot select. */
  defaultBet: number;
  /** Absent when the provider has no opinion; the shell keeps its own default. */
  language?: string;
  device?: 'desktop' | 'mobile';
  /** Social-casino wording in the shell (`isSocial`). Absent when the provider has no opinion. */
  social?: boolean;
  /**
   * The bet multiplier per action name (`{ spin: 1, tournament: 100 }`) —
   * what a dev wallet charges on an opening play. Absent when the provider
   * has no opinion (`session-sdk`: the platform charges server-side); a
   * missing action reads as `1`.
   */
  actions?: Record<string, number>;
}

/**
 * One play. The flow's `spin`/`step` kinds build this from the shell's live
 * state (e.g. `betLevel: $shell.bet`) and hand it to `SessionService.play`
 * unchanged — the same request shape both providers accept, so a flow
 * authored against one plays unmodified against the other.
 */
export interface PlayRequest {
  action: string;
  /** Currency units. Absent lets a provider fall back to the session's current bet. */
  betLevel?: number;
  /**
   * An OPEN round to step rather than a new one to start — same idea as
   * `SpinRequest.roundId` in `spin.ts`, under a provider-agnostic name.
   * Pass back a result's `roundId` while its `roundComplete` was `false`.
   */
  roundId?: string;
  params?: Record<string, unknown>;
}

/**
 * The seam `session` resolves to. A page composed with none —
 * `createGame({ without: ['session', 'ui.shell'] })`, e.g. a composition
 * editor; the shell goes with it, since `shell1` injects `session` and
 * would otherwise stay pending and fail the page — has no `ctx.session` at
 * all; the flow's `spin`/`step`/`ack` kinds read it leniently and report
 * rather than throw.
 */
export interface SessionService {
  /** Resolved before this service is provided — see this type's own doc above. */
  readonly init: SessionInit;
  /**
   * Runs one play. `result` is absent exactly when `diagnostics` says why —
   * a response carrying both a result and a failure would leave a caller
   * guessing which one to trust.
   */
  play(req: PlayRequest): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }>;
  /**
   * "The result was shown" — a backend's credit hook (`session-sdk`'s
   * `playAck`). Optional: a provider whose backend already credited by the
   * time `play` resolved (`session-host`'s dev wallet) has nothing to do
   * here, and the flow's `ack` kind calls it only through `?.`.
   */
  ack?(result: SpinResult): void;
}

/** `x` rounded to 8 decimal places — a bet multiplier times a currency amount is float arithmetic, and an unrounded product would put `0.30000000000000004` in front of a player. */
function round8(x: number): number {
  return Math.round(x * 1e8) / 1e8;
}

/**
 * Fills `winAmount`/`totalWinAmount` on a result either `session` provider
 * hands back — `win × bet` and `totalWin × bet`, in currency units. The one
 * conversion both providers share, rather than each reimplementing it (and
 * each rounding it, or not, its own way).
 */
export function withAmounts<T extends SpinResult>(r: T): T {
  return {
    ...r,
    winAmount: round8(r.win * r.bet),
    totalWinAmount: round8(r.totalWin * r.bet),
  };
}
