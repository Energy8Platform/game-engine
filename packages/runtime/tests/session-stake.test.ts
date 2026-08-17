import { describe, expect, it, vi } from 'vitest';
import { checkManifestShape, resolvePlan, activateOne } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { POINT_STAKE_ADAPTER, sessionStakePlugin } from '@/session/stake';
import type { SessionProvider } from '@/session/types';

const gamePlugin = {
  id: 'my-slot',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/session-stake': '^0.1.0' },
  contributes: {
    [POINT_STAKE_ADAPTER]: [
      {
        id: 'book-adapter',
        doc: "This game's Stake book adapter.",
        activateWhen: { default: true },
        create: async () => () => ({ adapter: { name: 'fake' }, modeMap: { base: 'BASE' }, gameId: 'my-slot' }),
      },
    ],
  },
};

const ALL = {
  plugins: {
    '@e8/host': { version: '*' },
    '@e8/session-dev': { version: '*' },
    '@e8/session-stake': { version: '*' },
    'my-slot': { version: '*' },
  },
};

const manifests = [hostPlugin, sessionDevPlugin, sessionStakePlugin, gamePlugin];

describe('session-stake manifest', () => {
  it('is structurally valid', () => {
    expect(checkManifestShape(sessionStakePlugin)).toEqual([]);
  });

  it('declares stake.adapter so the game can hand it its book adapter', () => {
    const point = sessionStakePlugin.points?.[POINT_STAKE_ADAPTER];
    expect(point).toBeDefined();
    expect(point!.arity).toBe('one');
    expect(point!.phase).toBe('runtime');
  });

  it('activates on a stake build target, not by default', () => {
    const c = sessionStakePlugin.contributes![POINT_SESSION_PROVIDER][0];
    expect(c.activateWhen).toEqual({ buildTarget: 'stake' });
  });
});

describe('session-stake selection', () => {
  it('loses to dev on an ordinary launch', () => {
    const { plan, diagnostics } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play' },
      kernelVersion: '0.1.0',
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id))
      .toEqual(['dev']);
  });

  it('wins on a stake build', () => {
    const { plan, diagnostics } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id))
      .toEqual(['stake']);
  });

  it('reports a stake launch with no adapter contributed', () => {
    const { diagnostics } = resolvePlan({
      project: {
        plugins: { '@e8/host': { version: '*' }, '@e8/session-stake': { version: '*' } },
      },
      manifests: [hostPlugin, sessionStakePlugin],
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    // stake.adapter is arity:'one' and nothing fills it — the kernel's no-activation error fires,
    // which is exactly the white-screen case it was added for.
    expect(diagnostics.some((d) => d.code === 'resolve/no-activation' && d.pointId === POINT_STAKE_ADAPTER))
      .toBe(true);
  });

  it('installs a StakeBridge built from the game-supplied adapter', async () => {
    const made = vi.fn();
    const { plan } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    const { instance } = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    const installed = await instance!.value({
      url: 'https://game.example/play?sessionID=abc',
      buildTarget: 'stake',
      settings: { label: '' },
      plan,
      loadStakeBridge: async () => class {
        constructor(public opts: unknown) { made(opts); }
        async ready() {}
        destroy() {}
      },
    } as never);
    // Exact object, not objectContaining — a regression that dropped bundle.adapter, computed the
    // wrong protocol, or forwarded the wrong url must fail this assertion, not slide through a
    // subset match.
    expect(made).toHaveBeenCalledWith({
      devMode: true,
      protocol: 'https',
      adapter: { name: 'fake' },
      modeMap: { base: 'BASE' },
      gameId: 'my-slot',
      url: 'https://game.example/play?sessionID=abc',
    });
    await installed.dispose?.();
  });

  it('derives the protocol from the launch url, case-insensitively', async () => {
    const made = vi.fn();
    const { plan } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    const { instance } = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    // Upper-case scheme: URL schemes are case-insensitive per RFC 3986, and a naive
    // ctx.url.startsWith('http://') would misclassify this as https.
    const installed = await instance!.value({
      url: 'HTTP://game.example/play?sessionID=abc',
      buildTarget: 'stake',
      settings: { label: '' },
      plan,
      loadStakeBridge: async () => class {
        constructor(public opts: unknown) { made(opts); }
        async ready() {}
        destroy() {}
      },
    } as never);
    expect(made).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'http' }));
    await installed.dispose?.();
  });

  it('does not resolve until the bridge is ready', async () => {
    const order: string[] = [];
    const { plan } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    const { instance } = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    const installed = await instance!.value({
      url: 'https://game.example/play',
      buildTarget: 'stake',
      settings: { label: '' },
      plan,
      loadStakeBridge: async () => class {
        async ready() {
          await new Promise((r) => setTimeout(r, 5));
          order.push('ready');
        }
        destroy() {}
      },
    } as never);
    order.push('installed');
    expect(order).toEqual(['ready', 'installed']);
    expect(installed.dispose).toBeTypeOf('function');
  });

  it('surfaces a bridge that fails to become ready', async () => {
    const { plan } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    const { instance } = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    await expect(
      instance!.value({
        url: 'https://game.example/play',
        buildTarget: 'stake',
        settings: { label: '' },
        plan,
        loadStakeBridge: async () => class {
          async ready() {
            throw new Error('rgs unreachable');
          }
          destroy() {}
        },
      } as never),
    ).rejects.toThrow('rgs unreachable');
  });
});
