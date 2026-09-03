import { describe, it, expect } from 'vitest';
import { applySocialText } from '../src/social';

describe('applySocialText (no bridge dict loaded)', () => {
  it('applies default base swaps', () => {
    expect(applySocialText('Place your Bet')).toBe('Place your Play');
    expect(applySocialText('Insufficient funds')).toBe('Insufficient balance');
    expect(applySocialText('Buy Bonus')).toBe('Get Bonus');
  });
  it('protects the "Engine" brand from the bet→play swap', () => {
    expect(applySocialText('Powered by Engine')).toBe('Powered by Engine');
  });
  it('merges caller overrides into the PRE pass', () => {
    expect(applySocialText('Spin to win', { pre: [[/\bSpin\b/g, 'Tap']] })).toBe('Tap to win');
  });
  it('collapses doubled Play from bet+cost rewrites', () => {
    expect(applySocialText('Total Bet Cost')).toBe('Total Play');
  });
});
