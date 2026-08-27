// packages/game-engine/src/host/resumeDrain.ts

/**
 * Play a recovered open round to completion and settle it.
 *
 * A round that was interrupted — the page reloaded, the socket dropped — is still open on the
 * platform, and the player is owed both its remaining segments and the money at the end of them.
 * This drains it: every remaining segment from where the snapshot left off (Continue animates each,
 * Finish fast-forwards without animation), through to the final ack so the wallet credits the win.
 *
 * The original trigger is gone on a reload, so the free-spins counter here is rebuilt from the
 * bridge's session counts rather than from the trigger's award — see `resumeBonusView`. Bonus mode
 * is entered and exited around the drain, and the counter is painted the moment the bar enters it:
 * a bonus bar with nothing in its counter reads as `0 / 0`, which is what a certification lab means
 * by "the counter is reset while the previous FS round is active".
 *
 * Pure over injected deps — unit-testable, which `createSlotGame` itself is not.
 */

import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { PlayResultData } from '@energy8platform/platform-core';
import type { ShellMode } from '@energy8platform/shell/pixi';
import type { RenderContext, SlotSceneController } from './sceneController';
import type { FreeSpinsView } from './freeSpinsCounter';
import { enrichRoundMeta } from './slotPlay';

export interface ResumeDrainDeps<T extends SlotSpinResultBase> {
  /** The scene to draw the recovered segments on; `undefined` aborts the drain. */
  scene(): SlotSceneController<T> | undefined;
  /** Play the next segment of the open round (PlatformSession.play). */
  play(req: { action: string; bet: number; roundId?: string }): Promise<PlayResultData>;
  /** Acknowledge a presented segment (PlatformSession.playAck) — settles on the final one. */
  ack(raw: PlayResultData): void;
  normalize(raw: unknown): T;
  /** The signal-less RenderContext for an action (the host's `makeContext`). */
  context(action: string): Omit<RenderContext, 'signal'>;
  setWin(amount: number, opts?: { animate?: boolean }): void;
  setMode(mode: ShellMode): void;
  setBusy(busy: boolean): void;
  /** The progressive-WIN window (open while a segment may report per-step wins). */
  winReporter: { open(): void; close(): void };
  /** Paint the bonus readout — the free-spins counter, or the game's own. */
  applyBonusReadout(result: T, view: FreeSpinsView, mode: string): void;
  /** The shell mode a bonus enters: 'bonus' when the game customises the readout, else 'freeSpins'. */
  bonusMode: ShellMode;
}

/** The session counts a bridge attaches to every segment of an open round. */
interface ResumeSession {
  spinsPlayed?: number;
  spinsRemaining?: number;
}

/**
 * Rebuild the free-spins counter from a resumed segment's session counts.
 *
 * The bridge session counts ALL segments including the trigger (segment 0); the free-spins counter
 * is over FREE spins only, so one trigger segment is dropped → `1 / 10`, not `2 / 11`. `null` when
 * the snapshot carries no session at all — there is nothing to count, and painting zeroes would be
 * a claim, not a reading.
 */
export function resumeBonusView(raw: unknown, totalWin: number): FreeSpinsView | null {
  const s = (raw as { session?: ResumeSession | null } | null)?.session;
  if (!s) return null;
  const played = s.spinsPlayed ?? 0;
  return {
    current: Math.max(0, played - 1),
    total: Math.max(0, played + (s.spinsRemaining ?? 0) - 1),
    totalWin,
  };
}

/**
 * Fold a segment's own free-spins counts over the session-derived view.
 *
 * Same precedence live play uses (`overrideView` in createSlotGame): when the book states the count
 * outright, it is the authority — the session's segment arithmetic is only a reconstruction, and it
 * assumes a shape (exactly one trigger segment ahead of the free spins) that not every game has.
 */
export function overrideWithBook(
  view: FreeSpinsView | null,
  fs: SlotSpinResultBase['freeSpins'],
): FreeSpinsView | null {
  if (!fs || (fs.total == null && fs.remaining == null)) return view;
  const base = view ?? { current: 0, total: 0, totalWin: 0 };
  const total = fs.total ?? base.total;
  const current = fs.remaining != null ? Math.max(0, total - fs.remaining) : base.current;
  return { current, total, totalWin: base.totalWin };
}

export function createResumeDrain<T extends SlotSpinResultBase>(
  deps: ResumeDrainDeps<T>,
): (firstRaw: PlayResultData, animate: boolean) => Promise<void> {
  return async function drain(firstRaw: PlayResultData, animate: boolean): Promise<void> {
    const scene = deps.scene();
    if (!scene) return;
    // A recovered drain isn't skippable (no live skip gesture wired to it), so it gets a stable,
    // never-aborted signal to satisfy onSpin's RenderContext. ctx carries the round identity (built
    // once from the trigger action) — recovery drains a single flat bonus using the bridge session
    // counts; the full per-level nesting is a LIVE-play concern (playRound).
    const ctx: RenderContext = {
      ...deps.context((firstRaw as { action?: string }).action ?? 'spin'),
      signal: new AbortController().signal,
    };
    let raw: PlayResultData = firstRaw;
    let r = enrichRoundMeta(deps.normalize(raw), raw);
    let inBonus = false;
    let prevWin = 0; // cumulative win up to the previous segment — WIN readout shows the delta

    /** Push the current segment's counts to the bar (book counts win over the session's). */
    const paintCounter = (): void => {
      const view = overrideWithBook(resumeBonusView(raw, r.totalWin), r.freeSpins);
      if (view) deps.applyBonusReadout(r, view, ctx.mode);
    };

    const applySegment = async (): Promise<void> => {
      // A recovered open round with remaining segments is a bonus → show bonus mode + counter.
      if (!inBonus && !r.complete) {
        inBonus = true;
        deps.setMode(deps.bonusMode);
        // BEFORE the segment animates, not after. The bar has just switched to its bonus face, and
        // its counter still holds the zeroes it was born with; leaving it that way means the player
        // watches a whole free spin play out under `0 / 0` and only then sees where the round
        // actually stands. The snapshot already carries the counts — paint them.
        paintCounter();
      }
      deps.setWin(0, { animate: false }); // clear WIN before this segment animates (see playRound)
      if (animate) deps.winReporter.open(); // a fast-forward drain doesn't present → no reports expected
      if (animate) await scene.onSpin(r, ctx);
      if (inBonus) paintCounter();
      deps.winReporter.close();
      deps.setWin(r.totalWin - prevWin); // THIS spin's win, not the cumulative bonus total
      prevWin = r.totalWin;
      deps.ack(raw); // settles via /wallet/end-round on the FINAL segment
    };

    deps.setBusy(true); // block input while the recovered round drains
    try {
      await applySegment();
      while (!r.complete && r.nextActions && r.nextActions.length > 0) {
        raw = await deps.play({ action: r.nextActions[0], bet: ctx.bet, roundId: r.roundId });
        r = enrichRoundMeta(deps.normalize(raw), raw);
        await applySegment();
      }
      if (inBonus) {
        deps.setMode('base');
        // Same as playRound: on return to base the WIN readout must show the round's cumulative
        // total (r is the final drained segment), not the last segment's per-spin delta.
        deps.setWin(r.totalWin);
      }
    } finally {
      deps.winReporter.close(); // also closes the window when a drained segment threw
      deps.setBusy(false);
    }
  };
}
