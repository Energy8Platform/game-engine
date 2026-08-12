// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { classifyArtubeLaunch } from '@energy8platform/artube-bridge/detect';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { CreateSlotGameOptions } from '@/host/types';
import type { PixiShellConfig, Shell } from '@energy8platform/shell/pixi';

/**
 * What the host derives from an Artube `INIT` for the shell: the bet ladder, the per-session
 * currency, and the platform's default bet. These are read from `initData` fields the real
 * `ArtubeBridge` emits (`config.betLevels`, `config.artube.defaultBetIndex`, top-level `currency`
 * — see artube-bridge's `onGameReady`), and they are the numbers the player is charged and shown,
 * so they are driven through the REAL createSlotGame + REAL buildShellConfig here.
 *
 * `shellFactory` (a supported public option) captures the fully-resolved shell config instead of
 * mounting the Pixi shell; GameApplication is stubbed because the real one drives Pixi.
 */

let shellConfig: PixiShellConfig | null = null;
/** The INIT payload the stubbed GameApplication hands back as `game.initData` (the real one gets it
 *  from the SDK handshake). Set per test by `boot()`. */
let initDataFixture: unknown = null;

/** Minimal Shell the host can drive: it only needs the methods the boot path calls. */
function fakeShell(): Shell {
  const noop = (): void => {};
  return {
    state: { turbo: 0 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    on: noop,
    off: noop,
    setVisible: noop,
    setBalance: noop,
    setWin: noop,
    setBusy: noop,
    setMode: noop,
    setFreeSpins: noop,
    setBonus: noop,
    setAutoplay: noop,
    openModal: noop,
    closeModal: noop,
    openReplay: noop,
    t: (s: string) => s,
    formatWin: (v: number) => String(v),
    destroy: noop,
  } as unknown as Shell;
}

const startCalls: string[] = [];

vi.mock('@/core', () => ({
  GameApplication: class {
    app = { screen: { width: 1920, height: 1080 }, ticker: { start() {}, stop() {} } };
    uiLayer = new Container();
    audio = {
      muteAll() {}, unmuteAll() {}, setVolume() {}, duckMusic() {}, unduckMusic() {},
      play() {}, playMusic() {}, stopMusic() {},
    };
    scenes = {
      register: () => {},
      goto: async () => {},
      on: () => {},
      current: undefined,
      root: { eventMode: 'auto', on: () => {} },
    };
    platformSession = {
      on: () => {},
      play: async () => ({}),
      playAck: () => {},
      getState: async () => null, // no unfinished round → no resume modal
    };
    initData = initDataFixture;
    on(): void {}
    async start(scene: string): Promise<void> {
      startCalls.push(scene);
    }
  },
}));

const model = {
  spec: {
    id: 'test-slot',
    currency: 'EUR',
    betLevels: [1, 5, 10],
    // Deliberately NOT a rung of the Artube ladders used below: if the host ignored Artube's
    // defaultBetIndex, this (snapped) value would show up instead, and the assertions would fail.
    defaultBet: 5,
    grid: { cols: 5, rows: 3 },
    mechanic: 'lines',
    actions: { spin: { role: 'base', cost: 1 } },
    symbols: [],
  },
  modeMap: { spin: 'BASE' },
  mathModes: [],
  paytable: { symbols: [] },
} as unknown as GameModel;

/** The `initData` an Artube launch produces, as ArtubeBridge builds it. */
function artubeInitData(over: {
  betLevels?: number[];
  defaultBetIndex?: number;
  currency?: string;
}): unknown {
  return {
    balance: 100,
    currency: over.currency ?? 'RUB',
    lang: 'ru',
    config: {
      id: 'test-slot',
      type: 'slot',
      betLevels: over.betLevels,
      demo: false,
      artube: { defaultBetIndex: over.defaultBetIndex },
    },
  };
}

const load = async () => ({
  classifyArtubeLaunch,
  ArtubeBridge: class {
    async ready(): Promise<void> {}
    destroy(): void {}
  },
});

/** Boot the REAL createSlotGame against the given launch INIT, capturing the resolved shell config. */
async function boot(
  initData: unknown,
  over: Partial<CreateSlotGameOptions> = {},
): Promise<unknown> {
  initDataFixture = initData;
  const { createSlotGame } = await import('@/host/createSlotGame');
  return createSlotGame({
    model,
    normalize: (r: unknown) => r,
    scenes: [{ key: 'game', scene: class {} }],
    manifest: { bundles: [] },
    shell: {},
    shellFactory: (cfg: PixiShellConfig) => {
      shellConfig = cfg;
      return fakeShell();
    },
    artube: { load },
    ...over,
  } as unknown as CreateSlotGameOptions);
}

function launchAt(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, protocol: url.protocol, reload: () => {} },
  });
}

const ARTUBE = 'https://test-slot.artube-888.live/?sessionId=abc-123&lang=ru';
const DEV = 'http://localhost:3000/';

beforeEach(() => {
  shellConfig = null;
  initDataFixture = null;
  startCalls.length = 0;
  delete (window as unknown as Record<string, unknown>).__e8SlotBooted__;
  document.body.innerHTML = '';
});

describe('createSlotGame: what an Artube INIT drives on the shell', () => {
  it("uses Artube's defaultBetIndex — an INDEX into the platform ladder, not an amount", async () => {
    launchAt(ARTUBE);
    await boot(artubeInitData({ betLevels: [0.2, 0.5, 1, 2], defaultBetIndex: 2 }));
    expect(shellConfig!.availableBets).toEqual([0.2, 0.5, 1, 2]); // platform ladder, not the spec's
    // Index 2 → 1. Treating the index AS an amount would give 2; the spec default would give 1's
    // neighbour 0.2. Both are wrong prices for the first spin.
    expect(shellConfig!.defaultBet).toBe(1);
    expect(shellConfig!.currentBet).toBe(1);
  });

  it('an out-of-range defaultBetIndex falls back to a real rung, never undefined', async () => {
    launchAt(ARTUBE);
    await boot(artubeInitData({ betLevels: [0.2, 0.5, 1], defaultBetIndex: 99 }));
    // `betLevels[99]` is undefined; the bet the player is charged must not be. The fallback is the
    // spec's preferred bet SNAPPED onto the platform ladder, so it is always selectable/payable.
    expect(shellConfig!.defaultBet).toBeTypeOf('number');
    expect(Number.isFinite(shellConfig!.defaultBet)).toBe(true);
    expect(shellConfig!.availableBets).toContain(shellConfig!.defaultBet);
  });

  it("shows the SESSION's currency from initData, outranking the spec's static code", async () => {
    launchAt(ARTUBE);
    await boot(artubeInitData({ betLevels: [1, 2], defaultBetIndex: 0, currency: 'RUB' }));
    // The platform picks the currency per session; the spec says EUR. A RUB player must not be
    // shown €. Resolved through the same symbol table as Stake.
    expect(shellConfig!.currency.symbol).toBe('₽');
  });

  it('a non-Artube launch keeps the spec currency (the override is gated on the launch)', async () => {
    launchAt(DEV);
    // Same initData shape, but this is not an Artube launch — the spec's EUR must win.
    await boot(artubeInitData({ currency: 'RUB' }));
    expect(shellConfig!.currency.symbol).toBe('€');
  });

  it('REFUSES an Artube launch whose INIT carried no bet ladder', async () => {
    launchAt(ARTUBE);
    // The wire carries a bet INDEX and the bridge snaps to the nearest rung, so falling back to the
    // spec ladder would silently charge a price the bar never showed. Refuse instead.
    await expect(boot(artubeInitData({ betLevels: [] }))).rejects.toThrow(/betLevels/);
    expect(document.body.textContent).toMatch(/bet levels/i);
    expect(shellConfig).toBeNull(); // never reached the shell
  });

  it('a dev launch with no ladder still falls back to the spec (non-Artube games unaffected)', async () => {
    launchAt(DEV);
    await boot({ balance: 10, config: {} });
    expect(shellConfig!.availableBets).toEqual([1, 5, 10]); // the spec's ladder
    expect(startCalls).toEqual(['game']);
  });
});
