/**
 * `audio`: sets a category's volume ("ducking" — `sfx` and `music` mix
 * separately) on the row's shared `AudioState` (`./audio-state.ts`, the
 * same object `sound`'s `createSound` gets — see `./runtime.ts`), ramping
 * every currently-playing instance of that category to
 * `instanceVolume × newCategoryVolume` over `fade` ms; a LATER `sound` play
 * in that category starts at the new level (`state.categoryVolume`).
 *
 * `category` is a plain union in the schema (same as `sound`'s own), so an
 * unrecognized one only reaches `run` by bypassing the schema (bad
 * hand-authored JSON, say) — guarded the same paranoid way `spin`'s
 * `betLevel` is in `@energy8engine/flow`'s `kinds.ts`, rather than trusted.
 */
import Schema from 'schemastery';
import { resolveValue, type FlowNodeKind } from '@energy8engine/flow';
import type { AudioState } from './audio-state';

const CATEGORIES = ['sfx', 'music'] as const;
type Category = (typeof CATEGORIES)[number];

export interface AudioProps {
  category: Category;
  /** Numeric literal, `$expr`, or a `{…}` template — clamped 0..1. */
  volume: string;
  /** Ramp duration, milliseconds. */
  fade: number;
}

export function createAudio(state: AudioState): FlowNodeKind<AudioProps> {
  return {
    kind: 'audio',
    schema: Schema.object({
      category: Schema.union([...CATEGORIES])
        .default('sfx')
        .description('mix bus to duck — see `sound`'),
      volume: Schema.string()
        .default('1')
        .description('0..1: a numeric literal, `$expr`, or a `{…}` template'),
      fade: Schema.number().default(0).description('ramp duration, milliseconds'),
    }) as Schema<AudioProps>,
    outs: ['next'],
    async run(p, { vars, report }) {
      if (!CATEGORIES.includes(p.category as Category)) {
        report(`unknown category '${p.category}'`);
        return { out: 'next' };
      }
      const raw = resolveValue(p.volume, vars, (m) => report(m, 'warning'));
      const volume = Number(raw);
      if (raw == null || (typeof raw === 'string' && raw.trim() === '') || Number.isNaN(volume)) {
        report(`volume "${raw}" is not a number`);
        return { out: 'next' };
      }
      state.setCategory(p.category, Math.min(1, Math.max(0, volume)), p.fade);
      return { out: 'next' };
    },
  };
}
