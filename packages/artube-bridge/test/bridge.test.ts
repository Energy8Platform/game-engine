import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ServerInit, ServerResult } from '../src/types';

const backend = vi.hoisted(() => ({
  connect: vi.fn(),
  play: vi.fn(),
  ack: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
}));

vi.mock('../src/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client')>();
  return {
    ...actual,
    ArtubeClient: class {
      constructor(_url: string) {}
      connect = backend.connect;
      play = backend.play;
      ack = backend.ack;
      on = backend.on;
      close = backend.close;
    },
  };
});

const { ArtubeBridge, betIndexOf } = await import('../src/bridge');

/** Минимальный window, чтобы MemoryChannel из game-sdk было где жить. */
function installWindow(): void {
  (globalThis as { window?: any }).window = (globalThis as { window?: any }).window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window.__casinoBridgeChannel;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

const INIT: ServerInit = {
  currency: 'USD', balance: 100, demo: false, frc: null,
  config: {
    betLevels: [0.1, 1, 5], defaultBetIndex: 1, currencyMinimalUnit: 0.01,
    autoSpinCounts: [10], locales: ['EN'],
    rtp: { isVisible: true, shownRtp: 96.5 },
    platformMaxWin: { isVisible: true, playerCurrencyValue: 870, baseCurrency: 'EUR' },
  },
};

function result(over: Partial<ServerResult> = {}): ServerResult {
  return {
    roundId: 'r1', action: 'spin', data: { stage: 'base_game' },
    winX: 2, totalWinX: 2, betAmount: 1, nextActions: ['spin'],
    spinsRemaining: 0, spinsPlayed: 1, balanceAfter: 102,
    creditPending: false, maxWinReached: false, ...over,
  };
}

const URL_LIVE = 'https://game.artube-888.live/?sessionId=s1&lang=ru&device=mobile';

describe('ArtubeBridge', () => {
  let bridge: { ready(): Promise<void>; destroy(): void };
  let sent: Array<{ type: string; payload: any }>;
  let channel: any;

  beforeEach(async () => {
    installWindow();
    backend.connect.mockReset().mockResolvedValue(INIT);
    backend.play.mockReset().mockResolvedValue(result());
    backend.ack.mockReset();
    backend.on.mockReset();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
  });

  afterEach(() => bridge?.destroy());

  it('индекс ставки ищется по betLevels', () => {
    expect(betIndexOf([0.1, 1, 5], 1)).toBe(1);
    expect(betIndexOf([0.1, 1, 5], 5)).toBe(2);
    expect(betIndexOf([0.1, 1, 5], 0.99)).toBe(1); // ближайший
  });

  it('на GAME_READY отдаёт INIT с балансом и ставками платформы', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    const init = sent.find((m) => m.type === 'INIT');
    expect(init).toBeDefined();
    expect(init!.payload.balance).toBe(100);
    expect(init!.payload.currency).toBe('USD');
    expect(init!.payload.config.betLevels).toEqual([0.1, 1, 5]);
    expect(init!.payload.lang).toBe('ru');
    expect(init!.payload.device).toBe('mobile');
  });

  it('PLAY_REQUEST переводится в индекс ставки', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    expect(backend.play).toHaveBeenCalledWith({ action: 'spin', betIndex: 1, params: undefined });
  });

  it('множители превращаются в суммы для показа', async () => {
    backend.play.mockResolvedValue(result({ winX: 2, totalWinX: 3, betAmount: 5 }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 5 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.totalWin).toBe(15); // totalWinX × betAmount
    expect(play!.payload.balanceAfter).toBe(102);
  });

  it('пока раунд не закрыт, отдаётся creditPending и прежний баланс', async () => {
    backend.play.mockResolvedValue(
      result({ balanceAfter: null, creditPending: true, nextActions: ['free_spin'] }),
    );
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.creditPending).toBe(true);
    expect(play!.payload.balanceAfter).toBe(100); // баланс из INIT, не выдуманный
    expect(play!.payload.nextActions).toEqual(['free_spin']);
  });

  it('PLAY_RESULT_ACK игры превращается в ack бэкенду', async () => {
    backend.play.mockResolvedValue(result({ creditPending: true, balanceAfter: null }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: 'r1', action: 'spin', totalWin: 2, balanceAfter: 100,
    });
    await flush();
    expect(backend.ack).toHaveBeenCalledWith('r1', 1);
  });

  it('ошибка бэкенда доезжает как PLAY_ERROR', async () => {
    const { ArtubeBackendError } = await import('../src/client');
    backend.play.mockRejectedValue(new ArtubeBackendError('InsufficientFunds', 'no money'));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const err = sent.find((m) => m.type === 'PLAY_ERROR');
    expect(err!.payload.code).toBe('InsufficientFunds');
  });

  it('достигнутый максвин помечается в сессии', async () => {
    backend.play.mockResolvedValue(result({ maxWinReached: true }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.session.maxWinReached).toBe(true);
  });

  it('GET_BALANCE отдаёт текущий баланс', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('GET_BALANCE', {});
    await flush();
    const bal = sent.find((m) => m.type === 'BALANCE_UPDATE');
    expect(bal!.payload.balance).toBe(100);
  });

  it('GET_STATE без незакрытого раунда отдаёт пустую сессию', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('GET_STATE', {});
    await flush();
    const state = sent.find((m) => m.type === 'STATE_RESPONSE');
    expect(state!.payload.session).toBeNull();
  });

  it('незакрытый раунд из init доступен игре через INIT.session и GET_STATE', async () => {
    backend.connect.mockResolvedValue({
      ...INIT,
      resume: result({ action: 'free_spin', creditPending: true, balanceAfter: null, spinsPlayed: 2 }),
    });
    bridge.destroy();
    installWindow();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    // Сводка приходит прямо на INIT (как sdk.ready().session)...
    const init = sent.find((m) => m.type === 'INIT');
    expect(init).toBeDefined();
    expect(init!.payload.session).toMatchObject({ spinsPlayed: 2, completed: false });

    // ...а полный снимок раунда — по запросу через GET_STATE, тот самый канал,
    // которым `createSlotGame`'s `offerResume()` реально пользуется. Раньше
    // мост толкал непрошеный PLAY_RESULT, которого CasinoGameSDK никогда не
    // слушает вне активного play() — эта ветка была мертва end-to-end.
    channel.sendToHost('GET_STATE', {});
    await flush();
    const state = sent.find((m) => m.type === 'STATE_RESPONSE');
    expect(state).toBeDefined();
    expect(state!.payload.session.roundId).toBe('r1');
    expect(state!.payload.session.action).toBe('free_spin');
  });

  it('игра через настоящий CasinoGameSDK узнаёт о незакрытом раунде через getState() и подтверждает его верным курсором', async () => {
    backend.connect.mockResolvedValue({
      ...INIT,
      resume: result({ action: 'free_spin', creditPending: true, balanceAfter: null, spinsPlayed: 2 }),
    });
    bridge.destroy();
    installWindow();
    const { MemoryChannel, CasinoGameSDK } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();

    // No raw channel inspection from here on — drive the real guest-side SDK,
    // the same way an actual game does.
    const sdk = new CasinoGameSDK({ devMode: true });
    const initData = await sdk.ready();
    expect(initData.session?.spinsPlayed).toBe(2);

    const snap = await sdk.getState();
    expect(snap).not.toBeNull();
    expect(snap!.roundId).toBe('r1');
    expect(snap!.action).toBe('free_spin');

    sdk.playAck(snap!);
    await flush();
    // Server expects `state.cursor + 1` for the ack (see artube-server's ws.ts);
    // for a resumed round that's spinsPlayed, NOT spinsPlayed - 1.
    expect(backend.ack).toHaveBeenCalledWith('r1', 2);

    sdk.destroy();
  });

  it('в демо баланс ведёт клиент', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null });
    backend.play.mockResolvedValue(result({ balanceAfter: null, winX: 3, totalWinX: 3, betAmount: 1 }));
    bridge.destroy();
    installWindow();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game', demoBalance: 50 });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.balanceAfter).toBe(52); // 50 − 1 ставка + 3 выигрыш
  });
});
