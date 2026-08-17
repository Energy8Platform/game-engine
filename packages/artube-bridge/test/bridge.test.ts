import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ServerInit, ServerResult } from '../src/types';

const backend = vi.hoisted(() => ({
  connect: vi.fn(),
  play: vi.fn(),
  ack: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
  /** Адреса, с которыми мост собрал клиента — см. describe «адрес сокета». */
  urls: [] as string[],
}));

vi.mock('../src/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client')>();
  return {
    ...actual,
    ArtubeClient: class {
      constructor(url: string) {
        backend.urls.push(url);
      }
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

  it('точность валюты доезжает до игры — иначе она округляет по своему усмотрению', async () => {
    // Сервер её присылает, а бридж раньше выбрасывал: игра оставалась с двумя
    // знаками по умолчанию и врала на любой валюте, у которой шаг не сотые.
    channel.sendToHost('GAME_READY', {});
    await flush();
    const init = sent.find((m) => m.type === 'INIT');
    expect(init!.payload.config.artube.currencyMinimalUnit).toBe(0.01);
  });

  it('код валюты нормализуется в ISO-регистр — GamesAPI шлёт его строчными', async () => {
    // Живая песочница отдаёт `"usd"`; по такому коду lookupCurrency промахивается
    // и игрок видит «1 000 000.00 usd» вместо «$1 000 000.00».
    backend.connect.mockResolvedValue({ ...INIT, currency: 'usd' });
    bridge.destroy();
    sent.length = 0;
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    expect(sent.find((m) => m.type === 'INIT')!.payload.currency).toBe('USD');

    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    expect(sent.find((m) => m.type === 'PLAY_RESULT')!.payload.currency).toBe('USD');
  });

  it('демо-сессия (currency: null) остаётся FUN', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null });
    bridge.destroy();
    sent.length = 0;
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    expect(sent.find((m) => m.type === 'INIT')!.payload.currency).toBe('FUN');
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

  it('баланс открывшегося раунда принимается, хотя выигрыш ещё не зачислен', async () => {
    // Открывающий сегмент сложного раунда несёт И реальный баланс (ставка
    // списана на OpenRound), И `creditPending`. Флаги независимы: баланс
    // обязан обновиться, а раунд — остаться незакрытым.
    backend.play.mockResolvedValue(
      result({ balanceAfter: 99, creditPending: true, nextActions: ['free_spin'], spinsRemaining: 8 }),
    );
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'buy_bonus', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.balanceAfter).toBe(99);
    expect(play!.payload.creditPending).toBe(true);
    expect(play!.payload.session.completed).toBe(false);

    // getBalance отвечает тем же числом — кеш моста обновился.
    sent.length = 0;
    channel.sendToHost('GET_BALANCE', {});
    await flush();
    expect(sent.find((m) => m.type === 'BALANCE_UPDATE')!.payload.balance).toBe(99);

    // Незакрытый раунд по-прежнему предлагается к восстановлению: снимок
    // держит `creditPending`, а не «нет баланса».
    sent.length = 0;
    channel.sendToHost('GET_STATE', {});
    await flush();
    expect(sent.find((m) => m.type === 'STATE_RESPONSE')!.payload.session).not.toBeNull();
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

  it('в демо баланс ведёт клиент, даже когда сервер шлёт свой (нереальный для игрока) balanceAfter', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null });
    // Реалистичная форма: `artube-server`'s `createDemoApi` (see
    // `src/session/demo.ts`) settles a demo round with a real, non-null
    // `balance` — it's a per-connection stand-in seeded from the server's
    // own `startingDemoBalance` (1000 by default), unrelated to whatever
    // `demoBalance` this bridge instance was configured with. 1002 here
    // stands in for that server-side number to prove the wallet, not the
    // wire value, wins.
    backend.play.mockResolvedValue(result({ balanceAfter: 1002, winX: 3, totalWinX: 3, betAmount: 1 }));
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
    expect(play!.payload.balanceAfter).not.toBe(1002); // не серверная заглушка
  });

  it('в демо стартовый INIT.balance берётся из кошелька, а не из серверной заглушки', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null, balance: 1000 });
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
    const init = sent.find((m) => m.type === 'INIT');
    expect(init!.payload.balance).toBe(50); // demoBalance, не серверные 1000
  });

  it('в демо реконнект не подмешивает баланс серверной per-connection заглушки', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null, balance: 1000 });
    backend.play.mockResolvedValue(result({ balanceAfter: 900, winX: 3, totalWinX: 3, betAmount: 1 }));
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
    await flush(); // wallet is now 52 (50 − 1 + 3)
    sent = [];

    // Simulate a reconnect: the server hands back a brand-new per-connection
    // demo stand-in, reset to its own starting balance — the exact scenario
    // `createDemoApi` produces on every new WS connection.
    const reconnectInit = backend.on.mock.calls
      .filter(([event]: [string]) => event === 'init')
      .pop()?.[1];
    expect(reconnectInit).toBeDefined();
    reconnectInit({ ...INIT, demo: true, currency: null, balance: 1000 });
    await flush();

    const balanceUpdate = sent.find((m) => m.type === 'BALANCE_UPDATE');
    expect(balanceUpdate!.payload.balance).toBe(52); // кошелёк, не сброшенные 1000

    channel.sendToHost('GET_BALANCE', {});
    await flush();
    const getBalance = sent.filter((m) => m.type === 'BALANCE_UPDATE').pop();
    expect(getBalance!.payload.balance).toBe(52);
  });

  it('свежий init без resume обновляет баланс и убирает снимок закрытого раунда', async () => {
    // Так выглядит хвост `RoundAlreadySettled`: раунд досчитали не у нас,
    // сервер шлёт вслед за ошибкой свежий init (см. artube-server's ws.ts).
    // Мост обязан показать новый баланс — на getBalance он отвечает из кеша —
    // и забыть снимок раунда, иначе getState() предложит игре доигрывать уже
    // закрытый раунд.
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
    channel.sendToHost('GET_STATE', {});
    await flush();
    expect(sent.find((m) => m.type === 'STATE_RESPONSE')!.payload.session).not.toBeNull();
    sent = [];

    const reconnectInit = backend.on.mock.calls
      .filter(([event]: [string]) => event === 'init')
      .pop()?.[1];
    reconnectInit({ ...INIT, balance: 106 });
    await flush();

    expect(sent.find((m) => m.type === 'BALANCE_UPDATE')!.payload.balance).toBe(106);
    channel.sendToHost('GET_BALANCE', {});
    channel.sendToHost('GET_STATE', {});
    await flush();
    expect(sent.filter((m) => m.type === 'BALANCE_UPDATE').pop()!.payload.balance).toBe(106);
    expect(sent.find((m) => m.type === 'STATE_RESPONSE')!.payload.session).toBeNull();
  });

  it('в демо серверный push balance (balanceChanged) игнорируется', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null, balance: 1000 });
    backend.play.mockResolvedValue(result({ balanceAfter: 900, winX: 3, totalWinX: 3, betAmount: 1 }));
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
    await flush(); // wallet is now 52
    sent = [];

    const balanceCb = backend.on.mock.calls
      .filter(([event]: [string]) => event === 'balance')
      .pop()?.[1];
    expect(balanceCb).toBeDefined();
    // Причина здесь — `correction`, то есть ровно та, которую вне демо мост
    // обязан переслать (см. describe ниже). Так проверка ловит именно
    // старшинство кошелька, а не случайно проходит потому, что причину и так
    // подавили бы.
    balanceCb({ balance: 12345, reason: 'correction' });
    await flush();

    expect(sent.find((m) => m.type === 'BALANCE_UPDATE')).toBeUndefined();
    channel.sendToHost('GET_BALANCE', {});
    await flush();
    const getBalance = sent.find((m) => m.type === 'BALANCE_UPDATE');
    expect(getBalance!.payload.balance).toBe(52);
  });

  /**
   * Пуш баланса разбирается по `reason` (`balance-changed.md`): движение денег
   * внутри раунда игре уже принёс ответ раунда — и принёс вовремя, — а пуш
   * приходит по расписанию платформы, посреди анимации выигрыша. Пересылаем
   * только то, чего ответ раунда рассказать не может.
   */
  describe('пуш баланса разбирается по причине', () => {
    const balanceCb = () =>
      backend.on.mock.calls.filter(([event]: [string]) => event === 'balance').pop()?.[1];

    /** Открывает сложный раунд: ставка списана (99), выигрыш ещё не зачислен. */
    const openRound = async (): Promise<void> => {
      backend.play.mockResolvedValue(
        result({ balanceAfter: 99, creditPending: true, nextActions: ['free_spin'], spinsRemaining: 8 }),
      );
      channel.sendToHost('GAME_READY', {});
      await flush();
      channel.sendToHost('PLAY_REQUEST', { action: 'buy_bonus', bet: 1 });
      await flush();
      sent.length = 0;
    };

    const getBalance = async (): Promise<number> => {
      channel.sendToHost('GET_BALANCE', {});
      await flush();
      return sent.filter((m) => m.type === 'BALANCE_UPDATE').pop()!.payload.balance;
    };

    it('round_win в идущем раунде до игры не доезжает', async () => {
      await openRound();
      balanceCb()({ balance: 150, reason: 'round_win' });
      await flush();
      expect(sent.find((m) => m.type === 'BALANCE_UPDATE')).toBeUndefined();
    });

    it('round_bet тоже не доезжает — ставку назвал ответ OpenRound', async () => {
      await openRound();
      balanceCb()({ balance: 42, reason: 'round_bet' });
      await flush();
      expect(sent.find((m) => m.type === 'BALANCE_UPDATE')).toBeUndefined();
    });

    it('подавленный пуш не трогает и собственный баланс моста', async () => {
      // Ставку и выигрыш платформа объявляет двумя событиями; опоздавший
      // `round_bet` записал бы баланс ДО выигрыша поверх уже посчитанного.
      // Внутри раунда правду держит ответ раунда — GET_BALANCE отвечает им.
      await openRound();
      balanceCb()({ balance: 150, reason: 'round_win' });
      balanceCb()({ balance: 42, reason: 'round_bet' });
      await flush();
      expect(await getBalance()).toBe(99);
    });

    it('correction доезжает сразу — другого канала у неё нет', async () => {
      channel.sendToHost('GAME_READY', {});
      await flush();
      sent.length = 0;
      balanceCb()({ balance: 250, reason: 'correction' });
      await flush();
      expect(sent.find((m) => m.type === 'BALANCE_UPDATE')!.payload.balance).toBe(250);
      expect(await getBalance()).toBe(250);
    });

    it('bonus доезжает и посреди идущего раунда', async () => {
      await openRound();
      balanceCb()({ balance: 199, reason: 'bonus' });
      await flush();
      expect(sent.find((m) => m.type === 'BALANCE_UPDATE')!.payload.balance).toBe(199);
      expect(await getBalance()).toBe(199);
    });

    it('регистр и пробелы в причине не превращают её в незнакомую', async () => {
      await openRound();
      balanceCb()({ balance: 150, reason: ' Round_Win ' });
      await flush();
      expect(sent.find((m) => m.type === 'BALANCE_UPDATE')).toBeUndefined();
    });

    it('незнакомая причина пересылается, но пишется в консоль по разу на причину', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await openRound();
        balanceCb()({ balance: 300, reason: 'jackpot_payout' });
        balanceCb()({ balance: 301, reason: 'jackpot_payout' });
        await flush();
        expect(sent.filter((m) => m.type === 'BALANCE_UPDATE').map((m) => m.payload.balance)).toEqual(
          [300, 301],
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('jackpot_payout');
      } finally {
        warn.mockRestore();
      }
    });

    it('пуш без причины пересылается — недоказанно избыточное не глотаем', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await openRound();
        balanceCb()({ balance: 300 });
        await flush();
        expect(sent.find((m) => m.type === 'BALANCE_UPDATE')!.payload.balance).toBe(300);
      } finally {
        warn.mockRestore();
      }
    });
  });
});

/**
 * Адрес сокета: `${apiBase}/api/ws`, где `apiBase` — путь страницы запуска,
 * перевешенный под `/api` (см. `detect.test.ts`). Здесь проверяется вторая
 * половина: что мост действительно строит на нём адрес и переводит схему
 * http→ws.
 */
describe('адрес сокета', () => {
  const socketUrl = (opts: Record<string, unknown>): string => {
    backend.urls.length = 0;
    backend.connect.mockReset().mockResolvedValue(INIT);
    installWindow();
    const b = new ArtubeBridge({ devMode: true, gameId: 'my-game', ...opts });
    const url = backend.urls[0];
    b.destroy();
    return url;
  };

  it('прод: сокет уезжает на /api/<префикс>/api/ws — адрес снят с живого стенда', () => {
    expect(
      socketUrl({
        url:
          'https://dev.artube-888.live/artube-o7df8qem5k/' +
          '?sessionId=8f3daf8d-02f2-4d5d-b3f9-1f80fbcaa160&gameId=artube-o7df8qem5k',
      }),
    ).toBe(
      'wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws' +
        '?sessionId=8f3daf8d-02f2-4d5d-b3f9-1f80fbcaa160',
    );
  });

  it('дев: игра в корне — сокет в корне, http→ws', () => {
    expect(socketUrl({ url: 'http://localhost:5175/?sessionId=s1' })).toBe(
      'ws://localhost:5175/api/ws?sessionId=s1',
    );
  });

  it('явный apiBase перебивает вывод из URL (дев против чужого порта)', () => {
    expect(
      socketUrl({
        url: 'https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=s1',
        apiBase: 'http://localhost:8080',
      }),
    ).toBe('ws://localhost:8080/api/ws?sessionId=s1');
  });

  it('явный apiBase может сам нести префикс пути', () => {
    expect(
      socketUrl({ url: 'http://localhost:5173/?sessionId=s1', apiBase: 'http://localhost:8080/g1' }),
    ).toBe('ws://localhost:8080/g1/api/ws?sessionId=s1');
  });

  it('sessionId уезжает закодированным', () => {
    expect(socketUrl({ url: 'https://host/artube-x/?sessionId=a%2Fb%3Fc' })).toBe(
      'wss://host/api/artube-x/api/ws?sessionId=a%2Fb%3Fc',
    );
  });
});
