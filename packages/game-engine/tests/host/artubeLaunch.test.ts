// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { CreateSlotGameOptions } from '@/host/types';

/**
 * Host selection for Artube, driven through the REAL `createSlotGame` — not a re-implementation of
 * its wiring. The security gate is the point: a launch that claims an Artube session but carries no
 * id must be REFUSED, never silently downgraded to the offline/dev bridge (free spins). Removing the
 * gate from createSlotGame makes the first test fail, because the boot then continues into
 * GameApplication instead of rejecting.
 *
 * GameApplication is stubbed (the real one drives Pixi, which hangs headless); the launch
 * CLASSIFIER is real (`@energy8platform/artube-bridge/detect`, aliased to source in vitest.config),
 * so the URLs below are the ones the platform actually produces. The bridge itself is stubbed to
 * keep the test off a WebSocket — it is a dependency, not the input under test.
 */

/** Every GameApplication the boot constructed — empty means the boot never got past the gate. */
const constructed: { sdk?: { devMode?: boolean } }[] = [];
/** Every ArtubeBridge the boot constructed, with the options it was given. */
const bridges: Record<string, unknown>[] = [];

vi.mock('@/core', () => ({
  GameApplication: class {
    scenes = { register: () => {}, goto: async () => {}, on: () => {}, current: undefined, root: {} };
    constructor(cfg: { sdk?: { devMode?: boolean } }) {
      constructed.push(cfg);
    }
    async start(): Promise<void> {
      // Stand-in for the real boot: proves control reached GameApplication (i.e. was NOT blocked).
      throw new Error('STUB_START');
    }
  },
}));

vi.mock('@energy8platform/artube-bridge', () => ({
  ArtubeBridge: class {
    constructor(options: Record<string, unknown>) {
      bridges.push(options);
    }
    async ready(): Promise<void> {}
  },
}));

const model = {
  spec: { id: 'test-slot', betLevels: [1, 2], defaultBet: 1, actions: {} },
  modeMap: { spin: 'BASE' },
} as unknown as GameModel;

const opts = (over: Partial<CreateSlotGameOptions> = {}): CreateSlotGameOptions =>
  ({
    model,
    normalize: (r: unknown) => r,
    scenes: [{ key: 'game', scene: class {} }],
    manifest: { bundles: [] },
    ...over,
  }) as unknown as CreateSlotGameOptions;

/** Point `location.href` (what createSlotGame classifies) at a launch URL. */
function launchAt(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, protocol: url.protocol, reload: () => {} },
  });
}

beforeEach(() => {
  constructed.length = 0;
  bridges.length = 0;
  // createSlotGame boots at most once per page; reset its guard between tests.
  delete (window as unknown as Record<string, unknown>).__e8SlotBooted__;
  document.body.innerHTML = '';
});

describe('createSlotGame: Artube host selection', () => {
  it('REFUSES a launch that claims an Artube session with a blank sessionId', async () => {
    launchAt('https://test-slot.artube-888.live/?sessionId=&lang=ru');
    const { createSlotGame } = await import('@/host/createSlotGame');

    await expect(createSlotGame(opts({ artube: {} }))).rejects.toThrow(/refusing to run/i);

    // The whole point of the gate: the boot must STOP, not continue into an offline/dev bridge.
    expect(constructed).toHaveLength(0);
    expect(bridges).toHaveLength(0);
    // The player is told why, instead of staring at a dead canvas.
    expect(document.body.textContent).toMatch(/relaunch the game/i);
  });

  it('loads the bridge on a real Artube launch and puts the SDK in-process', async () => {
    launchAt('https://test-slot.artube-888.live/?sessionId=abc-123&lang=ru&device=mobile');
    const { createSlotGame } = await import('@/host/createSlotGame');

    await expect(createSlotGame(opts({ artube: { demoBalance: 500 } }))).rejects.toThrow(
      'STUB_START',
    );

    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({
      devMode: true,
      gameId: 'test-slot',
      demoBalance: 500,
      url: 'https://test-slot.artube-888.live/?sessionId=abc-123&lang=ru&device=mobile',
    });
    // Without devMode the SDK would postMessage an outer host that isn't there — the in-process
    // bridge would never be reached.
    expect(constructed).toHaveLength(1);
    expect(constructed[0].sdk?.devMode).toBe(true);
  });

  it('leaves a genuine dev launch (no sessionId) alone — no bridge, no block', async () => {
    launchAt('http://localhost:3000/');
    const { createSlotGame } = await import('@/host/createSlotGame');

    await expect(createSlotGame(opts({ artube: {} }))).rejects.toThrow('STUB_START');

    expect(bridges).toHaveLength(0);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].sdk?.devMode).toBe(false); // plain offline boot, opts.dev unset
  });

  it('does not classify anything when the game did not opt into Artube', async () => {
    // Same blank-sessionId URL as the first test: without `artube`, the game has no Artube path to
    // protect, so the gate must not fire (and must not block an unrelated game).
    launchAt('https://some-game.example/?sessionId=');
    const { createSlotGame } = await import('@/host/createSlotGame');

    await expect(createSlotGame(opts())).rejects.toThrow('STUB_START');
    expect(constructed).toHaveLength(1);
  });
});
