// packages/stake-kit/test/adapter.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineGame } from '@energy8platform/platform-core/game-spec';
import type { GameSpec } from '@energy8platform/platform-core/game-spec';
import type { RoundContext } from '@energy8platform/stake-bridge';
import { createGameAdapter, resumeFromBook } from '../src/adapter';
import { ensureBook } from '../src/book';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 }, betLevels: [1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' }, buy_bonus: { role: 'buy', cost: 50 } },
};
const model = defineGame(spec);

const schema = z.object({
  total_win: z.number().optional(),
  free_spins_awarded: z.number().optional(),
  cascades: z.array(z.object({ wins: z.array(z.number()) })),
});

const adapter = createGameAdapter({
  model,
  schema,
  segmentOf: ({ event, payload, round }) => {
    const stage = (event as any).stage;
    const isFs = stage === 'free_spins';
    const core: any = {
      action: isFs ? 'free_spin' : round.triggerAction,
      winX: payload.total_win ?? 0,
      session: { roundId: round.roundId },
    };
    if (!isFs && (payload.free_spins_awarded ?? 0) > 0) {
      core.bonusFreeSpin = { grantId: 1, remainingSpins: payload.free_spins_awarded };
    }
    return core;
  },
});

const ctx: RoundContext = {
  mode: 'BASE', triggerAction: 'spin', betAmount: 2, payoutMultiplier: 0, currency: 'EUR', roundId: '77',
};

describe('createGameAdapter.splitRound', () => {
  it('builds a single base segment with roundId + non-free nextActions + coerced arrays', () => {
    const segs = adapter.splitRound!([{ stage: 'base_game', data: { total_win: 5, cascades: {} } }], ctx);
    expect(segs).toHaveLength(1);
    expect(segs[0].action).toBe('spin');
    expect(segs[0].winThisSegment).toBe(10); // 5 × bet 2
    expect(segs[0].nextActions.sort()).toEqual(['buy_bonus', 'spin']); // model.modeMap keys (no free_spin)
    expect((segs[0].data as any).cascades).toEqual([]); // {} → [] via schema-derived field set
    expect(segs[0].session).toEqual({ roundId: '77' });
    expect(segs[0].progressMarker).toBe('seg-0');
  });
  it('chains a free-spin round: bonusFreeSpin on trigger, free_spin action + chain nextActions', () => {
    const segs = adapter.splitRound!([
      { stage: 'base_game', data: { total_win: 0, free_spins_awarded: 3, cascades: [] } },
      { stage: 'free_spins', data: { total_win: 4, cascades: [] } },
    ], ctx);
    expect(segs[0].bonusFreeSpin).toEqual({ grantId: 1, remainingSpins: 3 });
    expect(segs[0].nextActions).toEqual(['free_spin']); // next segment's action
    expect(segs[1].action).toBe('free_spin');
    expect(segs[1].winThisSegment).toBe(8); // 4 × 2
    expect(segs[1].nextActions.sort()).toEqual(['buy_bonus', 'spin']); // final → next-round actions
  });
  it('preserves sub-cent win precision (money grid, not cents)', () => {
    // 0.1234× on a 0.2 bet = 0.02468 — the shell shows up to 4 decimals, so this must NOT be
    // rounded to 0.02 (cents) here. betAmount 0.2 via a dedicated ctx.
    const subCentCtx = { ...ctx, betAmount: 0.2 };
    const segs = adapter.splitRound!([{ stage: 'base_game', data: { total_win: 0.1234, cascades: [] } }], subCentCtx);
    expect(segs[0].winThisSegment).toBe(0.02468); // 0.1234 × 0.2, full precision (was 0.02 with cents rounding)
  });
});

describe('resumeFromBook', () => {
  const book = ensureBook([
    { stage: 'base_game' }, { stage: 'free_spins' }, { stage: 'free_spins' },
  ], 'spin');
  it('returns 0 with no marker', () => {
    expect(resumeFromBook(book, undefined, { sessionStages: ['free_spins'] })).toBe(0);
  });
  it('rewinds to the first FS event when resuming mid-bonus', () => {
    // acked seg-1 → next 2, but first FS is index 1 → rewind to 1
    expect(resumeFromBook(book, 'seg-1', { sessionStages: ['free_spins'] })).toBe(1);
  });
  it('advances normally before the bonus', () => {
    // a book with FS only at the end; acked seg-0 → next 1 (< firstFs) → 1
    const b2 = ensureBook([{ stage: 'base_game' }, { stage: 'base_game' }, { stage: 'free_spins' }], 'spin');
    expect(resumeFromBook(b2, 'seg-0', { sessionStages: ['free_spins'] })).toBe(1);
  });
});
