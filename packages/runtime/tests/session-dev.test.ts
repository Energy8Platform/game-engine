import { describe, expect, it, vi } from 'vitest';
import { checkManifestShape, resolvePlan, activateOne } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import type { InstalledSession } from '@/session/types';

const LAUNCH = { url: 'https://game.example/play' };

function project(over: Record<string, { version: string }> = {}) {
  return {
    plugins: {
      '@e8/host': { version: '*' },
      '@e8/session-dev': { version: '*' },
      ...over,
    },
  };
}

describe('session-dev manifest', () => {
  it('is structurally valid', () => {
    expect(checkManifestShape(sessionDevPlugin)).toEqual([]);
  });

  it('contributes to session.provider as the default', () => {
    const list = sessionDevPlugin.contributes?.[POINT_SESSION_PROVIDER];
    expect(list).toHaveLength(1);
    expect(list![0].id).toBe('dev');
    expect(list![0].activateWhen).toEqual({ default: true });
  });

  it('exposes the DevBridge knobs as its own schema fields', () => {
    const own = sessionDevPlugin.contributes![POINT_SESSION_PROVIDER][0].schema!;
    expect(Object.keys(own)).toEqual(expect.arrayContaining(['balance', 'currency', 'networkDelay', 'debug']));
  });
});

describe('session-dev in a plan', () => {
  it('wins by default when nothing else matches', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
      hookIds: ['bootstrap', 'dispose', 'beforeSpin', 'afterSpin', 'beforeRender'],
    });
    expect(diagnostics).toEqual([]);
    const active = plan.contributions.filter((c) => c.active);
    expect(active.map((c) => c.id)).toEqual(['dev']);
  });

  it('fills its settings from the merged schema defaults', () => {
    const { plan } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
    });
    const dev = plan.contributions.find((c) => c.id === 'dev')!;
    expect(dev.settings.balance).toBe(100000);
    expect(dev.settings.currency).toBe('USD');
    // Not '' — the point schema's own default. The contribution's `defaults: { label: 'Local
    // mock host' }` overrides it, which is the documented fix for the point schema's `label`
    // default undercutting its own doc ("shown in the IDE when this provider is the active
    // one"); see progress.md's Task 2 note.
    expect(dev.settings.label).toBe('Local mock host');
  });

  it('installs a DevBridge with the full settings, starts it, and hands back a disposer', async () => {
    const made = vi.fn();
    const started = vi.fn();
    const stopped = vi.fn();
    const order: string[] = [];
    // The provider reaches DevBridge through a dynamic import; the test injects a fake through the
    // documented `loadDevBridge` seam rather than mocking a module path.
    const { plan } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
    });
    const { instance, diagnostics } = await activateOne<import('@/session/types').SessionProvider>(
      plan,
      POINT_SESSION_PROVIDER,
    );
    expect(diagnostics).toEqual([]);
    expect(typeof instance!.value).toBe('function');

    const installed: InstalledSession = await instance!.value({
      url: LAUNCH.url,
      settings: { balance: 500, currency: 'EUR', networkDelay: 250, debug: true, label: 'x' },
      loadDevBridge: async () => class {
        constructor(cfg: unknown) { made(cfg); order.push('construct'); }
        start() { started(); order.push('start'); }
        stop() { stopped(); }
      },
    } as never);
    // Exact object, not objectContaining — dev.ts passes exactly these four fields to DevBridge
    // (label is a display-only setting, never forwarded), and a mutation that dropped or swapped
    // one of them must fail this assertion rather than slide through a subset match.
    expect(made).toHaveBeenCalledWith({ balance: 500, currency: 'EUR', networkDelay: 250, debug: true });
    expect(started).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['construct', 'start']);

    await installed.dispose?.();
    expect(stopped).toHaveBeenCalled();
  });
});
