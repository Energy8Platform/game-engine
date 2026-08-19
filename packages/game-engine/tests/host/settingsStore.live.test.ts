// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/shell/html';
import type { ShellConfig } from '@energy8platform/shell/html';
import { attachSettingsStore, settingsKey } from '@/host/settingsStore';

/**
 * The store against a REAL shell, not a stand-in.
 *
 * The unit tests next door drive a fake with four methods, which proves the store's own logic and
 * nothing about whether the shell accepts those calls or reports the result. This pins the part
 * that a fake cannot: that a restored value actually lands in shell state, and that a real player
 * interaction (a turbo tap, a menu toggle) reaches storage.
 *
 * The HTML shell stands in for the Pixi one because they share the whole ShellController core —
 * `createSlotGame` itself can't be booted in tests (GameApplication.init drives Pixi, which hangs
 * headless), the same limitation `shellWiring.test.ts` works around.
 */

const cfg = (): ShellConfig => ({
  mount: document.body,
  gameInfo: { sections: [] },
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [1],
  defaultBet: 1,
  currentBet: 1,
  balance: 100,
  win: 0,
  mode: 'base',
  features: { turbo: 3, buyBonus: false },
});

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
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

const KEY = settingsKey('my-game');

describe('attachSettingsStore against a live shell', () => {
  beforeEach(async () => {
    await removeGameShell();
    document.body.innerHTML = '';
  });

  it('a restored turbo level is what the shell actually reports afterwards', () => {
    const storage = memStorage({ [KEY]: JSON.stringify({ turbo: 2 }) });
    const shell = createGameShell(cfg());
    attachSettingsStore(shell, { key: 'my-game', storage, maxTurbo: 3 });

    expect(shell.state.turbo).toBe(2);
  });

  it('a restored sound toggle reaches the preset’s own home, not a second copy', () => {
    const storage = memStorage({ [KEY]: JSON.stringify({ menu: { sound: false, music: 0.25 } }) });
    const shell = createGameShell(cfg());
    attachSettingsStore(shell, { key: 'my-game', storage, maxTurbo: 3 });

    // `sound` lives on `soundOn` and `music` in `volumes` — reading them back through
    // getMenuValue proves setMenuValue routed them rather than parking them in `state.menu`.
    expect(shell.getMenuValue('sound')).toBe(false);
    expect(shell.getMenuValue('music')).toBe(0.25);
    expect(shell.getVolume('music')).toBe(0.25);
  });

  it('a real menu change on the shell lands in storage', () => {
    const storage = memStorage();
    const shell = createGameShell(cfg());
    attachSettingsStore(shell, { key: 'my-game', storage, maxTurbo: 3 });

    shell.setMenuValue('sound', false);
    shell.setVolume('sfx', 0.5);

    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ menu: { sound: false, sfx: 0.5 } });
  });

  it('survives a full round-trip: what one session saved, the next session restores', () => {
    const storage = memStorage();
    const first = createGameShell(cfg());
    attachSettingsStore(first, { key: 'my-game', storage, maxTurbo: 3 });
    first.setTurbo(2);
    // setTurbo alone doesn't announce itself (the bar tap does), so emit what the tap would.
    first.emit('turboChange', 2);
    first.setMenuValue('sound', false);

    return removeGameShell().then(() => {
      document.body.innerHTML = '';
      const second = createGameShell(cfg());
      attachSettingsStore(second, { key: 'my-game', storage, maxTurbo: 3 });

      expect(second.state.turbo).toBe(2);
      expect(second.getMenuValue('sound')).toBe(false);
    });
  });
});
