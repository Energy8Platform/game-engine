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
      // no provider contributes, so the arity:'one' point has nothing — the kernel errors
      project: { plugins: { '@e8/host': { version: '*' } } },
      manifests: [hostPlugin],
      createSession,
    });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(createSession).not.toHaveBeenCalled();
    expect(result.session).toBeNull();
  });

  it('never rejects, whatever the project looks like', async () => {
    for (const project of [null, {}, { plugins: null }, { plugins: { ghost: { version: '*' } } }]) {
      await expect(runGame({ ...base(), project: project as never })).resolves.toBeDefined();
    }
  });

  it('never rejects even when the input itself is missing, not just its project', async () => {
    // A caller can violate RunGameInput's type at the JS boundary the same way a project's own
    // data can be malformed. `resolvePlan` treats its own `input` parameter this defensively
    // (`input?.field` throughout); `runGame` must too, or `rawInput.project` throws before
    // resolution ever gets a chance to turn the problem into a diagnostic.
    for (const bad of [undefined, null]) {
      await expect(runGame(bad as never)).resolves.toBeDefined();
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
});
