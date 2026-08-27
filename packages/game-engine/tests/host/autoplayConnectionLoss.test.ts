// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/shell/html';
import type { ShellConfig, GameShell } from '@energy8platform/shell/html';
import { createAutoplayLoop } from '@/host/autoplay';
import { createConnectionRecovery, type ConnectionState } from '@/host/connectionRecovery';
import { resolvePlayError } from '@/host/playError';

/**
 * Замечание Artube, целиком:
 *   «Connection Loss During Autoplay — If connection is lost during autoplay, autoplay stops, and
 *    after reconnection the counter is displayed correctly.»
 *   Найдено: «The autoplay counter is reset. An additional screen is displayed for the page
 *    reloading during autoplay only.»
 *
 * Проверяем это на живом DOM-шелле с настоящими autoplay-лупом, классификатором ошибок и
 * контроллером восстановления, собранными ровно так, как их собирает createSlotGame (сам он
 * юнит-тестами не берётся: GameApplication.init() поднимает Pixi и в headless виснет).
 */

class SDKError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const cfg = (): ShellConfig => ({
  mount: document.body,
  gameInfo: { sections: [] },
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [1],
  defaultBet: 1,
  currentBet: 1,
  balance: 100000,
  win: 0,
  mode: 'base',
  features: { turbo: 0, autoplay: {}, buyBonus: false },
});

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const disc = () => q('[data-ge="spin"]') as HTMLButtonElement;
const modalBody = () => q('[data-ge="modal-body"]')?.textContent ?? '';
const modalActions = () =>
  Array.from(document.body.querySelectorAll('[data-ge="modal-action"]')).map((b) => b.textContent);

/** The base-mode wiring from createSlotGame: autoplay loop + play-error routing + recovery. */
function harness(opts: { failOnRound: number; failCode: string }) {
  const shell: GameShell = createGameShell(cfg());
  const plays: string[] = [];
  const drained: unknown[] = [];
  let openRound: { roundId: string } | null = null;

  let playErrorOpen = false;
  const reload = vi.fn();
  const showPlayError = (err: unknown): void => {
    const v = resolvePlayError(err);
    autoplay.halt();
    if (v.connection) return;
    playErrorOpen = true;
    shell.openModal({
      availableClose: !v.reload,
      title: shell.t(v.title),
      body: shell.t(v.body),
      actions: v.reload
        ? [{ title: shell.t('Reload'), on: reload }]
        : [{ title: shell.t('OK'), on: () => { playErrorOpen = false; } }],
    });
  };

  // One round: plays, and on the nominated round the socket dies mid-flight.
  const playRound = (action: string): Promise<void> => {
    plays.push(action);
    if (plays.length !== opts.failOnRound) return Promise.resolve();
    openRound = { roundId: `r${plays.length}` }; // платформа успела открыть раунд
    void connection.onState({ status: 'lost', code: 'ConnectionLost' }); // мост объявляет обрыв
    // ...а висевший play отбивается тем же обрывом — как в ArtubeClient.failPending.
    return Promise.reject(new SDKError(opts.failCode, 'connection lost')).catch(showPlayError);
  };

  const autoplay = createAutoplayLoop({
    resolveAction: () => 'spin',
    canAfford: () => true,
    playRound,
    onState: (s) => shell.setAutoplay(s),
  });

  const connection = createConnectionRecovery({
    haltAutoplay: () => autoplay.halt(),
    showReconnecting: () =>
      shell.openModal({
        availableClose: false,
        title: shell.t('Reconnecting…'),
        body: shell.t('Lost connection to the game server. Trying to reconnect…'),
      }),
    showGone: () =>
      shell.openModal({
        availableClose: false,
        title: shell.t('Connection lost'),
        body: shell.t('Could not reconnect to the game server. Please reload the game.'),
        actions: [{ title: shell.t('Reload'), on: reload }],
      }),
    dismiss: () => shell.closeModal(),
    getState: async () => openRound as never,
    drain: async (snap) => { drained.push(snap); openRound = null; },
    onError: showPlayError,
    isBlocked: () => playErrorOpen,
  });

  shell.on('autoplayStart', (o: { remaining: number }) => autoplay.start(o.remaining));
  shell.on('autoplayStop', () => autoplay.stop());
  const restore = (): Promise<void> => connection.onState({ status: 'restored' } as ConnectionState);
  return { shell, autoplay, plays, drained, reload, restore };
}

describe('обрыв связи посреди автоплея', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await removeGameShell();
  });

  it('прогон останавливается, счётчик остаётся, экрана с Reload нет', async () => {
    const h = harness({ failOnRound: 3, failCode: 'ConnectionLost' });
    h.autoplay.start(10);
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));

    expect(h.plays).toHaveLength(3); // третий раунд оборвался, четвёртого не было
    expect(h.autoplay.remaining).toBe(7);
    // Счётчик на диске — «displayed correctly», а не сброшен в ноль.
    expect(disc().textContent).toContain('7');
    // Единственный экран — «Переподключаемся…», и кнопки Reload на нём нет.
    expect(modalBody()).toMatch(/reconnect/i);
    expect(modalActions()).toEqual([]);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('связь вернулась: оверлей ушёл, раунд доигран, счётчик на месте', async () => {
    const h = harness({ failOnRound: 3, failCode: 'ConnectionLost' });
    h.autoplay.start(10);
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));
    await h.restore();

    expect(q('[data-ge="modal-body"]')).toBeNull(); // ни одного экрана поверх игры
    expect(h.drained).toEqual([{ roundId: 'r3' }]); // прерванный раунд доигран молча
    expect(disc().textContent).toContain('7');
  });

  it('после возврата связи игрок одним тапом продолжает прогон', async () => {
    const h = harness({ failOnRound: 3, failCode: 'ConnectionLost' });
    h.autoplay.start(10);
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));
    await h.restore();

    disc().click();
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));
    expect(h.plays).toHaveLength(10); // 3 до обрыва + 7 оставшихся
  });

  it('кнопка авто снимает остаток, и диск снова обычный SPIN', async () => {
    const h = harness({ failOnRound: 3, failCode: 'ConnectionLost' });
    h.autoplay.start(10);
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));
    await h.restore();

    (q('[data-ge="autoplay"]') as HTMLButtonElement).click();
    expect(h.autoplay.remaining).toBe(0);
    expect(disc().textContent).not.toContain('7');
  });

  it('настоящая ошибка раунда по-прежнему показывает свой экран — и тоже бережёт счётчик', async () => {
    // Классификация не должна проглотить всё подряд: ACTIVE_SESSION_EXISTS лечится только
    // перезагрузкой, и предложить её — правильный ответ.
    const h = harness({ failOnRound: 2, failCode: 'ACTIVE_SESSION_EXISTS' });
    h.autoplay.start(10);
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));

    expect(modalActions()).toEqual(['Reload']);
    expect(h.autoplay.remaining).toBe(8);
  });
});
