import { describe, it, expect } from 'vitest';
import { runRound, planTransition } from '@/host/runRound';

type R = {
  totalWin: number;
  complete: boolean;
  roundId?: string;
  nextActions?: string[];
  freeSpins?: { awarded?: number };
};

/** Context keyed off the SEGMENT action so ctx.mode tracks nested modes (matches host makeContext). */
function ctxFor(action: string) {
  const mode = action === 'spin' ? 'BASE' : action.toUpperCase();
  return { bet: 1, action, mode, formatAmount: (v: number) => String(v), turbo: 0 } as any;
}
// A bonus segment = any action whose key isn't the base 'spin' trigger.
const isBonus = (a: string) => a !== 'spin';
const modeOf = (a: string) => a.toUpperCase();

describe('planTransition (pure)', () => {
  it('pushes a fresh level when the target is not on the stack', () => {
    expect(planTransition([], 'FS')).toEqual({ exit: [], enter: { mode: 'FS', resumed: false } });
    expect(planTransition(['FS'], 'ADV')).toEqual({
      exit: [],
      enter: { mode: 'ADV', resumed: false },
    });
  });
  it('is a no-op when already on the target level', () => {
    expect(planTransition(['FS'], 'FS')).toEqual({ exit: [], enter: null });
  });
  it('resumes a parent by exiting the levels above it (top-first)', () => {
    expect(planTransition(['FS', 'ADV'], 'FS')).toEqual({
      exit: ['ADV'],
      enter: { mode: 'FS', resumed: true },
    });
    expect(planTransition(['FS', 'ADV', 'MINI'], 'FS')).toEqual({
      exit: ['MINI', 'ADV'],
      enter: { mode: 'FS', resumed: true },
    });
  });
  it('unwinds everything (top-first) when returning to base', () => {
    expect(planTransition(['FS', 'ADV'], null)).toEqual({ exit: ['ADV', 'FS'], enter: null });
    expect(planTransition([], null)).toEqual({ exit: [], enter: null });
  });
});

describe('runRound lifecycle', () => {
  it('fires onSpinStart once, onSpin per segment, onSpinEnd once, and one enter/exit for a single bonus', async () => {
    const order: string[] = [];
    const results: R[] = [
      {
        totalWin: 0,
        complete: false,
        roundId: 'r1',
        nextActions: ['free'],
        freeSpins: { awarded: 1 },
      },
      { totalWin: 5, complete: true, roundId: 'r1' },
    ];
    let i = 0;
    await runRound<any>(
      {
        play: async () => results[i++],
        ack: () => order.push('ack'),
        scene: { onSpin: async (r: R) => order.push(`spin:${r.complete}`) },
        context: ctxFor,
        modeOf,
        isBonusAction: isBonus,
        onSpinStart: () => order.push('start'),
        onSpinEnd: () => order.push('end'),
        onModeEnter: async (mode, _r, _ctx, resumed) => order.push(`enter:${mode}:${resumed}`),
        onModeExit: async (mode) => order.push(`exit:${mode}`),
      },
      'spin',
    );
    expect(order[0]).toBe('start');
    expect(order.filter((o) => o === 'start')).toHaveLength(1);
    expect(order.filter((o) => o === 'end')).toHaveLength(1);
    expect(order.filter((o) => o.startsWith('enter:'))).toEqual(['enter:FREE:false']);
    expect(order.filter((o) => o.startsWith('exit:'))).toEqual(['exit:FREE']);
    expect(order[order.length - 1]).toBe('end');
  });

  it('nested bonus: FS → ADVENTURE → FS emits push, push, resume, then unwind', async () => {
    const enters: string[] = [];
    const exits: string[] = [];
    // spin → free(FS) → adventure(ADV) → free(FS, resume) → complete
    const results: R[] = [
      { totalWin: 0, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 1, complete: false, roundId: 'r1', nextActions: ['adventure'] },
      { totalWin: 2, complete: false, roundId: 'r1', nextActions: ['free'] },
      { totalWin: 9, complete: true, roundId: 'r1' },
    ];
    let i = 0;
    await runRound<any>(
      {
        play: async () => results[i++],
        ack: () => {},
        scene: { onSpin: async () => {} },
        context: ctxFor,
        modeOf,
        isBonusAction: isBonus,
        onModeEnter: async (mode, _r, _ctx, resumed) => enters.push(`${mode}:${resumed}`),
        onModeExit: async (mode) => exits.push(mode),
      },
      'spin',
    );
    // Fresh FS, fresh ADV, then FS resumes (ADV popped) — and the final unwind pops FS.
    expect(enters).toEqual(['FREE:false', 'ADVENTURE:false', 'FREE:true']);
    expect(exits).toEqual(['ADVENTURE', 'FREE']);
  });

  it('a plain base round fires no mode enter/exit', async () => {
    const events: string[] = [];
    await runRound<any>(
      {
        play: async () => ({ totalWin: 3, complete: true, roundId: 'r1' }),
        ack: () => {},
        scene: { onSpin: async () => {} },
        context: ctxFor,
        modeOf,
        isBonusAction: isBonus,
        onModeEnter: async (m) => events.push(`enter:${m}`),
        onModeExit: async (m) => events.push(`exit:${m}`),
      },
      'spin',
    );
    expect(events).toEqual([]);
  });

  it('injects an AbortSignal into each segment ctx and exposes the controller via beforeSegment', async () => {
    let sawSignal = false;
    let controller: AbortController | null = null;
    await runRound<any>(
      {
        play: async () => ({ totalWin: 0, complete: true, roundId: 'r1' }),
        ack: () => {},
        scene: {
          onSpin: async (_r, ctx) => {
            sawSignal = ctx.signal instanceof AbortSignal;
          },
        },
        context: ctxFor,
        beforeSegment: (ac) => {
          controller = ac;
        },
      },
      'spin',
    );
    expect(sawSignal).toBe(true);
    expect(controller).toBeInstanceOf(AbortController);
  });
});
