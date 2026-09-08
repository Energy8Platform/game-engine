// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/shell/html';
import type { ShellConfig, GameShell } from '@energy8platform/shell/html';
import { createAutoplayLoop } from '@/host/autoplay';
import { createPauseController } from '@/host/pauseController';
import { createConnectionRecovery } from '@/host/connectionRecovery';

/**
 * Замечание Artube, целиком:
 *   «Manual Stop — The autoplay sequence stops when the Stop button is pressed.»
 *   Найдено: «Autoplay is stopped if to switch the tab.»
 *
 * То есть прогон обязан заканчиваться по STOP — и ТОЛЬКО по нему (плюс по причинам, которые
 * лаборатория проверяет отдельно: кончился бюджет, оборвалась связь). Уход на другую вкладку в этот
 * список не входит: игрок вернулся — прогон продолжается с того же счётчика.
 *
 * Пауза по blur остаётся: тикер стоит, музыка приглушена, новые раунды не стартуют. Разница в том,
 * ЧЕМ прогон придерживают — `autoplay.hold()`/`release()` (счётчик остаётся, прогон возвращается
 * сам) вместо `stop()`, который обнулял счётчик и заканчивал прогон навсегда.
 *
 * Проверяем на живом DOM-шелле с настоящими autoplay-лупом и pause-контроллером, собранными ровно
 * так, как их собирает createSlotGame (сам он юнит-тестами не берётся: GameApplication.init()
 * поднимает Pixi и в headless виснет).
 */

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

/** The base-mode wiring from createSlotGame: autoplay loop + pause controller + the halt closures. */
function harness() {
  const shell: GameShell = createGameShell(cfg());
  const plays: string[] = [];
  let settle: (() => void) | null = null; // resolves the round in flight, on demand
  let hidden = false;
  let onVisibilityChange: () => void = () => {};

  const playRound = (action: string): Promise<void> => {
    plays.push(action);
    return new Promise<void>((resolve) => {
      settle = resolve;
    });
  };

  const autoplay = createAutoplayLoop({
    resolveAction: () => 'spin',
    canAfford: () => true,
    playRound,
    onState: (s) => shell.setAutoplay(s),
  });

  createPauseController({
    isHidden: () => hidden,
    subscribe: (cb) => {
      onVisibilityChange = cb;
      return () => {};
    },
    onHidden: () => autoplay.hold(), // + ticker.stop() / duckMusic(0) / onPause() in the real host
    onVisible: () => autoplay.release(),
  });

  shell.on('autoplayStart', (o: { remaining: number }) => autoplay.start(o.remaining));
  shell.on('autoplayStop', () => autoplay.stop());

  return {
    shell,
    autoplay,
    plays,
    finishRound: (): Promise<void> => {
      settle?.();
      settle = null;
      return Promise.resolve();
    },
    hide: (): void => {
      hidden = true;
      onVisibilityChange();
    },
    show: (): void => {
      hidden = false;
      onVisibilityChange();
    },
  };
}

describe('уход на другую вкладку посреди автоплея', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await removeGameShell();
  });

  it('прогон придержан, а не окончен: счётчик цел', async () => {
    const h = harness();
    h.autoplay.start(5);
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));

    h.hide();

    expect(h.autoplay.active).toBe(false); // новые раунды не стартуют, пока вкладка скрыта
    expect(h.autoplay.remaining).toBe(4); // ...но заказанные спины остались за игроком
    expect(disc().textContent).toContain('4');
  });

  it('игрок вернулся — прогон идёт дальше сам, с того же места', async () => {
    const h = harness();
    h.autoplay.start(5);
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));

    h.hide();
    h.show();

    expect(h.autoplay.active).toBe(true);
    await h.finishRound(); // раунд, замерший под паузой, доигрался
    await vi.waitFor(() => expect(h.plays).toHaveLength(2)); // и следующий стартовал сам
    expect(h.autoplay.remaining).toBe(3);
  });

  it('прогон доходит до конца, пережив переключение вкладки', async () => {
    const h = harness();
    h.autoplay.start(3);
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));
    h.hide();
    h.show();
    for (let i = 0; i < 3; i++) {
      await h.finishRound();
      await new Promise((r) => setTimeout(r, 0));
    }
    await vi.waitFor(() => expect(h.autoplay.active).toBe(false));
    expect(h.plays).toHaveLength(3); // все три заказанных спина сыграны
    expect(h.autoplay.remaining).toBe(0); // и только теперь счётчик пуст
  });

  it('STOP по-прежнему заканчивает прогон — и вкладка его не воскрешает', async () => {
    const h = harness();
    h.autoplay.start(5);
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));

    h.autoplay.stop(); // игрок нажал STOP
    expect(h.autoplay.remaining).toBe(0);

    h.hide();
    h.show();

    expect(h.autoplay.active).toBe(false);
    expect(h.autoplay.remaining).toBe(0);
  });

  it('вкладка, переключённая БЕЗ автоплея, автоплей не заводит', () => {
    const h = harness();
    h.hide();
    h.show();
    expect(h.autoplay.active).toBe(false);
    expect(h.plays).toHaveLength(0);
  });

  it('прогон, оборванный связью, с возвратом на вкладку не возобновляется', async () => {
    // Иначе две правки подрались бы: обрыв связи прогон заканчивает (реконнект его сбрасывает),
    // и «придержан паузой» — это не про него.
    const h = harness();
    const connection = createConnectionRecovery({
      haltAutoplay: () => h.autoplay.halt(),
      resetAutoplay: () => h.autoplay.stop(),
      showReconnecting: () => {},
      showGone: () => {},
      dismiss: () => {},
      getState: async () => null,
      drain: async () => {},
      onError: () => {},
    });
    h.autoplay.start(5);
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));

    h.hide();
    void connection.onState({ status: 'lost', code: 'ConnectionLost' }); // связь ушла под паузой
    h.show();

    expect(h.autoplay.active).toBe(false); // возврат на вкладку прогон не поднимает
    expect(h.plays).toHaveLength(1);
  });
});
