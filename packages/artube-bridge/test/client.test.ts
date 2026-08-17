import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { ArtubeClient, ArtubeBackendError } from '../src/client';

let wss: WebSocketServer;
let client: ArtubeClient;

const INIT = {
  t: 'init', currency: 'USD', balance: 100, demo: false, frc: null,
  config: {
    betLevels: [0.1, 1, 5], defaultBetIndex: 1, currencyMinimalUnit: 0.01,
    autoSpinCounts: [10], locales: ['EN'], rtp: { isVisible: false }, platformMaxWin: null,
  },
};

/** Поднять фейковый бэкенд игры. `onPlay` описывает реакцию на play/ack. */
async function startBackend(onMessage?: (msg: any, socket: any) => void) {
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify(INIT));
    socket.on('message', (raw) => onMessage?.(JSON.parse(raw.toString()), socket));
  });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;
}

afterEach(async () => {
  client?.close();
  await new Promise<void>((r) => wss?.close(() => r()));
});

describe('ArtubeClient', () => {
  it('коннект возвращает init', async () => {
    const url = await startBackend();
    client = new ArtubeClient(url);
    const init = await client.connect();
    expect(init.balance).toBe(100);
    expect(init.config.betLevels).toEqual([0.1, 1, 5]);
  });

  it('play разрешается ответом с тем же id', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({
        t: 'result', id: msg.id, roundId: 'r1', action: msg.action, data: { stage: 'base' },
        winX: 2, totalWinX: 2, betAmount: 1, nextActions: ['spin'],
        spinsRemaining: 0, spinsPlayed: 1, balanceAfter: 102,
        creditPending: false, maxWinReached: false,
      }));
    });
    client = new ArtubeClient(url);
    await client.connect();
    const res = await client.play({ action: 'spin', betIndex: 1 });
    expect(res.roundId).toBe('r1');
    expect(res.winX).toBe(2);
  });

  it('параллельные play не путаются', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      const delay = msg.action === 'slow' ? 50 : 5;
      setTimeout(() => socket.send(JSON.stringify({
        t: 'result', id: msg.id, roundId: msg.action, action: msg.action, data: {},
        winX: 0, totalWinX: 0, betAmount: 1, nextActions: [], spinsRemaining: 0,
        spinsPlayed: 1, balanceAfter: 1, creditPending: false, maxWinReached: false,
      })), delay);
    });
    client = new ArtubeClient(url);
    await client.connect();
    const [slow, fast] = await Promise.all([
      client.play({ action: 'slow', betIndex: 0 }),
      client.play({ action: 'fast', betIndex: 0 }),
    ]);
    expect(slow.roundId).toBe('slow');
    expect(fast.roundId).toBe('fast');
  });

  it('error с id отбивает конкретный play', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({
        t: 'error', id: msg.id, code: 'InsufficientFunds', message: 'no money',
      }));
    });
    client = new ArtubeClient(url);
    await client.connect();
    await expect(client.play({ action: 'spin', betIndex: 0 })).rejects.toMatchObject({
      name: 'ArtubeBackendError', code: 'InsufficientFunds',
    });
  });

  it('ack уходит на бэкенд', async () => {
    const seen: any[] = [];
    const url = await startBackend((msg) => seen.push(msg));
    client = new ArtubeClient(url);
    await client.connect();
    client.ack('r1', 2);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toContainEqual({ t: 'ack', roundId: 'r1', cursor: 2 });
  });

  it('balance и session_closed прокидываются подписчикам', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({ t: 'balance', balance: 77, reason: 'Win' }));
      socket.send(JSON.stringify({ t: 'session_closed', reason: 'timeout' }));
    });
    client = new ArtubeClient(url);
    const balances: number[] = [];
    let closedReason = '';
    client.on('balance', (p: { balance: number }) => balances.push(p.balance));
    client.on('sessionClosed', (p: { reason: string }) => { closedReason = p.reason; });
    await client.connect();
    void client.play({ action: 'spin', betIndex: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(balances).toEqual([77]);
    expect(closedReason).toBe('timeout');
  });

  it('обрыв связи отбивает висящие play', async () => {
    const url = await startBackend(() => {});
    client = new ArtubeClient(url);
    await client.connect();
    const pending = client.play({ action: 'spin', betIndex: 0 });
    wss.clients.forEach((c) => c.terminate());
    await expect(pending).rejects.toBeInstanceOf(ArtubeBackendError);
  });

  describe('кампания фри-раундов', () => {
    const FRC = {
      campaignId: 'camp-1', roundsLeft: 5, roundsTotal: 5, totalWin: 0,
      isComplete: false, bet: 1, betIndex: 1,
    };

    it('активация уходит кадром frc_activate и резолвится состоянием кампании', async () => {
      const seen: any[] = [];
      const url = await startBackend((msg, socket) => {
        seen.push(msg);
        if (msg.t !== 'frc_activate') return;
        socket.send(JSON.stringify({ t: 'frc', id: msg.id, ...FRC, status: 'active' }));
      });
      client = new ArtubeClient(url);
      await client.connect();
      const frc = await client.activateCampaign('camp-1');

      expect(frc.status).toBe('active');
      expect(frc.betIndex).toBe(1);
      expect(seen.at(-1)).toMatchObject({ t: 'frc_activate', campaignId: 'camp-1' });
    });

    it('отказ уходит кадром frc_decline', async () => {
      const seen: any[] = [];
      const url = await startBackend((msg, socket) => {
        seen.push(msg);
        if (msg.t !== 'frc_decline') return;
        socket.send(JSON.stringify({ t: 'frc', id: msg.id, ...FRC, status: 'declined' }));
      });
      client = new ArtubeClient(url);
      await client.connect();
      expect((await client.declineCampaign('camp-1')).status).toBe('declined');
      expect(seen.at(-1)).toMatchObject({ t: 'frc_decline', campaignId: 'camp-1' });
    });

    it('отказ бэкенда отбивает активацию кодом, а не висит', async () => {
      const url = await startBackend((msg, socket) => {
        if (msg.t !== 'frc_activate') return;
        socket.send(JSON.stringify({
          t: 'error', id: msg.id, code: 'FrcBetNotAllowed', message: 'bet is not in allowed_bets',
        }));
      });
      client = new ArtubeClient(url);
      await client.connect();
      await expect(client.activateCampaign('camp-1')).rejects.toMatchObject({
        name: 'ArtubeBackendError', code: 'FrcBetNotAllowed',
      });
    });

    it('кадр frc без id — это завершение кампании, приходит подписчику', async () => {
      const url = await startBackend((msg, socket) => {
        if (msg.t !== 'play') return;
        socket.send(JSON.stringify({
          t: 'frc', ...FRC, status: 'completed', roundsLeft: 0, totalWin: 12, isComplete: true,
        }));
      });
      client = new ArtubeClient(url);
      const seen: any[] = [];
      client.on('frc', (p: any) => seen.push(p));
      await client.connect();
      void client.play({ action: 'spin', betIndex: 1 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ status: 'completed', roundsLeft: 0, totalWin: 12 });
    });

    it('обрыв связи отбивает висящую активацию', async () => {
      const url = await startBackend(() => {});
      client = new ArtubeClient(url);
      await client.connect();
      const pending = client.activateCampaign('camp-1');
      wss.clients.forEach((c) => c.terminate());
      // Иначе анонсер остался бы с бесконечным спиннером на кнопке Start.
      await expect(pending).rejects.toBeInstanceOf(ArtubeBackendError);
    });
  });

  /** Помогает поднять сервер, отдающий разные init на первое и последующие соединения. */
  async function startResumeBackend() {
    let firstSocket: any;
    wss = new WebSocketServer({ port: 0 });
    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount += 1;
      if (connectionCount === 1) firstSocket = socket;
      const payload =
        connectionCount === 1
          ? INIT
          : {
              ...INIT,
              balance: 55,
              resume: {
                roundId: 'r9', action: 'spin', data: {}, winX: 0, totalWinX: 0, betAmount: 1,
                nextActions: [], spinsRemaining: 1, spinsPlayed: 1, balanceAfter: null,
                creditPending: true, maxWinReached: false,
              },
            };
      socket.send(JSON.stringify(payload));
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;
    return { url, getFirstSocket: () => firstSocket };
  }

  it('первый init идёт только через промис connect(), событие init не дублирует его', async () => {
    const { url, getFirstSocket } = await startResumeBackend();
    client = new ArtubeClient(url, 10);
    const inits: any[] = [];
    client.on('init', (init: any) => inits.push(init));
    const firstInit = await client.connect();
    expect(firstInit.balance).toBe(100);
    expect(inits).toEqual([]);

    // Обрыв связи — клиент сам переподключается и получает второй init.
    getFirstSocket().terminate();
    await new Promise((r) => setTimeout(r, 200));

    expect(inits.length).toBe(1);
    expect(inits[0].balance).toBe(55);
    expect(inits[0].resume?.roundId).toBe('r9');
  });

  it('поздний подписчик на init всё равно получает пропущенный реконнект-init', async () => {
    const { url, getFirstSocket } = await startResumeBackend();
    client = new ArtubeClient(url, 10);
    await client.connect();

    getFirstSocket().terminate();
    // Реконнект-init уже приходит и оседает в клиенте — подписчиков ещё нет.
    await new Promise((r) => setTimeout(r, 200));

    const inits: any[] = [];
    client.on('init', (init: any) => inits.push(init));

    expect(inits.length).toBe(1);
    expect(inits[0].resume?.roundId).toBe('r9');
  });

  it('error без id перед закрытием сокета отбивает connect(), а не виснет', async () => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ t: 'error', code: 'InvalidSession', message: 'session not found' }));
      socket.close(1011, 'session init failed');
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=bad`;

    client = new ArtubeClient(url, 200);
    await expect(client.connect()).rejects.toMatchObject({
      name: 'ArtubeBackendError',
      code: 'InvalidSession',
    });
  });

  it('обрыв соединения до init отбивает connect(), а не виснет', async () => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => {
      socket.terminate(); // ничего не шлём — рвём сразу
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;

    client = new ArtubeClient(url, 200);
    await expect(client.connect()).rejects.toBeInstanceOf(ArtubeBackendError);
  });

  it('close() во время бэкоффа не открывает сокет-зомби', async () => {
    let connections = 0;
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => {
      connections += 1;
      socket.send(JSON.stringify(INIT));
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;

    client = new ArtubeClient(url, 50);
    await client.connect();
    expect(connections).toBe(1);

    wss.clients.forEach((c) => c.terminate()); // клиент планирует реконнект через ~50мс
    await new Promise((r) => setTimeout(r, 10)); // точно ещё внутри бэкоффа
    client.close();

    await new Promise((r) => setTimeout(r, 150)); // бэкофф давно бы истёк, будь баг жив
    expect(connections).toBe(1);
  });

  it('реконнект не плодит параллельные цепочки при устойчивом сбое соединения', async () => {
    let connections = 0;
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => {
      connections += 1;
      // Рвём сразу после установления, ни разу не дожидаясь init — так
      // сервер раз за разом проваливает попытки клиента переподключиться.
      socket.terminate();
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;

    const RealWebSocket = globalThis.WebSocket;
    let openNow = 0;
    let maxOpenAtOnce = 0;
    class CountingWebSocket extends RealWebSocket {
      constructor(target: string | URL) {
        super(target);
        openNow += 1;
        maxOpenAtOnce = Math.max(maxOpenAtOnce, openNow);
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          openNow -= 1;
        };
        this.addEventListener('close', settle);
        this.addEventListener('error', settle);
      }
    }
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket =
      CountingWebSocket as unknown as typeof WebSocket;

    try {
      client = new ArtubeClient(url, 5);
      await client.connect().catch(() => {});
      // 5 ретраев с бэкоффом ×2 от 5мс: 5+10+20+40+80 = 155мс — берём с запасом.
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      (globalThis as { WebSocket: typeof WebSocket }).WebSocket = RealWebSocket;
    }

    // Параллельные цепочки реконнекта означали бы, что в какой-то момент
    // одновременно открыт больше чем один сокет.
    expect(maxOpenAtOnce).toBeLessThanOrEqual(1);
    // Реконнект вообще случился (больше одной попытки)...
    expect(connections).toBeGreaterThan(1);
    // ...но не больше потолка: первый коннект + 5 ретраев.
    expect(connections).toBeLessThanOrEqual(6);

    const afterFirstWindow = connections;
    await new Promise((r) => setTimeout(r, 200));
    // Луп исчерпал лимит попыток и остановился — не бесконечный шторм с
    // постоянным интервалом (что и происходит без реэнтрантного флага, раз
    // потолок в 5 попыток никогда не достигается).
    expect(connections).toBe(afterFirstWindow);
  });

  /** Сервер, который прощается кадром `session_closed` и закрывает сокет. */
  async function startClosingBackend(code: number, reason: string) {
    let connections = 0;
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => {
      connections += 1;
      socket.send(JSON.stringify(INIT));
      if (connections > 1) return; // реконнект живёт спокойно
      setTimeout(() => {
        socket.send(JSON.stringify({ t: 'session_closed', reason }));
        socket.close(code, reason);
      }, 20);
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;
    return { url, connections: () => connections };
  }

  it('session_closed терминален: вытесненная вкладка не переподключается', async () => {
    // Вытеснение приходит от сервера ровно так (см. artube-server's
    // `closeSocket`). Переподключиться — значит вытеснить того, кто вытеснил
    // нас: две вкладки одной сессии будут вытеснять друг друга бесконечно,
    // потолок попыток не спасает (успешный коннект сбрасывает счётчик).
    const { url, connections } = await startClosingBackend(1000, 'superseded by a new connection');
    client = new ArtubeClient(url, 20);
    const reasons: string[] = [];
    client.on('sessionClosed', (p: { reason: string }) => reasons.push(p.reason));
    await client.connect();

    await new Promise((r) => setTimeout(r, 400)); // бэкофф давно бы истёк
    // Игра всё равно узнала, что случилось...
    expect(reasons).toEqual(['superseded by a new connection']);
    // ...но нового коннекта не было.
    expect(connections()).toBe(1);
  });

  it('уходящий под (close 1001) — не конец сессии: клиент возвращается', async () => {
    // Обратная сторона: терминален не всякий `session_closed`. При выключении
    // пода (`ws.close(1001)`, «going away») сессия жива, и реконнект должен
    // привести игрока на другой под, а не оставить его с мёртвой вкладкой.
    const { url, connections } = await startClosingBackend(1001, 'server shutting down');
    client = new ArtubeClient(url, 20);
    await client.connect();

    await new Promise((r) => setTimeout(r, 400));
    expect(connections()).toBeGreaterThan(1);
  });

  it('битый JSON-фрейм не роняет обработчик сообщений', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send('not json {{{');
      socket.send(JSON.stringify({
        t: 'result', id: msg.id, roundId: 'r1', action: msg.action, data: {},
        winX: 1, totalWinX: 1, betAmount: 1, nextActions: [], spinsRemaining: 0,
        spinsPlayed: 1, balanceAfter: 10, creditPending: false, maxWinReached: false,
      }));
    });
    client = new ArtubeClient(url);
    await client.connect();
    const res = await client.play({ action: 'spin', betIndex: 0 });
    expect(res.roundId).toBe('r1');
  });
  /**
   * The message a developer (or a support agent reading a player's console)
   * gets when nothing is listening. It used to be `ws error`, which named
   * neither the address nor a cause and sent the reader hunting — the whole
   * reason `dev:artube` now starts the backend itself.
   */
  describe('a failed connection explains itself', () => {
    it('names the address it tried and what to check, keeping code=ConnectionFailed', async () => {
      // Port 1 is privileged and never has our backend on it: a guaranteed
      // refusal without racing a real listener.
      client = new ArtubeClient('ws://127.0.0.1:1/api/ws?sessionId=s1', 5);
      const err = await client.connect().catch((e) => e as ArtubeBackendError);
      client.close();

      expect(err).toBeInstanceOf(ArtubeBackendError);
      // Other code and tests branch on the code — it must not move.
      expect((err as ArtubeBackendError).code).toBe('ConnectionFailed');
      expect(err.message).toContain('ws://127.0.0.1:1/api/ws');
      expect(err.message).toMatch(/backend running/);
      // The sessionId is a bearer credential for the player's session; it has
      // no business in a message that reaches a player's screen.
      expect(err.message).not.toContain('sessionId');
      expect(err.message).not.toContain('s1');
    });

    it('says so when the socket opens but closes before init', async () => {
      // How a rejected sessionId looks from here: an accepted socket that is
      // closed without an init frame.
      wss = new WebSocketServer({ port: 0 });
      wss.on('connection', (socket) => socket.close(1008, 'sessionId is required'));
      await new Promise<void>((r) => wss.on('listening', () => r()));
      const port = (wss.address() as AddressInfo).port;

      client = new ArtubeClient(`ws://127.0.0.1:${port}/api/ws?sessionId=nope`, 5);
      const err = await client.connect().catch((e) => e as ArtubeBackendError);
      client.close();

      expect((err as ArtubeBackendError).code).toBe('ConnectionFailed');
      expect(err.message).toContain(`ws://127.0.0.1:${port}/api/ws`);
      expect(err.message).toContain('before the backend sent init');
      expect(err.message).not.toContain('nope');
    });
  });
});
