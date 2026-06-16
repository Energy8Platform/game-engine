import { describe, it, expect } from 'vitest';
import { socialize } from '@/shell/i18n';

describe('socialize', () => {
  it('swaps single restricted words', () => {
    expect(socialize('bet')).toBe('play');
    expect(socialize('bets')).toBe('plays');
    expect(socialize('pays')).toBe('wins');
    expect(socialize('paid')).toBe('won');
    expect(socialize('cash')).toBe('coins');
    expect(socialize('money')).toBe('coins');
    expect(socialize('stake')).toBe('play amount');
    expect(socialize('payer')).toBe('winner');
    expect(socialize('credit')).toBe('balance');
    expect(socialize('fund')).toBe('balance');
    expect(socialize('currency')).toBe('token');
    expect(socialize('wager')).toBe('play');
    expect(socialize('gamble')).toBe('play');
    expect(socialize('deposit')).toBe('get coins');
    expect(socialize('withdraw')).toBe('redeem');
    expect(socialize('bought')).toBe('instantly triggered');
    expect(socialize('rebet')).toBe('respin');
  });

  it('matches longer phrases before their constituent words', () => {
    expect(socialize('buy bonus')).toBe('get bonus');
    expect(socialize('bonus buy')).toBe('bonus / feature');
    expect(socialize('pay out')).toBe('win / won');
    expect(socialize('total bet')).toBe('total play');
    expect(socialize('win feature')).toBe('play feature');
    expect(socialize('place your bets')).toBe('come and play / join in the game');
    expect(socialize('at the cost of')).toBe('for');
    expect(socialize('cost of')).toBe('can be played for');
  });

  it('resolves the table conflicts to a single replacement', () => {
    expect(socialize('betting')).toBe('playing');
    expect(socialize('paid out')).toBe('won');
    expect(socialize('pays out')).toBe('win');
  });

  it('preserves case (ALL CAPS, Capitalised, lower)', () => {
    expect(socialize('BET')).toBe('PLAY');
    expect(socialize('Bet')).toBe('Play');
    expect(socialize('bet')).toBe('play');
    expect(socialize('BUY BONUS')).toBe('GET BONUS');
    expect(socialize('Buy bonus')).toBe('Get bonus');
    expect(socialize('Total bet')).toBe('Total play');
  });

  it('only swaps whole words — never inside another word', () => {
    expect(socialize('Autoplay')).toBe('Autoplay'); // "pay" is internal
    expect(socialize('Payout multiplier')).toBe('Payout multiplier'); // "pay"/"out" internal
    expect(socialize('rebetting')).toBe('rebetting'); // not "rebet" + "ting"
  });

  it('rewrites inside sentences and leaves non-restricted words alone', () => {
    expect(socialize('Increase your stake.')).toBe('Increase your play amount.');
    expect(socialize('Raise bet')).toBe('Raise play');
    expect(socialize('Balance')).toBe('Balance');
    expect(socialize('Free spins')).toBe('Free spins');
    expect(socialize('Max win')).toBe('Max win');
  });
});
