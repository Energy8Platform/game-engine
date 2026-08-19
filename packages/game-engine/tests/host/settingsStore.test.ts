import { describe, it, expect, vi } from 'vitest';
import { attachSettingsStore, readSettings, settingsKey } from '@/host/settingsStore';

/** Minimal stand-in for the shell: the four members the store touches, plus a recorder. */
function fakeShell() {
  const handlers: Record<string, Array<(d: any) => void>> = {};
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    setTurbo: (level: number) => calls.push(['setTurbo', level]),
    setMenuValue: (id: string, v: boolean | number) => calls.push([`setMenuValue:${id}`, v]),
    on(event: string, h: (d: any) => void) {
      (handlers[event] ??= []).push(h);
      return this;
    },
    off(event: string, h: (d: any) => void) {
      handlers[event] = (handlers[event] ?? []).filter((x) => x !== h);
      return this;
    },
    emit(event: string, data: unknown) {
      for (const h of handlers[event] ?? []) h(data);
    },
  };
}

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
const attach = (shell: any, storage: Storage | null, maxTurbo?: number) =>
  attachSettingsStore(shell, { key: 'my-game', storage, maxTurbo });

describe('attachSettingsStore', () => {
  it('restores the stored turbo and menu values onto a fresh shell', () => {
    const shell = fakeShell();
    const storage = memStorage({ [KEY]: JSON.stringify({ turbo: 2, menu: { sound: false, music: 0.3 } }) });
    attach(shell, storage);

    expect(shell.calls).toContainEqual(['setTurbo', 2]);
    expect(shell.calls).toContainEqual(['setMenuValue:sound', false]);
    expect(shell.calls).toContainEqual(['setMenuValue:music', 0.3]);
  });

  it('a jurisdiction cap beats the stored level — storage cannot hand back a restricted setting', () => {
    const shell = fakeShell();
    const storage = memStorage({ [KEY]: JSON.stringify({ turbo: 3 }) });
    attach(shell, storage, 1); // features.turbo lowered to 1 by applyJurisdiction

    expect(shell.calls).toContainEqual(['setTurbo', 1]);
  });

  it('writes on turboChange and settingChange', () => {
    const shell = fakeShell();
    const storage = memStorage();
    attach(shell, storage);

    shell.emit('turboChange', 2);
    shell.emit('settingChange', { key: 'sound', value: false });

    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ turbo: 2, menu: { sound: false } });
  });

  it('restoring does not write back what it just read', () => {
    const shell = fakeShell();
    const storage = memStorage({ [KEY]: JSON.stringify({ turbo: 1 }) });
    const setItem = vi.spyOn(storage, 'setItem');
    attach(shell, storage);

    // Subscribing before restoring would echo every restored value straight back into storage.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('stops writing once detached', () => {
    const shell = fakeShell();
    const storage = memStorage();
    const detach = attach(shell, storage);
    detach();

    shell.emit('turboChange', 3);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('storage that throws on read leaves the game running with no persistence', () => {
    const shell = fakeShell();
    const hostile = { ...memStorage(), getItem: () => { throw new Error('SecurityError'); } } as unknown as Storage;

    expect(() => attach(shell, hostile)).not.toThrow();
    expect(shell.calls).toEqual([]);
  });

  it('storage that throws on write is swallowed — a full quota is not the player’s problem', () => {
    const shell = fakeShell();
    const hostile = { ...memStorage(), setItem: () => { throw new Error('QuotaExceeded'); } } as unknown as Storage;
    attach(shell, hostile);

    expect(() => shell.emit('turboChange', 2)).not.toThrow();
  });

  it('no storage at all is a supported configuration', () => {
    const shell = fakeShell();
    expect(() => attach(shell, null)).not.toThrow();
    expect(shell.calls).toEqual([]);
  });
});

describe('readSettings — storage is player-writable, so it is untrusted input', () => {
  const read = (raw: string) => readSettings(memStorage({ [KEY]: raw }), KEY);

  it('drops a non-integer or negative turbo instead of coercing it', () => {
    expect(read(JSON.stringify({ turbo: '3' }))).toEqual({});
    expect(read(JSON.stringify({ turbo: 1.5 }))).toEqual({});
    expect(read(JSON.stringify({ turbo: -1 }))).toEqual({});
  });

  it('keeps only booleans and finite numbers among menu values', () => {
    expect(read(JSON.stringify({ menu: { sound: false, music: 0.5, bad: 'loud', worse: null, nan: NaN } })))
      .toEqual({ menu: { sound: false, music: 0.5 } });
  });

  it('a malformed or non-object blob yields nothing, not a crash', () => {
    expect(read('not json')).toEqual({});
    expect(read('[1,2,3]')).toEqual({});
    expect(read('null')).toEqual({});
    expect(read(JSON.stringify({ menu: 'nope' }))).toEqual({});
  });

  it('an empty store is simply empty', () => {
    expect(readSettings(memStorage(), KEY)).toEqual({});
  });
});
