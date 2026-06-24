// packages/stake-kit/src/types.ts
import type { ZodType } from 'zod';
import type { RoundContext } from '@energy8platform/stake-bridge';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { SessionData } from '@energy8platform/game-sdk';

export interface SegmentCore<TData = Record<string, unknown>> {
  action: string;
  /** ×bet multiplier; the adapter computes winThisSegment = roundMoney(winX * betAmount). */
  winX: number;
  /** Session override merged onto the bridge's synthSession. `roundId` is the
   *  documented extra the bridge spreads for mid-round resume (not on SessionData). */
  session?: (Partial<SessionData> & { roundId?: string }) | null;
  bonusFreeSpin?: { grantId: number; remainingSpins: number };
  /** Optional data override; defaults to the coerced+validated payload. */
  data?: TData;
}

export interface SegmentContext<TData = Record<string, unknown>> {
  event: unknown;
  index: number;
  events: unknown[];
  payload: TData;
  round: RoundContext;
}

export interface StakeGameConfig<TData = Record<string, unknown>> {
  model: GameModel;
  schema: ZodType<TData>;
  segmentOf: (ctx: SegmentContext<TData>) => SegmentCore<TData>;
  /** Stages treated as session-internal spins (for resume rewind). Default ['free_spins']. */
  sessionStages?: string[];
  /** Extract the per-event payload. Default: ev.data ?? ev.spin ?? {}. */
  readPayload?: (event: unknown) => unknown;
  /** Trigger label when the book is a bare array. Default: first model.modeMap key. */
  fallbackTrigger?: string;
}
