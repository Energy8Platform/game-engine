import { describe, it, expect } from 'vitest';
import { DemoWallet } from '../src/demo';

describe('DemoWallet', () => {
  it('стартует с заданного баланса', () => {
    expect(new DemoWallet(1000).balance).toBe(1000);
  });

  it('ставка списывает, выигрыш зачисляет', () => {
    const wallet = new DemoWallet(100);
    wallet.bet(10);
    expect(wallet.balance).toBe(90);
    wallet.credit(25);
    expect(wallet.balance).toBe(115);
  });

  it('баланс не уходит в минус', () => {
    const wallet = new DemoWallet(5);
    wallet.bet(10);
    expect(wallet.balance).toBe(0);
  });

  it('копейки не накапливают ошибку округления', () => {
    const wallet = new DemoWallet(0.3);
    wallet.bet(0.1);
    wallet.bet(0.1);
    expect(wallet.balance).toBe(0.1);
  });
});
