/**
 * dev-RGS handler — transport-agnostic, books-backed answers to the exact
 * Stake RGS HTTP contract the game's `RGSClient` calls.
 *
 * Pure functions over the curated e8-math books (via ./books). NO vite, NO
 * pixi, NO HTTP — Task 3 mounts these methods as a vite middleware. Holds
 * in-memory session state (balance + the active round).
 *
 * ── Units (slice-8 convention) ───────────────────────────────────────────
 *   • book.payoutMultiplier AND LUT payoutCents are the SAME integer =
 *     bet-multiplier × 100  (e.g. a 2.5× win = 250).
 *   • round.payoutMultiplier (the ×bet multiplier) = payoutCents / 100.
 *   • RGSPlayParams.amount / RGSBalance.amount are MINOR units
 *     (major × API_MULTIPLIER).
 *   • play debits the TOTAL stake = `amount * costMultiplier` (minor). For BASE cost=1 so this is
 *     just `amount`; buy/ante modes cost a multiple of the base bet. end-round credits the win
 *     relative to the BASE bet (NOT × cost):
 *       winMinor = (payoutCents / 100) * betMajor * API_MULTIPLIER
 *                = (payoutCents / 100) * amountMinor
 *   • round.amount = the bet in MINOR units (Stake style — same integer the client sent),
 *     i.e. the `amount` from RGSPlayParams, NOT divided back to major.
 */

import { join } from 'node:path';

import {
  API_MULTIPLIER,
  type RGSAuthenticateResponse,
  type RGSBalance,
  type RGSEndRoundResponse,
  type RGSEventResponse,
  type RGSPlayParams,
  type RGSPlayResponse,
  type RGSReplayResponse,
  type StakeRound,
} from '@energy8platform/stake-bridge';

import { hasBooks, loadIndex, pickWeighted, readBook, type BookMode } from './books';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `play` / `replay` when no curated books exist for the requested
 * mode. Task 3 catches this to fall back to a live e8 round. Distinct, catchable.
 */
export class NoBooksError extends Error {
  public readonly mode: string;
  constructor(mode: string) {
    super(`dev-rgs: no books for mode "${mode}"`);
    this.name = 'NoBooksError';
    this.mode = mode;
    Object.setPrototypeOf(this, NoBooksError.prototype);
  }
}

/**
 * Thrown by `play` / `playWithOutcome` when the stake (bet × cost) exceeds the current balance.
 * The HTTP layer maps it to a 402 with code `ERR_INSUFFICIENT_BALANCE`; the bridge surfaces it as
 * a PLAY_ERROR. The balance is never debited into the negative.
 */
export class InsufficientBalanceError extends Error {
  constructor(stakeMinor: number, balanceMinor: number) {
    super(
      `dev-rgs: insufficient balance — stake ${stakeMinor} exceeds balance ${balanceMinor}`,
    );
    this.name = 'InsufficientBalanceError';
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Config + public interface
// ---------------------------------------------------------------------------

export interface DevRgsConfig {
  /** Resolved books directory (e.g. the game's `stake-math/`). */
  booksDir: string;
  /** Game identifier surfaced as `config.gameID`. */
  gameId: string;
  /** Bet levels in MAJOR units (e.g. [0.1, 0.2, 1, 2, 5]). */
  betLevelsMajor: number[];
  /** Launch currency (ISO 4217). Defaults to 'EUR'. */
  currency?: string;
  /** Starting balance in MAJOR units. Default 10_000. */
  startingBalanceMajor?: number;
  /** Injectable RNG for the weighted book pick. Defaults to Math.random. */
  rng?: () => number;
}

export interface DevRgs {
  authenticate(): Promise<RGSAuthenticateResponse>;
  balance(): Promise<{ balance: RGSBalance }>;
  play(p: RGSPlayParams): Promise<RGSPlayResponse>;
  /**
   * Like play(), but the outcome (payoutCents + book state) is supplied by
   * the caller (used by the harness Lua fallback) instead of being picked
   * from the books. Applies the same open-round guard, debits amount from the
   * internal balance, sets activeRound + activePayoutCents exactly as play()
   * does, and returns the same RGSPlayResponse shape. endRound() then credits
   * through the SAME balance — no second counter.
   */
  playWithOutcome(
    mode: string,
    amount: number,
    outcome: { payoutCents: number; state: unknown; cost?: number },
  ): Promise<RGSPlayResponse>;
  endRound(): Promise<RGSEndRoundResponse>;
  event(value: string): Promise<RGSEventResponse>;
  replay(p: { mode: string; event: string }): Promise<RGSReplayResponse>;
  /**
   * true iff curated books exist for the mode. Drives the harness
   * 'replay available' state and the Lua-fallback decision in Task 3.
   */
  hasBooksFor(mode: string): boolean;
  /**
   * Override the in-memory balance (minor units) and clear any active round.
   * Used by the harness control bar to let the developer set a custom balance.
   */
  setBalance(balanceMinor: number): void;
  /**
   * Override the currency returned by authenticate/balance.
   * Used by the harness control bar currency selector so the game receives
   * the chosen currency on the next authenticate call.
   */
  setCurrency(code: string): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A book parsed from a JSONL line — must carry top-level id + payoutMultiplier. */
interface ParsedBook {
  id: number;
  payoutMultiplier: number;
  [key: string]: unknown;
}

function lutPathFor(booksDir: string, mode: string): string {
  return join(booksDir, `lookUpTable_${mode}_0.csv`);
}

function eventsPathFor(booksDir: string, mode: string): string {
  return join(booksDir, `books_${mode}.jsonl.zst`);
}

/** Cost multiplier for a mode, read from index.json (default 1). */
function costOf(modes: BookMode[] | null, mode: string): number {
  const found = modes?.find((m) => m.name === mode);
  return found ? found.cost : 1;
}

/**
 * Wrap a parsed book as the round `state` the adapter splits into segments.
 *
 * A curated book carries `events[]` (trigger + every free spin of one round) — pass them through
 * verbatim so each event becomes a segment. Legacy/empty books fall back to a single synthetic
 * event carrying the LUT payout as `data.total_win` (preserves the old one-segment behaviour).
 */
function stateFromBook(book: ParsedBook, payoutCents: number): { events: unknown[] } {
  const events = (book as { events?: unknown }).events;
  if (Array.isArray(events) && events.length > 0) return { events };
  // Legacy/empty book → one synthetic canonical event ({ type, spin }, win in spin.total_win).
  return { events: [{ type: 'spin', spin: { total_win: payoutCents / 100 } }] };
}

/**
 * Wrap a caller-supplied outcome (Lua fallback) as the round `state`.
 *
 * Accepts either a multi-event round (`{ events: [...] }` — trigger + all free spins) passed
 * through verbatim, or a single spin's data object wrapped in a one-event book (injecting
 * `total_win` when the data omits it).
 */
function stateFromOutcome(state: unknown, payoutCents: number): { events: unknown[] } {
  if (state !== null && typeof state === 'object' && !Array.isArray(state)) {
    const events = (state as { events?: unknown }).events;
    if (Array.isArray(events) && events.length > 0) return { events };
  }
  const spin: Record<string, unknown> =
    state !== null && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};
  if (typeof spin.total_win !== 'number') spin.total_win = payoutCents / 100;
  return { events: [{ type: 'spin', spin }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDevRgs(ctx: DevRgsConfig): DevRgs {
  const {
    booksDir,
    gameId,
    betLevelsMajor,
    startingBalanceMajor = 10_000,
    rng = Math.random,
  } = ctx;

  // ── In-memory session state ──────────────────────────────────────────
  let currency = ctx.currency ?? 'EUR';
  let balanceMinor = startingBalanceMajor * API_MULTIPLIER;
  let nextBetId = 1;
  // The active round, plus the payoutCents we need to credit on end-round.
  let activeRound: StakeRound<ParsedBook> | null = null;
  let activePayoutCents = 0;

  const modes = loadIndex(booksDir);

  // betLevels in minor units, sorted ascending for min/max/step derivation.
  const betLevels = betLevelsMajor.map((m) => m * API_MULTIPLIER);
  const sorted = [...betLevels].sort((a, b) => a - b);
  const minBet = sorted[0] ?? 0;
  const maxBet = sorted[sorted.length - 1] ?? 0;
  // stepBet: smallest gap between consecutive levels, else the min level.
  let stepBet = minBet;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && gap < stepBet) stepBet = gap;
  }

  const balanceObj = (): RGSBalance => ({ amount: balanceMinor, currency });

  function hasBooksFor(mode: string): boolean {
    return hasBooks(booksDir, mode);
  }

  async function loadBook(mode: string, id: number): Promise<ParsedBook> {
    const line = await readBook(eventsPathFor(booksDir, mode), id);
    if (line === null) {
      throw new Error(`dev-rgs: book id ${id} not found for mode "${mode}"`);
    }
    return JSON.parse(line) as ParsedBook;
  }

  return {
    async authenticate(): Promise<RGSAuthenticateResponse> {
      const betModes: Record<string, unknown> = {};
      for (const m of modes ?? []) {
        betModes[m.name] = { cost: m.cost };
      }
      // Surface a lingering (un-settled) round so a page reload can resume or finish it instead of
      // silently dropping it. We retain only winning rounds (active:true). round.amount is already
      // in MINOR units (Stake style), matching what the bridge's resume path expects.
      return {
        balance: balanceObj(),
        round: activeRound,
        config: {
          gameID: gameId,
          minBet,
          maxBet,
          stepBet,
          defaultBetLevel: minBet,
          betLevels,
          betModes,
        },
      };
    },

    async balance(): Promise<{ balance: RGSBalance }> {
      return { balance: balanceObj() };
    },

    async play(p: RGSPlayParams): Promise<RGSPlayResponse> {
      if (activeRound !== null) {
        throw new Error(
          'dev-RGS: play called while a round is still active — call end-round first',
        );
      }
      const { mode, amount } = p;
      if (!hasBooksFor(mode)) throw new NoBooksError(mode);

      const { sim, payoutCents } = await pickWeighted(lutPathFor(booksDir, mode), rng);
      const book = await loadBook(mode, sim);

      // Debit the TOTAL stake = bet × cost (minor units). Buy/ante modes cost a multiple of the
      // base bet (cost from index.json); the win is still payout × base bet (credited at end-round).
      // Reject (never go negative) when the stake exceeds the balance.
      const cost = costOf(modes, mode);
      const stake = amount * cost;
      if (stake > balanceMinor) throw new InsufficientBalanceError(stake, balanceMinor);
      balanceMinor -= stake;

      // A curated book carries the round's full `events` array — the trigger + every free spin of a
      // bonus, collected into ONE round (e8-math curate). Pass them through so the adapter splits
      // the round into one segment per event and the bridge streams them (segment-drain). Each event
      // carries its own per-spin win in `data.total_win` (injected by curate). Legacy books with no
      // events fall back to a single synthetic event from the LUT payout.
      const wrappedState = stateFromBook(book, payoutCents);

      // A 0-win round is self-closing: the RGS settles it on play(), so no
      // end-round is expected. Mark it `active: false` and DON'T retain it as
      // the internal active round — otherwise the next play would trip the
      // open-round guard (the bridge skips end-round for 0-win rounds). This
      // keeps bridge + dev-RGS consistent: end-round happens iff payout > 0.
      const active = payoutCents > 0;

      const round: StakeRound<ParsedBook> = {
        betID: nextBetId++,
        payoutMultiplier: payoutCents / 100,
        costMultiplier: cost,
        active,
        mode,
        state: wrappedState as unknown as ParsedBook,
        amount, // bet in MINOR units (Stake style — the integer the client sent)
      };

      if (active) {
        activeRound = round;
        activePayoutCents = payoutCents;
      }

      return { balance: balanceObj(), round };
    },

    async playWithOutcome(
      mode: string,
      amount: number,
      outcome: { payoutCents: number; state: unknown; cost?: number },
    ): Promise<RGSPlayResponse> {
      if (activeRound !== null) {
        throw new Error(
          'dev-RGS: play called while a round is still active — call end-round first',
        );
      }

      // Debit the TOTAL stake = bet × cost (minor units). With no books there is no index.json cost,
      // so the caller (harness Lua fallback) supplies the action's cost from the spec; default 1.
      // Reject (never go negative) when the stake exceeds the balance.
      const cost = outcome.cost ?? costOf(modes, mode);
      const stake = amount * cost;
      if (stake > balanceMinor) throw new InsufficientBalanceError(stake, balanceMinor);
      balanceMinor -= stake;

      // The caller (harness Lua fallback) may supply a multi-event round — `{ events: [...] }` with
      // the trigger + every free spin of one bonus — so the adapter splits it into segments and the
      // bridge streams them (segment-drain). Otherwise treat `outcome.state` as a single spin's data
      // and wrap it in a one-event book, injecting `total_win` when absent.
      const wrappedState = stateFromOutcome(outcome.state, outcome.payoutCents);

      // A 0-win round is self-closing (no end-round expected); don't retain it
      // as the active round. See play() for the rationale.
      const active = outcome.payoutCents > 0;

      const round: StakeRound<unknown> = {
        betID: nextBetId++,
        payoutMultiplier: outcome.payoutCents / 100,
        costMultiplier: cost,
        active,
        mode,
        state: wrappedState,
        amount, // bet in MINOR units (Stake style — the integer the client sent)
      };

      if (active) {
        activeRound = round as StakeRound<ParsedBook>;
        activePayoutCents = outcome.payoutCents;
      }

      return { balance: balanceObj(), round: round as StakeRound<ParsedBook> };
    },

    async endRound(): Promise<RGSEndRoundResponse> {
      if (activeRound) {
        const betMinor = activeRound.amount ?? 0; // already MINOR
        // winMinor = (payoutCents / 100) * betMinor — exact, integer payoutCents.
        const winMinor = (activePayoutCents / 100) * betMinor;
        balanceMinor += winMinor;
        activeRound.active = false;
        activeRound = null;
        activePayoutCents = 0;
      }
      return { balance: balanceObj() };
    },

    async event(value: string): Promise<RGSEventResponse> {
      if (activeRound) activeRound.event = value;
      return { event: value };
    },

    async replay(p: { mode: string; event: string }): Promise<RGSReplayResponse> {
      const { mode, event } = p;
      if (!hasBooksFor(mode)) throw new NoBooksError(mode);

      const id = Number(event);
      const book = await loadBook(mode, id);
      // Mirror Stake's /bet/replay shape exactly:
      //   { payoutMultiplier: <×bet multiplier>, costMultiplier: <×>, state: [ ...events... ] }
      // - payoutMultiplier is the ×bet MULTIPLIER (e.g. 4.95 for a 4.95× round), the SAME scale
      //   /wallet/play returns for round.payoutMultiplier — the bridge surfaces it verbatim. The
      //   book stores the payout in CENTS (payoutCents = ×bet × 100), so divide by 100 here.
      // - state is the EVENTS ARRAY directly (not wrapped in `{ events }`); the adapter's ensureBook
      //   accepts a bare array. A curated book carries the round's full events (trigger + free
      //   spins) so a bonus replays segment-by-segment; legacy books fall back to one synthetic
      //   event carrying the round payout.
      const bookEvents = (book as { events?: unknown }).events;
      const state =
        Array.isArray(bookEvents) && bookEvents.length > 0
          ? (bookEvents as unknown[])
          : [{ type: 'spin', spin: { total_win: book.payoutMultiplier / 100 } }];
      return {
        payoutMultiplier: book.payoutMultiplier / 100,
        costMultiplier: costOf(modes, mode),
        state,
      };
    },

    hasBooksFor,

    setBalance(newBalanceMinor: number): void {
      balanceMinor = newBalanceMinor;
      // Clear any active round so the session starts fresh with the new balance.
      activeRound = null;
      activePayoutCents = 0;
    },

    setCurrency(code: string): void {
      currency = code;
    },
  };
}
