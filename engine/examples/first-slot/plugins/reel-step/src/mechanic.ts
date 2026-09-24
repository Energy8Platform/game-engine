/**
 * `reel-step`: the mechanic half. Pure — one spin's stage data in, a list of
 * presentation steps out. No cordis, no pixi, nothing to boot; that is why
 * this is a module of its own rather than part of `./index.ts`, and why its
 * tests run in plain node against the fixture in the brief.
 *
 * **The step this brings, and why it could not be a built-in.** The four
 * built-in kinds (`@energy8engine/contracts`' `presentation.ts`) describe a
 * board that lands, reveals, removes and refills. A
 * ReelStep round does none of those: it pays the cells that won and then
 * scrolls EACH REEL DOWN by its own count of them — nothing is removed,
 * gravity never runs, the surviving symbols ride down, that many fresh ones
 * enter at the top, and the bottom ones ride off. `remove` + `refill` cannot
 * express it: they are two steps over a whole board with no per-reel
 * distance between them, and the distances are the step. So `reel-step`
 * brings its own kind, `reelStep`. The code that runs it is the engine's
 * `cascade1` row (`@energy8engine/reels-cascade`'s `reelStep` handler); the
 * mechanic that emits it is not in the engine — it is this file.
 *
 * The shape it reads is `first-slot`'s `base_game.reel_steps` — see that
 * game's `.spin` header and `@energy8engine/session-dev`'s `types.ts` for
 * how those rounds relate to the spin's credited `win`. The short version,
 * and the reason nothing here adds anything up: **the sum of these rounds is
 * not what the player is paid.** `win`/`totalWin` on the spin result is, and
 * reporting it is the play loop's job, not a presentation's — the same
 * division `RevealWinsStep.total` already documents.
 */
import type {
  Board,
  BoardCell,
  Cell,
  KnownPresentationStep,
  SpinMechanic,
  SpinShapeRequirement,
} from '@energy8engine/contracts';

/**
 * One round as the math hands it over. `win` is optional because a caller
 * can legitimately have no per-round figure — the brief's own fixture
 * carries none — and a reveal with nothing to read out is not an error,
 * only a reveal of zero.
 */
export interface ReelStepRound {
  /** Cells that won on the board this round ran against. */
  winning: Cell[];
  /** How far each reel then scrolls down; one entry per column, `0` = stays put. */
  shifts: number[];
  /** The board after every reel has scrolled by its own `shifts[col]`. */
  settled: Board;
  /** What this round paid, if the math says. Never the credited total. */
  win?: number;
}

/** The stage data `reel-step` reads. Everything else on the stage is another mechanic's. */
export interface ReelStepStageData {
  /** The board the reels land on, before any round runs. */
  grid: Board;
  reel_steps: ReelStepRound[];
}

/**
 * The step this plugin adds to the board's vocabulary.
 *
 * A **plain interface, deliberately not `extends UnknownPresentationStep`.**
 * That `extends` compiles and makes a single `as` cast work in a handler,
 * and it costs exactly what `@energy8engine/play-loop`'s `StepHandler` doc
 * warns it costs: the inherited index signature swallows excess properties
 * on this plugin's OWN literals, so a stray `shiftsTypo:` alongside the real
 * fields would type-check in silence. Narrowing is done with the documented
 * double cast (`step as unknown as ReelStepStep`) instead, which keeps
 * excess-property checking on every literal built below.
 */
export interface ReelStepStep {
  kind: 'reelStep';
  /** Cells to pay before the reels move. */
  winning: Cell[];
  /** Per-reel scroll distance, in cells. */
  shifts: number[];
  /** The board the reels land on once they have. */
  settled: Board;
  /**
   * Which round of the chain this is, from 0. The legacy controller uses it
   * to decelerate later rounds, and a handler has no other way to know:
   * `StepHandler.run` is handed one step at a time with no position and no
   * lookahead. Carried on the step so the handler can stay stateless — the
   * plan is the thing that knows the order, so the plan says so.
   */
  index: number;
}

/**
 * What this mechanic's `present` returns: the four kinds every board
 * already performs, plus the one this plugin brings. Named because both `plan` and
 * the `SpinMechanic<ReelStepStep>` below are written against it.
 */
export type ReelStepPlan = (KnownPresentationStep | ReelStepStep)[];

/**
 * The orb's colour bands, by row: `orb.scene.yml` picks its art with
 * `srcKey: '$cell.band'`, and this game's math hands its board over as
 * `[[int]]`, so no cell would carry a band of its own. The mechanic is where
 * the math's board becomes the board's, so this is where one is given —
 * deterministic (a cell's row on the board it sits in, not a roll) and with
 * no math change. Only symbol `6` (the orb) gets one; every other leaf stays
 * the bare id the math sent.
 */
export const BANDS = ['green', 'blue', 'purple', 'red'] as const;

/** `board` with each `6` wrapped as `{ symbol, band }`, its band from its row. */
export function banded(board: Board): Board {
  return board.map((col) =>
    col.map((cell, row): number | string | BoardCell =>
      String(cell) === '6' ? { symbol: cell as number | string, band: BANDS[row % BANDS.length] } : cell,
    ),
  );
}

/** `reel-step` needs the landed board to spin to, plus the chain to walk. */
export const expects: SpinShapeRequirement = {
  fields: { grid: 'grid', reel_steps: 'list' },
};

/**
 * Spin to the landed board, then walk the chain: read out what a round paid
 * when it paid anything, and run the reels for it.
 *
 * Two gates, and they answer different questions — the same split
 * `mechanic-cascade` arrived at, for the same reason:
 *
 *  - **Read out?** Gated on `winning.length > 0`. A round that moved reels
 *    without paying has nothing to add to the player's running total.
 *  - **Continue?** Gated on `winning.length > 0 || shifts.some(n => n > 0)`.
 *    A round that neither pays nor moves anything is the chain ending, and
 *    the math's own loop stops on exactly that condition. Gating
 *    continuation on the payout alone would strand a round that moved reels
 *    without paying — the board would jump to a position the player never
 *    saw arrive.
 *
 * The reveal carries `lines: []`, which is `RevealWinsStep`'s documented
 * "the math gives no per-line breakdown for this reveal" case: `reel_steps`
 * names cells, not lines. The cells still light up — the `reelStep` step
 * highlights and holds its own `winning` before the reels move, exactly as
 * the legacy `ReelStepController` does — so the reveal here is the money
 * readout and nothing else.
 *
 * The return type is `ReelStepPlan` — the four built-in kinds plus this
 * plugin's own one, which is exactly what `SpinMechanic<ReelStepStep>`
 * declares `present` to return. Writing the steps into a local of that type
 * is also where the compiler actually checks them: a mistyped `spinTo`, or
 * a stray field on this plugin's own step, is an error HERE. It is not one
 * at the `present` signature, and the reason is precise rather than
 * "returns are exempt": TypeScript skips the excess-property check on a
 * literal returned from a function whose return type it knows only from
 * CONTEXT (`present: (data) => …`), and performs it on one whose function
 * carries its own return annotation — which this function does, twice over
 * (`: ReelStepPlan` here and on the local below). The four measured cases
 * are in `@energy8engine/contracts`' `tests/mechanic-open.test.ts`.
 */
export function plan(data: ReelStepStageData): ReelStepPlan {
  const steps: ReelStepPlan = [{ kind: 'spinTo', board: banded(data.grid) }];

  data.reel_steps.every((round, index) => {
    const paid = round.winning.length > 0;
    const moved = round.shifts.some((n) => n > 0);
    if (!paid && !moved) return false;

    if (paid) {
      steps.push({ kind: 'revealWins', total: round.win ?? 0, lines: [] });
      // The cells that were just paid then POP — `symbols.yml`'s own `pop`
      // state, on the very cells the reveal named. A second step rather
      // than something the reveal does: `revealWins` is the money readout
      // and says nothing about how a cell looks, and a symbol with no
      // `pop` of its own simply resolves at once (not every symbol on a
      // winning line declares one). `wait: true` holds the plan while they
      // play, so the reels below do not start scrolling out from under
      // them.
      steps.push({ kind: 'playState', cells: round.winning, state: 'pop', wait: true });
    }
    steps.push({
      kind: 'reelStep',
      winning: round.winning,
      shifts: round.shifts,
      settled: banded(round.settled),
      index,
    });
    return true;
  });

  return steps;
}

/**
 * The registration bundle `MechanicsService.register` takes.
 *
 * `SpinMechanic<ReelStepStep>` — the type parameter is how a mechanic says
 * "I also emit this kind", and it is why there is no cast here. There used
 * to be one: `present` was declared to return the closed `PresentationPlan`,
 * so a mechanic emitting a seventh kind could not satisfy its own
 * registration type without `as PresentationPlan`. Naming the step type
 * instead keeps the plan honest in both directions — this plugin's step is
 * admitted, and a mistyped built-in one is still rejected.
 *
 * The `data as ReelStepStageData` cast that remains is a different thing
 * and is not going away: `present(data: unknown)` is the registry's
 * signature because a registry cannot know what shape any given stage
 * carries. `requires` is what makes that cast safe — `checkShape` runs
 * against real stage data before anything is presented.
 */
export const mechanic: SpinMechanic<ReelStepStep> = {
  id: 'reel-step',
  requires: expects,
  present: (data) => plan(data as ReelStepStageData),
};
