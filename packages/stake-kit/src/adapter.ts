// packages/stake-kit/src/adapter.ts
import type { BookAdapter, BookSegment, RoundContext } from '@energy8platform/stake-bridge';
import type { GameConfigData } from '@energy8platform/game-sdk';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import { ensureBook, coerceLuaArrays, progressMarker, parseProgressMarker, roundMoney, type NormalizedBook } from './book';
import { deriveArrayFields } from './schema';
import { enrichConfigWithJurisdiction } from './jurisdiction';
import type { StakeGameConfig, SegmentCore } from './types';

function nextRoundActions(model: GameModel): string[] {
  return Object.keys(model.modeMap);
}

const readStage = (ev: unknown): string | undefined =>
  (ev as { stage?: string; type?: string })?.stage ?? (ev as { type?: string })?.type;

export interface ResumeOptions {
  sessionStages: string[];
}

/** Shared resume: parse `seg-<n>`, rewind to the first session-stage event when mid-bonus. */
export function resumeFromBook(book: NormalizedBook, lastEvent: string | undefined, opts: ResumeOptions): number {
  if (!lastEvent) return 0;
  const acked = parseProgressMarker(lastEvent);
  if (acked == null) return 0;
  const nextIdx = acked + 1;
  const firstFs = book.events.findIndex((e) => opts.sessionStages.includes(readStage(e) ?? ''));
  if (firstFs >= 0 && nextIdx >= firstFs) return firstFs;
  return Math.min(nextIdx, book.events.length);
}

export function createGameAdapter<TData extends Record<string, unknown>>(
  config: StakeGameConfig<TData>,
): BookAdapter {
  const fieldSet = deriveArrayFields(config.schema as never);
  const fallback = config.fallbackTrigger ?? Object.keys(config.model.modeMap)[0] ?? 'spin';
  const readPayload = config.readPayload ??
    ((ev: unknown) => (ev as { data?: unknown; spin?: unknown })?.data ?? (ev as { spin?: unknown })?.spin ?? {});
  const sessionStages = config.sessionStages ?? ['free_spins'];

  return {
    splitRound(rawBook: unknown, round: RoundContext): BookSegment[] {
      const book = ensureBook(rawBook, fallback);
      const built = book.events.map((event, index) => {
        let payload = coerceLuaArrays(readPayload(event), fieldSet) as TData;
        const res = config.schema.safeParse(payload);
        if (res.success) payload = res.data as TData;
        else console.warn('[stake-kit] payload failed schema validation; passing coerced payload', res.error.issues);
        const core: SegmentCore<TData> = config.segmentOf({ event, index, events: book.events, payload, round });
        return { core, payload };
      });
      return built.map(({ core, payload }, index) => {
        const isFinal = index === built.length - 1;
        const seg: BookSegment = {
          action: core.action,
          data: (core.data ?? payload) as Record<string, unknown>,
          winThisSegment: roundMoney(core.winX * round.betAmount),
          nextActions: isFinal ? nextRoundActions(config.model) : [built[index + 1].core.action],
          progressMarker: progressMarker(index),
        };
        if (core.session !== undefined) seg.session = core.session;
        if (core.bonusFreeSpin) seg.bonusFreeSpin = core.bonusFreeSpin;
        return seg;
      });
    },

    resumeFrom(rawBook: unknown, lastEvent: string | undefined): number {
      return resumeFromBook(ensureBook(rawBook, fallback), lastEvent, { sessionStages });
    },

    enrichConfig(cfg: GameConfigData): GameConfigData {
      return enrichConfigWithJurisdiction(cfg);
    },
  };
}
