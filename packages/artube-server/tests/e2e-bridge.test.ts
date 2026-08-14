/**
 * Сквозной тест обоих пакетов: настоящий `ArtubeServer` (настоящий движок,
 * настоящий WS) и настоящий `ArtubeBridge` с настоящим `CasinoGameSDK`
 * поверх него. Игрок здесь — код игры, а не заглушка.
 *
 * Зачем: контракт `/api/ws` описан ДВАЖДЫ — `artube-server/src/http/wire.ts`
 * и `artube-bridge/src/types.ts`, — и связывает эти копии только договорённость.
 * Все остальные тесты сервера гоняют фейкового клиента, а все тесты моста —
 * фейковый бэкенд, поэтому переименованное на одной стороне поле уезжало бы в
 * релиз зелёным. Здесь оба пакета говорят друг с другом по-настоящему: любое
 * расхождение имён немедленно превращается в NaN, null или зависший раунд.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CasinoGameSDK, MemoryChannel } from '@energy8platform/game-sdk';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { decodeRoundState } from '../src/round/roundState';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';
import { ArtubeBridge } from '../../artube-bridge/src/bridge';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SESSION = 'sess-e2e';
const BET = 2;

let platform: FakePlatform;
let server: ArtubeServer;
let bridge: ArtubeBridge | null = null;
let sdk: CasinoGameSDK | null = null;

/** Мост живёт в браузере: ему нужны window и глобальный WebSocket. */
function installBrowserGlobals(): void {
  const g = globalThis as { window?: Record<string, unknown> };
  g.window = g.window ?? {};
  MemoryChannel.clearGlobal();
  delete g.window.__casinoBridgeChannel;
}

/** Запустить мост и игру заново — как перезагрузка вкладки. */
async function boot(): Promise<{ bridge: ArtubeBridge; sdk: CasinoGameSDK }> {
  installBrowserGlobals();
  const freshBridge = new ArtubeBridge({
    devMode: true,
    url: `https://game.artube-888.live/?sessionId=${SESSION}&lang=en&device=desktop`,
    apiBase: `http://127.0.0.1:${server.port}`,
    gameId: 'feature-game',
  });
  await freshBridge.ready();
  const freshSdk = new CasinoGameSDK({ devMode: true });
  bridge = freshBridge;
  sdk = freshSdk;
  return { bridge: freshBridge, sdk: freshSdk };
}

beforeEach(async () => {
  platform = await startFakePlatform({ allowedBets: [0.5, BET], balance: 100 });
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0);
}, 40_000);

afterEach(async () => {
  sdk?.destroy();
  bridge?.destroy();
  sdk = null;
  bridge = null;
  await server?.close();
  await platform?.close();
});

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('сервер и мост вместе, сквозь настоящий game-sdk', () => {
  it('игра проходит сложный раунд целиком: spin + 3 фриспина, деньги от платформы', async () => {
    const { sdk: game } = await boot();

    const init = await game.ready();
    expect(init.balance).toBe(100);
    expect(init.currency).toBe('USD');
    expect(init.config.betLevels).toEqual([0.5, BET]);
    expect(init.session).toBeNull();

    const spin = await game.play({ action: 'spin', bet: BET });
    expect(spin.roundId).toBe(platform.roundOf(SESSION)!.round_id);
    expect(spin.nextActions).toEqual(['free_spin']);
    expect(spin.creditPending).toBe(true);
    expect(spin.totalWin).toBe(0);
    expect(spin.session.spinsRemaining).toBe(3);
    expect(spin.session.betAmount).toBe(BET);
    // Ставка списана платформой на OpenRound, выигрыш ещё не зачислен.
    expect(platform.balance).toBe(100 - BET);

    game.playAck(spin);
    await settle();
    // Подтверждение доехало до платформы — значит `roundId`/`cursor` на
    // проводе понимают обе стороны одинаково.
    expect(decodeRoundState(platform.roundOf(SESSION)!.round_state).cursor).toBe(1);

    let last = spin;
    for (let i = 1; i <= 3; i++) {
      last = await game.play({ action: 'free_spin', bet: BET });
      expect(last.roundId).toBe(spin.roundId);
      // Суммы для показа = множитель × ставка раунда: если `betAmount`
      // перестанет доезжать, это станет NaN.
      expect(last.totalWin).toBe(i * BET);
      expect(last.session.spinsPlayed).toBe(i + 1);
      if (i < 3) {
        expect(last.creditPending).toBe(true);
        game.playAck(last);
        await settle();
        expect(decodeRoundState(platform.roundOf(SESSION)!.round_state).cursor).toBe(i + 1);
      }
    }

    // Финал: выигрыш зачислен, баланс пришёл от платформы, а не посчитан.
    expect(last.creditPending).toBe(false);
    expect(last.session.completed).toBe(true);
    expect(last.balanceAfter).toBe(100 - BET + 3 * BET);
    expect(platform.balance).toBe(100 - BET + 3 * BET);
    expect(platform.roundOf(SESSION)!.finished_at).not.toBeNull();
    expect(platform.countOf('OpenRoundRequest')).toBe(1);
    expect(platform.countOf('CloseRoundRequest')).toBe(1);
    expect(platform.countOf('PlayRoundRequest')).toBe(0);

    const balance = await game.getBalance();
    expect(balance.balance).toBe(100 - BET + 3 * BET);
  }, 60_000);

  it('перезагрузка посреди фичи: игра забирает недосмотренный сегмент через getState() и доигрывает', async () => {
    const first = await boot();
    await first.sdk.ready();
    const spin = await first.sdk.play({ action: 'spin', bet: BET });
    first.sdk.playAck(spin);
    await settle();
    const unacked = await first.sdk.play({ action: 'free_spin', bet: BET });
    expect(unacked.totalWin).toBe(BET);
    // Игрок смотрит анимацию этого сегмента — и тут вкладка перезагружается.
    first.sdk.destroy();
    first.bridge.destroy();
    await settle();

    const second = await boot();
    const init = await second.sdk.ready();
    // Сводка незакрытого раунда приезжает прямо на INIT...
    expect(init.session).toMatchObject({ spinsPlayed: 2, completed: false });
    // ...а полный снимок сегмента — тем же каналом, которым его забирает
    // createSlotGame's offerResume().
    const resumed = await second.sdk.getState();
    expect(resumed).not.toBeNull();
    expect(resumed!.roundId).toBe(spin.roundId);
    expect(resumed!.action).toBe('free_spin');
    expect(resumed!.totalWin).toBe(unacked.totalWin);
    expect(resumed!.data).toEqual(unacked.data);
    expect(resumed!.session.spinsRemaining).toBe(unacked.session.spinsRemaining);

    // Досматриваем возвращённый сегмент и доигрываем раунд до конца.
    second.sdk.playAck(resumed!);
    await settle();
    let last = resumed!;
    for (let i = 0; i < 2; i++) {
      last = await second.sdk.play({ action: 'free_spin', bet: BET });
      if (last.creditPending) {
        second.sdk.playAck(last);
        await settle();
      }
    }
    expect(last.creditPending).toBe(false);
    expect(last.totalWin).toBe(3 * BET); // весь выигрыш фичи, ничего не потеряно
    expect(last.balanceAfter).toBe(100 - BET + 3 * BET);
    expect(platform.countOf('OpenRoundRequest')).toBe(1);
    expect(platform.countOf('CloseRoundRequest')).toBe(1);
  }, 60_000);
});

/**
 * Стык, который ломался дважды: адрес сокета мост ВЫВОДИТ из URL страницы, а
 * сервер решает, его ли это маршрут. Обе половины покрыты юнит-тестами по
 * отдельности — и обе редакции бага были в них зелёными, потому что каждая
 * сторона проверялась против собственного представления о форме адреса.
 *
 * Здесь `apiBase` НЕ передаётся: адрес считается из URL страницы и уезжает в
 * настоящий сервер. Форма деплоя проверяется на том же сервере, что и
 * дев-форма, потому что одна сборка обязана покрывать обе.
 *
 * ЧЕГО ЭТОТ ТЕСТ НЕ ЛОВИТ — и это важнее того, что он ловит. Наш сервер
 * намеренно сверяет маршруты по хвосту пути (он не знает, сколько срежет
 * прокси), поэтому он ответит и на неверно выведенный префикс: обе прошлые
 * редакции вывода проходят этот тест зелёными. Здесь проверяется, что мост и
 * сервер СОГЛАСОВАНЫ и что адрес вообще собирается и доезжает; что он
 * совпадает с тем, который принимает прокси ПЛАТФОРМЫ, не может показать ни
 * один локальный тест — точную строку фиксируют юнит-тесты
 * `artube-bridge/test/detect.test.ts`, а её правильность устанавливается
 * только запросом к живому стенду (см.
 * `.superpowers/sdd/2026-08-10-artube-integration/apibase-prefix-fix.md`).
 */
describe('вывод адреса сокета доезжает до настоящего сервера', () => {
  const bootAt = async (pageUrl: string) => {
    installBrowserGlobals();
    const fresh = new ArtubeBridge({
      devMode: true,
      url: pageUrl,
      gameId: 'feature-game',
      // apiBase намеренно отсутствует — проверяем именно вывод.
    });
    await fresh.ready();
    bridge = fresh;
    const game = new CasinoGameSDK({ devMode: true });
    sdk = game;
    return game;
  };

  it('дев: страница в корне → голый /api/ws', async () => {
    const game = await bootAt(`http://127.0.0.1:${server.port}/?sessionId=${SESSION}`);
    expect((await game.ready()).balance).toBe(100);
  }, 30_000);

  it('прод: страница под /<slug>/ → /api/<slug>/api/ws', async () => {
    // Ровно форма живого стенда:
    //   https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=…
    //   wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws?sessionId=…
    const game = await bootAt(
      `http://127.0.0.1:${server.port}/artube-o7df8qem5k/?sessionId=${SESSION}` +
        `&gameId=artube-o7df8qem5k`,
    );
    expect((await game.ready()).balance).toBe(100);
  }, 30_000);
});
