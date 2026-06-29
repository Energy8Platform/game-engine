import { describe, it, expect } from 'vitest';
import { applySocialReplacements } from '../src/social';

describe('applySocialReplacements — pay family', () => {
  it('swaps the payline / paying terms (longer phrases win over "pay")', () => {
    expect(applySocialReplacements('Paylines')).toBe('Winlines');
    expect(applySocialReplacements('payline')).toBe('winline');
    expect(applySocialReplacements('paying')).toBe('winning'); // bare "pay" is word-bounded, can't reach it
    expect(applySocialReplacements('Top paying symbols')).toBe('Top winning symbols');
  });

  it('still swaps the existing pay terms and preserves case', () => {
    expect(applySocialReplacements('pay')).toBe('win');
    expect(applySocialReplacements('PAYS')).toBe('WINS');
    expect(applySocialReplacements('Bet')).toBe('Play');
  });

  it('leaves "pay" inside a larger word alone (whole-word match)', () => {
    expect(applySocialReplacements('Autoplay')).toBe('Autoplay');
  });
});
