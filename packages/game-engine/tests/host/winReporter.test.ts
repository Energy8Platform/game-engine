import { describe, it, expect } from 'vitest';
import { createWinReporter, type WinReportOptions } from '@/host/winReporter';
import { runRound } from '@/host/runRound';
import type { RenderContext, SlotSceneController } from '@/host/sceneController';

/**
 * The progressive (cascade/tumble) WIN readout: a scene reports the win accumulated so far while the
 * segment presents, and the host keeps ownership of the number around it.
 */

interface Paint {
  amount: number;
  opts?: WinReportOptions;
}

describe('createWinReporter', () => {
  it('drops reports while the window is closed and honours them once open', () => {
    const painted: Paint[] = [];
    const wr = createWinReporter((amount, opts) => painted.push({ amount, opts }));

    wr.report(5); // before any segment — the host owns the readout
    expect(painted).toEqual([]);
    expect(wr.accepting).toBe(false);

    wr.open();
    wr.report(0.4, { durationMs: 220 });
    expect(painted).toEqual([{ amount: 0.4, opts: { durationMs: 220 } }]);

    wr.close();
    wr.report(99); // a scene still animating after an abort can't overwrite the final value
    expect(painted).toHaveLength(1);
  });

  it('re-opens per segment', () => {
    const painted: Paint[] = [];
    const wr = createWinReporter((amount) => painted.push({ amount }));
    wr.open();
    wr.report(1);
    wr.close();
    wr.open();
    wr.report(2);
    wr.close();
    expect(painted.map((p) => p.amount)).toEqual([1, 2]);
  });

  it('drops NaN/Infinity and clamps negatives so a math bug cannot paint garbage', () => {
    const painted: number[] = [];
    const wr = createWinReporter((amount) => painted.push(amount));
    wr.open();
    wr.report(Number.NaN);
    wr.report(Number.POSITIVE_INFINITY);
    wr.report(-3);
    wr.report(2.5);
    expect(painted).toEqual([0, 2.5]);
  });

  it('passes the animate:false snap through untouched', () => {
    const painted: Paint[] = [];
    const wr = createWinReporter((amount, opts) => painted.push({ amount, opts }));
    wr.open();
    wr.report(3.8, { animate: false });
    expect(painted).toEqual([{ amount: 3.8, opts: { animate: false } }]);
  });
});

// ── the host wiring: reporter + runRound, as createSlotGame wires them ────────────────────────────

interface SpinResult {
  totalWin: number;
  complete?: boolean;
  roundId?: string;
  nextActions?: string[];
  cascades?: number[]; // per-step wins the scene reports while presenting
}

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

/** The WIN slice of createSlotGame's playRound: reset + open per segment, close + final on
 *  afterPresent, cumulative total on the return to base. The scene reports its cascade steps. */
async function drive(results: SpinResult[]): Promise<number[]> {
  const winCalls: number[] = [];
  const wr = createWinReporter((amount) => winCalls.push(amount));
  let i = 0;
  let prevWin = 0;
  // A cascade scene: after each step it reports the segment's running total (absolute).
  const scene: Pick<SlotSceneController<SpinResult>, 'onSpin'> = {
    async onSpin(r) {
      let acc = 0;
      for (const step of r.cascades ?? []) {
        acc += step;
        wr.report(acc, { durationMs: 220 });
      }
    },
  };
  await runRound<SpinResult>(
    {
      play: async () => results[i++],
      ack: () => {},
      scene,
      context: ctxFor,
      modeOf: (a) => a.toUpperCase(),
      isBonusAction: (a) => a === 'free',
      beforeSegment: () => {
        winCalls.push(0); // shell.setWin(0, { animate: false })
        wr.open();
      },
      afterPresent: (r) => {
        wr.close();
        winCalls.push(r.totalWin - prevWin);
        prevWin = r.totalWin;
      },
      onModeExit: async (_mode, last) => {
        winCalls.push(last.totalWin); // cumulative round total back in base
      },
    },
    'spin',
  );
  return winCalls;
}

describe('progressive WIN over a round', () => {
  it('a base cascade round climbs per step and the host final matches the last report', async () => {
    const win = await drive([
      { totalWin: 8, complete: true, roundId: 'r1', cascades: [1, 2, 5] },
    ]);
    // reset, three cascade reports (running totals), then the host's segment value — same number,
    // so the shell's count-up is a no-op and the readout never jumps.
    expect(win).toEqual([0, 1, 3, 8, 8]);
  });

  it('reports land per free spin and the round still ends on the cumulative total', async () => {
    const win = await drive([
      { totalWin: 2, complete: false, roundId: 'r1', nextActions: ['free'], cascades: [2] },
      { totalWin: 5, complete: false, roundId: 'r1', nextActions: ['free'], cascades: [1, 2] },
      { totalWin: 12, complete: true, roundId: 'r1', cascades: [7] },
    ]);
    // per segment: 0 reset | reports | host delta — then 12 cumulative on the return to base.
    expect(win).toEqual([0, 2, 2, 0, 1, 3, 3, 0, 7, 7, 12]);
  });

  it('a scene that reports nothing behaves exactly as before', async () => {
    const win = await drive([{ totalWin: 4, complete: true, roundId: 'r1' }]);
    expect(win).toEqual([0, 4]);
  });

  it('a scene reporting after its segment ended cannot move the readout', async () => {
    const winCalls: number[] = [];
    const wr = createWinReporter((amount) => winCalls.push(amount));
    let late: (() => void) | null = null;
    const scene: Pick<SlotSceneController<SpinResult>, 'onSpin'> = {
      async onSpin() {
        wr.report(1);
        late = () => wr.report(999); // a step that fires after the segment resolved (post-abort)
      },
    };
    await runRound<SpinResult>(
      {
        play: async () => ({ totalWin: 1, complete: true, roundId: 'r1' }),
        ack: () => {},
        scene,
        context: ctxFor,
        beforeSegment: () => wr.open(),
        afterPresent: (r) => {
          wr.close();
          winCalls.push(r.totalWin);
        },
      },
      'spin',
    );
    late!();
    expect(winCalls).toEqual([1, 1]); // the report, the host's final — and nothing after
  });
});
