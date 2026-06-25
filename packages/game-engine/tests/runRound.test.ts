import { describe, it, expect, vi } from 'vitest';
import { runRound } from '@/host/runRound';

type R = { totalWin: number; complete: boolean; roundId?: string; nextActions?: string[]; freeSpins?: { awarded?: number } };

function baseCtx() {
  return { bet: 1, action: 'spin', mode: 'BASE', formatAmount: (v: number) => String(v), turbo: 0 } as any;
}

describe('runRound lifecycle', () => {
  it('fires onSpinStart once, onSpin per segment, onSpinEnd once', async () => {
    const order: string[] = [];
    const results: R[] = [
      { totalWin: 0, complete: false, roundId: 'r1', nextActions: ['free'], freeSpins: { awarded: 1 } },
      { totalWin: 5, complete: true, roundId: 'r1' },
    ];
    let i = 0;
    await runRound<any>({
      play: async () => results[i++],
      ack: () => order.push('ack'),
      scene: { onSpin: async (r: R) => order.push(`spin:${r.complete}`) },
      context: () => baseCtx(),
      roleOf: (a) => (a === 'free' ? 'free' : 'base'),
      onSpinStart: () => order.push('start'),
      onSpinEnd: () => order.push('end'),
      onEnterMode: async () => order.push('enterMode'),
      onExitMode: async () => order.push('exitMode'),
    }, 'spin');
    expect(order[0]).toBe('start');
    expect(order.filter((o) => o === 'start')).toHaveLength(1);
    expect(order.filter((o) => o === 'end')).toHaveLength(1);
    expect(order).toContain('enterMode');
    expect(order).toContain('exitMode');
    expect(order[order.length - 1]).toBe('end');
  });

  it('injects an AbortSignal into each segment ctx and exposes the controller via beforeSegment', async () => {
    let sawSignal = false;
    let controller: AbortController | null = null;
    await runRound<any>({
      play: async () => ({ totalWin: 0, complete: true, roundId: 'r1' }),
      ack: () => {},
      scene: { onSpin: async (_r, ctx) => { sawSignal = ctx.signal instanceof AbortSignal; } },
      context: () => baseCtx(),
      roleOf: () => 'base',
      beforeSegment: (ac) => { controller = ac; },
    }, 'spin');
    expect(sawSignal).toBe(true);
    expect(controller).toBeInstanceOf(AbortController);
  });
});
