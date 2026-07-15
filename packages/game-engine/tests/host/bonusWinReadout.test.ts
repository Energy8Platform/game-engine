import { describe, it, expect } from 'vitest';
import { runRound } from '@/host/runRound';
import type { RenderContext, SlotSceneController } from '@/host/sceneController';

/**
 * Pins the WIN-readout value + shell mode across bonus rounds (incl. NESTED bonuses). While a bonus
 * plays, WIN shows each spin's per-segment delta (the FS "Total win" block carries the cumulative).
 * On the FINAL return to base, WIN must switch to the round's cumulative total — not stay on the
 * last spin's delta. Replicates the createBonusStack wiring from createSlotGame over the real
 * runRound (createSlotGame itself can't boot headless — Pixi hangs).
 */

interface SpinResult {
  totalWin: number;
  complete?: boolean;
  roundId?: string;
  nextActions?: string[];
  freeSpins?: { awarded?: number; total?: number };
}

/** Shell double recording the bar mutations we care about. */
function fakeShell() {
  const winCalls: number[] = [];
  const modeCalls: string[] = [];
  return {
    winCalls,
    modeCalls,
    setWin(n: number, _opts?: { animate?: boolean }) {
      winCalls.push(n);
    },
    setMode(m: string) {
      modeCalls.push(m);
    },
    setBonus() {},
    setFreeSpins() {},
    setBusy() {},
  };
}

const isBonus = (a: string) => a === 'free' || a === 'adventure';
const modeOf = (a: string) => a.toUpperCase();
const ctxFor = (action: string): RenderContext =>
  ({
    bet: 1,
    action,
    mode: action === 'spin' ? 'BASE' : action.toUpperCase(),
    formatAmount: String,
    get turbo() {
      return 0;
    },
  }) as RenderContext;

/** The WIN/mode slice of createSlotGame's createBonusStack + playRound wiring. */
async function drive(shell: ReturnType<typeof fakeShell>, results: SpinResult[]): Promise<void> {
  let i = 0;
  const scene: Pick<SlotSceneController<SpinResult>, 'onSpin'> = { async onSpin() {} };
  let prevWin = 0;
  let depth = 0; // bonus stack depth

  await runRound<SpinResult>(
    {
      play: async () => results[i++],
      ack: () => {},
      scene,
      context: ctxFor,
      modeOf,
      isBonusAction: isBonus,
      afterPresent: (r) => {
        shell.setWin(r.totalWin - prevWin); // per-spin delta
        prevWin = r.totalWin;
      },
      onModeEnter: async (_mode, _r, _ctx, resumed) => {
        if (resumed) return; // a resumed parent is already on the stack — no push, no re-setMode
        if (depth === 0) shell.setMode('freeSpins'); // base → bonus only on the first level
        depth += 1;
      },
      onModeExit: async (_mode, last) => {
        depth -= 1;
        if (depth === 0) {
          shell.setMode('base');
          shell.setWin(last.totalWin); // ← the fix: cumulative on the final return to base
        }
      },
    },
    'spin',
  );
}

describe('WIN readout + mode across bonus rounds', () => {
  it('single bonus ends on the cumulative total, not the final free spin delta', async () => {
    const shell = fakeShell();
    // base trigger (win 2) → free (cum 5) → free (cum 12, complete)
    await drive(shell, [
      {
        totalWin: 2,
        complete: false,
        roundId: 'r1',
        nextActions: ['free'],
        freeSpins: { awarded: 3 },
      },
      { totalWin: 5, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 12, complete: true, roundId: 'r1' },
    ]);
    expect(shell.winCalls).toEqual([2, 3, 7, 12]); // deltas 2,3,7 then cumulative 12
    expect(shell.winCalls.at(-1)).toBe(12); // NOT 7 (the last free spin's delta)
    expect(shell.modeCalls).toEqual(['freeSpins', 'base']);
  });

  it('nested FS → adventure → FS enters bonus once and returns to base once', async () => {
    const shell = fakeShell();
    // spin → free → adventure → free(resume) → complete
    await drive(shell, [
      { totalWin: 1, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 3, complete: false, roundId: 'r1', nextActions: ['adventure'] },
      { totalWin: 8, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 20, complete: true, roundId: 'r1' },
    ]);
    // setMode is 'freeSpins' only on the FIRST push (not re-fired for the nested adventure) and
    // 'base' only on the final unwind — the nested pop back to FS keeps the bar in bonus.
    expect(shell.modeCalls).toEqual(['freeSpins', 'base']);
    expect(shell.winCalls.at(-1)).toBe(20); // cumulative round total on return to base
  });

  it('a plain base round leaves WIN at that spin total (no bonus, no mode change)', async () => {
    const shell = fakeShell();
    await drive(shell, [{ totalWin: 4, complete: true, roundId: 'r1' }]);
    expect(shell.winCalls).toEqual([4]);
    expect(shell.modeCalls).toEqual([]);
  });
});

/** The WIN slice WITH the beforeSegment spin-start reset createSlotGame wires (setWin(0) per
 *  segment). Every spin — base and each free spin — clears WIN before it animates, then afterPresent
 *  counts up to that segment's delta. */
async function driveWithReset(
  shell: ReturnType<typeof fakeShell>,
  results: SpinResult[],
): Promise<void> {
  let i = 0;
  const scene: Pick<SlotSceneController<SpinResult>, 'onSpin'> = { async onSpin() {} };
  let prevWin = 0;
  await runRound<SpinResult>(
    {
      play: async () => results[i++],
      ack: () => {},
      scene,
      context: ctxFor,
      modeOf,
      isBonusAction: isBonus,
      beforeSegment: () => shell.setWin(0, { animate: false }), // spin-start reset
      afterPresent: (r) => {
        shell.setWin(r.totalWin - prevWin);
        prevWin = r.totalWin;
      },
      onModeExit: async (_mode, last) => {
        shell.setWin(last.totalWin);
      },
    },
    'spin',
  );
}

describe('WIN readout resets at the start of every spin', () => {
  it('base round: WIN clears to 0 before the spin, then shows the win', async () => {
    const shell = fakeShell();
    await driveWithReset(shell, [{ totalWin: 4, complete: true, roundId: 'r1' }]);
    expect(shell.winCalls).toEqual([0, 4]); // reset, then this spin's win
  });

  it('bonus: each free spin clears WIN to 0 before its delta lands', async () => {
    const shell = fakeShell();
    await driveWithReset(shell, [
      { totalWin: 2, complete: false, roundId: 'r1', nextActions: ['free'], freeSpins: { awarded: 2 } },
      { totalWin: 5, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 12, complete: true, roundId: 'r1' },
    ]);
    // per segment: reset(0) then delta — 0,2 | 0,3 | 0,7 — then cumulative 12 on return to base
    expect(shell.winCalls).toEqual([0, 2, 0, 3, 0, 7, 12]);
  });
});
