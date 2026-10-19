import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DemoWallet, demoStorageKey } from '../src/demo';

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

describe('DemoWallet переживает перезагрузку страницы', () => {
  function memStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    } as Storage;
  }
  const g = globalThis as { sessionStorage?: Storage };
  let prev: Storage | undefined;
  beforeEach(() => {
    prev = g.sessionStorage;
    g.sessionStorage = memStorage();
  });
  afterEach(() => {
    g.sessionStorage = prev;
  });

  it('новая страница той же сессии стартует с того, что было, а не со стартового', () => {
    const first = new DemoWallet(1000, 's1');
    first.bet(10);
    first.credit(2.5);
    expect(new DemoWallet(1000, 's1').balance).toBe(992.5);
  });

  it('другая сессия — свой стартовый баланс', () => {
    new DemoWallet(1000, 's1').bet(10);
    expect(new DemoWallet(1000, 's2').balance).toBe(1000);
  });

  it('мусор в хранилище игнорируется', () => {
    g.sessionStorage!.setItem(demoStorageKey('s1'), 'abc');
    expect(new DemoWallet(1000, 's1').balance).toBe(1000);
  });

  it('без sessionId ничего не пишет', () => {
    new DemoWallet(1000).bet(10);
    expect(g.sessionStorage!.length).toBe(0);
  });
});
