// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { Shell, PixiShellConfig } from '@energy8platform/shell/pixi';

/**
 * The host's starting bet MUST be the one /wallet/authenticate handed us, not the spec's.
 *
 * createSlotGame() normally can't be unit-tested because GameApplication.init() drives Pixi and
 * hangs headless — so we stub GameApplication itself and inject a fake shell via `shellFactory`.
 * Everything between (bet resolution, the shell wiring, the play call) is the REAL host.
 *
 * Regression: the host used to seed `currentBet` from `spec.defaultBet` and only ever update it
 * from the shell's `betChange` event — which the shell emits solely when the PLAYER moves the bet.
 * So the first spin of every session played at the spec's bet while the bar showed the RGS one:
 * an "out of range [50, 750000]" rejection on ARS, and a silent overcharge everywhere else.
 */

const plays: Array<{ action: string; bet: number }> = [];
let sceneCurrent: { scene: unknown } | null = null;
let initDataFixture: unknown = null;

class StubGameApplication {
  app = { screen: { width: 1280, height: 720 }, ticker: { stop() {}, start() {} } };
  uiLayer = new Container();
  audio = {
    play() {}, playMusic() {}, stopMusic() {}, duckMusic() {}, unduckMusic() {},
    muteAll() {}, unmuteAll() {}, setVolume() {},
  };
  scenes = {
    root: new Container(),
    register: () => {},
    goto: () => Promise.resolve(),
    on: () => {},
    get current() { return sceneCurrent; },
  };
  platformSession = {
    on: () => {},
    play: (p: { action: string; bet: number }) => {
      plays.push({ action: p.action, bet: p.bet });
      return Promise.resolve({ totalWin: 0, complete: true });
    },
    playAck: () => Promise.resolve(),
  };
  get initData() { return initDataFixture; }
  on() {}
  start() { return Promise.resolve(); }
}

vi.mock('../../src/core', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  GameApplication: StubGameApplication,
}));

// Pretend every launch that asks for `stake` IS a valid Stake launch, and skip the real bridge
// (it would try to reach an RGS). Only the tests that pass `opts.stake` reach either of these.
vi.mock('@energy8platform/stake-bridge/detect', () => ({ classifyStakeLaunch: () => 'stake' }));
vi.mock('@energy8platform/stake-bridge', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  StakeBridge: class {
    isReplay = false;
    ready() { return Promise.resolve(); }
  },
}));

const { createSlotGame } = await import('../../src/host/createSlotGame');

const model = {
  spec: {
    // A EUR-shaped spec: this default is meaningless on a high-denomination currency.
    betLevels: [0.2, 0.4, 1, 2], defaultBet: 1, currency: 'EUR', maxWin: 5000,
    grid: { cols: 5, rows: 3 }, mechanic: 'lines',
    actions: {
      spin: { role: 'base' },
      buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins' },
    },
  },
  modeMap: {},
  paytable: { symbols: [] },
} as unknown as GameModel;

/** A fake Shell: records the config it was handed and lets the test emit shell events. */
function fakeShell() {
  const handlers = new Map<string, ((p: never) => void)[]>();
  let config: PixiShellConfig | null = null;
  const shell = {
    on: (e: string, fn: (p: never) => void) => {
      handlers.set(e, [...(handlers.get(e) ?? []), fn]);
    },
    t: (s: string) => s,
    state: { turbo: 0, bet: 0, balance: 0 },
    setVisible() {}, setBalance() {}, setWin() {}, setBusy() {}, setMode() {}, setBet() {},
    setAutoplay() {}, setFreeSpins() {}, setBonus() {}, setActiveFeature() {},
    setBuyBonusEnabled() {}, openModal() {}, closeModal() {}, openReplay() {}, openBuyBonus() {},
    deactivateFeature() {}, destroy() {}, resize() {}, getMenuValue() {}, setMenuValue() {},
  } as unknown as Shell;
  const factory = (cfg: PixiShellConfig) => { config = cfg; return shell; };
  const emit = (e: string, p?: unknown) => (handlers.get(e) ?? []).forEach((fn) => fn(p as never));
  return { factory, emit, cfg: () => config! };
}

/** Boot the real host with an authenticate payload on initData.config. */
async function boot(config: Record<string, unknown> | undefined, stake = false) {
  const shell = fakeShell();
  initDataFixture = { balance: 1_000_000, config };
  const scene = { async onSpin() {} };
  sceneCurrent = { scene };
  const handle = await createSlotGame({
    model,
    normalize: () => ({ totalWin: 0 }) as never,
    scenes: [{ key: 'game', scene: class {} as never }],
    manifest: {} as never,
    shell: {},
    shellFactory: shell.factory,
    ...(stake ? { stake: { adapter: {} as never }, onFatalError: () => {} } : {}),
  });
  return { ...shell, handle };
}

/** Stake's ARS ladder: minBet 50 major. A bet of 1 is rejected by the bridge before /bet/play. */
const ARS = {
  betLevels: [50, 100, 250, 500, 1000],
  stake: { minBet: 50, maxBet: 750000, defaultBetLevel: 50 },
  currency: { code: 'ARS', symbol: '$', decimals: 2 },
};

describe('createSlotGame — starting bet comes from /wallet/authenticate, not the spec', () => {
  beforeEach(() => {
    plays.length = 0;
    sceneCurrent = null;
    delete (window as unknown as Record<string, unknown>).__e8SlotBooted__;
    document.body.innerHTML = '';
  });

  it('spins at the RGS default bet on the FIRST spin (no betChange yet)', async () => {
    const { emit, cfg } = await boot(ARS);
    expect(cfg().currentBet).toBe(50); // what the player sees on the bar
    emit('spin');
    await vi.waitFor(() => expect(plays.length).toBe(1));
    expect(plays[0]).toEqual({ action: 'spin', bet: 50 }); // was 1 → "out of range [50, 750000]"
  });

  it('charges the RGS default for a bonus buy on the first interaction', async () => {
    const { emit } = await boot(ARS);
    emit('buyBonusSelect', { id: 'buy_bonus' });
    await vi.waitFor(() => expect(plays.length).toBe(1));
    // cost 100 × bet 50 — not 100 × the spec's 1.
    expect(plays[0]).toEqual({ action: 'buy_bonus', bet: 50 });
  });

  it('still follows the player once they move the bet', async () => {
    const { emit } = await boot(ARS);
    emit('betChange', 250);
    emit('spin');
    await vi.waitFor(() => expect(plays.length).toBe(1));
    expect(plays[0]).toEqual({ action: 'spin', bet: 250 });
  });

  // The dev harness answers authenticate with defaultBetLevel = minBet = betLevels[0] (0.2),
  // which is IN range — so the old bug was silent here: bar 0.2, wallet debited 1.0.
  it('honours the dev harness default (silent 5x overcharge regression)', async () => {
    const { emit, cfg } = await boot({
      betLevels: [0.2, 0.4, 1, 2],
      stake: { minBet: 0.2, maxBet: 100, defaultBetLevel: 0.2 },
    });
    expect(cfg().currentBet).toBe(0.2);
    emit('spin');
    await vi.waitFor(() => expect(plays.length).toBe(1));
    expect(plays[0]).toEqual({ action: 'spin', bet: 0.2 }); // was 1
  });

  it('falls back to the spec default when there is no authenticate payload (dev/devBridge)', async () => {
    const { emit } = await boot(undefined);
    emit('spin');
    await vi.waitFor(() => expect(plays.length).toBe(1));
    expect(plays[0]).toEqual({ action: 'spin', bet: 1 });
  });

  // The spec ladder is EUR-shaped. Silently using it on a Stake launch means every bet is priced
  // in the wrong currency — better to refuse where the cause is still visible.
  it('refuses to boot a Stake launch that brought no bet ladder', async () => {
    await expect(boot({ stake: { minBet: 50, maxBet: 750000 } }, true)).rejects.toThrow(
      /no config\.betLevels/,
    );
  });

  it('boots a Stake launch that DID bring a ladder', async () => {
    const { cfg } = await boot(ARS, true);
    expect(cfg().currentBet).toBe(50);
  });
});
