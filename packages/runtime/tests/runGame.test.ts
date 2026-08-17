import { describe, expect, it, vi } from 'vitest';
import { hostPlugin } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { runGame } from '@/runGame';

const fakeDevBridge = () =>
  class {
    started = false;
    start() { this.started = true; }
    stop() {}
  };

function base() {
  return {
    project: { plugins: { '@e8/host': { version: '*' }, '@e8/session-dev': { version: '*' } } },
    manifests: [hostPlugin, sessionDevPlugin],
    url: 'https://game.example/play',
    loadDevBridge: async () => fakeDevBridge(),
  };
}

describe('runGame', () => {
  it('resolves, installs the winning provider, then runs one handshake', async () => {
    const createSession = vi.fn(async () => ({ kind: 'session' }));
    const result = await runGame({ ...base(), createSession });
    expect(result.diagnostics).toEqual([]);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.session).toEqual({ kind: 'session' });
  });

  it('does not run the handshake when resolution reported an error', async () => {
    const createSession = vi.fn(async () => ({ kind: 'session' }));
    const result = await runGame({
      ...base(),
      // session.provider still resolves to an eligible, ACTIVE contributor — session-dev, same as
      // base(). The error instead comes from '@e8/ghost', a plugin the project references but
      // never installs (no matching manifest). Deliberately NOT an empty-point error: a project
      // that also leaves session.provider unfilled would pass this test even with the hasErrors
      // gate deleted, since activateOne would then independently return null and mask the gate's
      // absence — proved by mutation, see task-5-report.md's Fix round 1.
      project: {
        plugins: {
          '@e8/host': { version: '*' },
          '@e8/session-dev': { version: '*' },
          '@e8/ghost': { version: '*' },
        },
      },
      createSession,
    });
    expect(result.diagnostics.some((d) => d.severity === 'error' && d.code === 'resolve/plugin-not-found')).toBe(
      true,
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(result.session).toBeNull();
  });

  it('installs the provider before it runs the handshake', async () => {
    // Pins the order directly, rather than relying on a test name: a runGame that ran the
    // handshake first and installed second would still make every OTHER test in this file pass.
    const order: string[] = [];
    const result = await runGame({
      ...base(),
      loadDevBridge: async () =>
        class {
          start() {
            order.push('installed');
          }
          stop() {}
        },
      createSession: async () => {
        order.push('handshake');
        return { kind: 'session' };
      },
    });
    expect(order).toEqual(['installed', 'handshake']);
    expect(result.session).toEqual({ kind: 'session' });
  });

  it('never rejects, whatever the project looks like', async () => {
    for (const project of [null, {}, { plugins: null }, { plugins: { ghost: { version: '*' } } }]) {
      await expect(runGame({ ...base(), project: project as never })).resolves.toBeDefined();
    }
  });

  it('never rejects, whatever it is handed', async () => {
    const hostile: unknown[] = [
      undefined, null, 'nope', 42, [], {},
      { project: null }, { project: 'x' }, { project: { plugins: null } },
      { ...base(), manifests: null }, { ...base(), manifests: [null] },
      { ...base(), manifests: [{ get id() { throw new Error('getter boom'); } }] },
      { ...base(), url: undefined }, { ...base(), url: Symbol('u') },
      { ...base(), createSession: () => { throw new Error('sync'); } },
      { ...base(), createSession: async () => { throw new Error('async'); } },
      { ...base(), createSession: 'not a function' },
      { ...base(), createSession: () => { throw Object.create(null); } },
    ];
    for (const input of hostile) {
      await expect(runGame(input as never)).resolves.toBeDefined();
    }
  });

  it('builds a hook bus over the runtime hook vocabulary', async () => {
    const result = await runGame({ ...base(), createSession: async () => ({}) });
    expect(result.hooks.ids()).toContain('beforeSpin');
  });

  it('disposes the installed provider', async () => {
    const stop = vi.fn();
    const result = await runGame({
      ...base(),
      loadDevBridge: async () => class { start() {} stop() { stop(); } },
      createSession: async () => ({}),
    });
    await result.dispose();
    expect(stop).toHaveBeenCalled();
  });

  it('reports a provider whose installation failed, instead of throwing', async () => {
    const result = await runGame({
      ...base(),
      loadDevBridge: async () => { throw new Error('module gone'); },
      createSession: async () => ({}),
    });
    expect(result.session).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'activate/factory-failed')).toBe(true);
  });

  it('reports a handshake that failed, instead of throwing', async () => {
    const result = await runGame({
      ...base(),
      createSession: async () => { throw new Error('rgs unreachable'); },
    });
    expect(result.session).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'runtime/handshake-failed')).toBe(true);
  });
});
