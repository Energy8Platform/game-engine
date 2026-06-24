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
 *   • play debits `amount` (minor). end-round credits the win:
 *       winMinor = (payoutCents / 100) * betMajor * API_MULTIPLIER
 *                = (payoutCents / 100) * amountMinor
 *   • round.amount = the bet in MAJOR units = amountMinor / API_MULTIPLIER.
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
 * mode. Task 3 catches this to fall back to LuaEngine. Distinct, catchable.
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
    outcome: { payoutCents: number; state: unknown },
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
      // silently dropping it. We retain only winning rounds (active:true). The bridge's resume path
      // reads round.amount as MINOR units (see StakeRound.amount), while we store it MAJOR internally
      // (matching play()'s return) — convert at this boundary so the resumed bet shows correctly.
      const round: StakeRound<ParsedBook> | null = activeRound
        ? { ...activeRound, amount: (activeRound.amount ?? 0) * API_MULTIPLIER }
        : null;
      return {
        balance: balanceObj(),
        round,
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

      // Debit the bet (minor units).
      balanceMinor -= amount;

      // Wrap the book as a one-event book so the adapter can split into segments.
      // The adapter reads `event.data ?? event.spin` — use `data` to carry the
      // minimal spin payload (total_win is the only field we have at this level).
      const spinData = { total_win: payoutCents / 100 };
      const wrappedState = { events: [{ data: spinData }] };

      // A 0-win round is self-closing: the RGS settles it on play(), so no
      // end-round is expected. Mark it `active: false` and DON'T retain it as
      // the internal active round — otherwise the next play would trip the
      // open-round guard (the bridge skips end-round for 0-win rounds). This
      // keeps bridge + dev-RGS consistent: end-round happens iff payout > 0.
      const active = payoutCents > 0;

      const round: StakeRound<ParsedBook> = {
        betID: nextBetId++,
        payoutMultiplier: payoutCents / 100,
        costMultiplier: costOf(modes, mode),
        active,
        mode,
        state: wrappedState as unknown as ParsedBook,
        amount: amount / API_MULTIPLIER, // bet in MAJOR units
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
      outcome: { payoutCents: number; state: unknown },
    ): Promise<RGSPlayResponse> {
      if (activeRound !== null) {
        throw new Error(
          'dev-RGS: play called while a round is still active — call end-round first',
        );
      }

      // Debit the bet (minor units).
      balanceMinor -= amount;

      // Wrap outcome.state in a one-event book so the adapter can split into segments.
      // Inject total_win if the caller's state doesn't carry it.
      const outcomeData = outcome.state as Record<string, unknown>;
      const wrappedOutcomeData: Record<string, unknown> =
        outcomeData !== null && typeof outcomeData === 'object' && !Array.isArray(outcomeData)
          ? outcomeData
          : {};
      if (typeof wrappedOutcomeData.total_win !== 'number') {
        wrappedOutcomeData.total_win = outcome.payoutCents / 100;
      }
      const wrappedState = { events: [{ data: wrappedOutcomeData }] };

      // A 0-win round is self-closing (no end-round expected); don't retain it
      // as the active round. See play() for the rationale.
      const active = outcome.payoutCents > 0;

      const round: StakeRound<unknown> = {
        betID: nextBetId++,
        payoutMultiplier: outcome.payoutCents / 100,
        costMultiplier: costOf(modes, mode),
        active,
        mode,
        state: wrappedState,
        amount: amount / API_MULTIPLIER, // bet in MAJOR units
      };

      if (active) {
        activeRound = round as StakeRound<ParsedBook>;
        activePayoutCents = outcome.payoutCents;
      }

      return { balance: balanceObj(), round: round as StakeRound<ParsedBook> };
    },

    async endRound(): Promise<RGSEndRoundResponse> {
      if (activeRound) {
        const betMinor = (activeRound.amount ?? 0) * API_MULTIPLIER;
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
      // Wrap as a one-event book so the adapter can split into segments.
      const replayState = { events: [{ data: { total_win: book.payoutMultiplier / 100 } }] };
      return {
        state: replayState,
        payoutMultiplier: book.payoutMultiplier / 100,
        mode,
        amount: minBet, // a sensible default bet in minor units
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
