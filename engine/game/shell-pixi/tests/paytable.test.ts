import { describe, expect, it } from 'vitest';
import type { SymbolsDoc } from '@energy8engine/contracts';
import { paytableFrom } from '../src/paytable';

const spec = { symbols: [
  { id: 'ROCK', name: 'Rock', pay: { '30': 1.2, '8': 0.15, '9': 0.25 } },
  { id: 'WILD', name: 'Wild' },
  { id: 'NUT', pay: { '8': 0.05 } },
] };
// Typed (not just inferred): `SymbolsDoc.version` is the literal `1`, which
// a plain `const` would widen to `number` and fail `paytableFrom`'s second
// parameter.
const symbols: SymbolsDoc = { version: 1, symbols: [
  { id: 'ROCK', static: { type: 'image', props: { src: 'assets/rock.webp' } } },
  { id: 'NUT', static: { type: 'strip', props: { src: 'assets/nut.webp' } } },
] };

describe('paytableFrom', () => {
  it('one row per symbol with pay, counts ascending, image from an image static state, text otherwise', () => {
    expect(paytableFrom(spec, symbols)).toEqual({
      type: 'paytable', title: 'Paytable',
      rows: [
        { symbol: { image: 'assets/rock.webp' }, wins: [{ count: '8', multiplier: 0.15 }, { count: '9', multiplier: 0.25 }, { count: '30', multiplier: 1.2 }] },
        { symbol: { text: 'NUT' }, wins: [{ count: '8', multiplier: 0.05 }] },
      ],
    });
  });
  it('null when no symbol pays, when spec is null, or when symbols is not an array', () => {
    expect(paytableFrom({ symbols: [{ id: 'A' }] }, null)).toBeNull();
    expect(paytableFrom(null, null)).toBeNull();
    expect(paytableFrom({ symbols: 'x' }, null)).toBeNull();
  });
});
