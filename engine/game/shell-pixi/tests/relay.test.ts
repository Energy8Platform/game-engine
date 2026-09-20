import { describe, expect, it, vi } from 'vitest';
import { SHELL_EVENTS, relay, toObject } from '../src/relay';

describe('toObject — the payload shape a flow node reads', () => {
  it('an object passes as is, the same reference', () => {
    const payload = { id: 'bonus-1' };
    expect(toObject(payload)).toBe(payload);
  });

  it('undefined (a void event) becomes {}', () => {
    expect(toObject(undefined)).toEqual({});
  });

  it('a scalar becomes { value } — 2, 0, false and a string alike', () => {
    expect(toObject(2)).toEqual({ value: 2 });
    expect(toObject(0)).toEqual({ value: 0 });
    expect(toObject(false)).toEqual({ value: false });
    expect(toObject('x')).toEqual({ value: 'x' });
  });
});

describe('relay — every ShellEvents entry, once, and all gone on unsubscribe', () => {
  /** The `on`/`off` half of the shell's EventEmitter, nothing more. */
  function emitter() {
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    return {
      on: vi.fn((name: string, fn: (p: unknown) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
      }),
      off: vi.fn((name: string, fn: (p: unknown) => void) => {
        listeners.get(name)?.delete(fn);
      }),
      emit: (name: string, p?: unknown) => listeners.get(name)?.forEach((fn) => fn(p)),
      size: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  it('lists the twelve names the shell emits', () => {
    expect([...SHELL_EVENTS].sort()).toEqual(
      [
        'spin',
        'betChange',
        'autoplayStart',
        'autoplayStop',
        'turboChange',
        'buyBonusSelect',
        'featureActivate',
        'featureDeactivate',
        'menuOpen',
        'settingsOpen',
        'infoOpen',
        'settingChange',
      ].sort(),
    );
  });

  it('re-emits each as shell.<name> with the object payload', () => {
    const shell = emitter();
    const emit = vi.fn();
    relay(shell as never, emit);
    expect(shell.size()).toBe(SHELL_EVENTS.length);

    shell.emit('spin');
    shell.emit('betChange', 2);
    shell.emit('buyBonusSelect', { id: 'b' });
    expect(emit.mock.calls).toEqual([
      ['shell.spin', {}],
      ['shell.betChange', { value: 2 }],
      ['shell.buyBonusSelect', { id: 'b' }],
    ]);
  });

  it('the returned function unsubscribes every one', () => {
    const shell = emitter();
    const emit = vi.fn();
    const off = relay(shell as never, emit);
    off();
    expect(shell.size()).toBe(0);
    shell.emit('spin');
    expect(emit).not.toHaveBeenCalled();
  });
});
