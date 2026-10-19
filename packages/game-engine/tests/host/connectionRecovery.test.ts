import { describe, it, expect, vi } from 'vitest';
import { createConnectionRecovery, type ConnectionRecoveryDeps } from '@/host/connectionRecovery';

/**
 * Замечание Artube: «If connection is lost during autoplay, autoplay stops, and after reconnection
 * the counter is displayed correctly» — а игра вместо этого показывала экран с предложением
 * перезагрузить страницу. Этот контроллер и есть ответ: обрыв только останавливает прогон
 * (счётчик держится, пока связи нет), возврат связи сбрасывает автоплей и молча доигрывает
 * прерванный раунд.
 */
function harness(over: Partial<ConnectionRecoveryDeps> = {}) {
  const calls: string[] = [];
  const deps: ConnectionRecoveryDeps = {
    haltAutoplay: () => {
      calls.push('halt');
    },
    resetAutoplay: () => {
      calls.push('reset');
    },
    showReconnecting: () => {
      calls.push('reconnecting');
    },
    showGone: () => {
      calls.push('gone');
    },
    dismiss: () => {
      calls.push('dismiss');
    },
    getState: async () => null,
    drain: async () => {
      calls.push('drain');
    },
    onError: () => {
      calls.push('error');
    },
    ...over,
  };
  return { deps, calls, rec: createConnectionRecovery(deps) };
}

const SNAP = { roundId: 'r1' } as never;

describe('createConnectionRecovery', () => {
  it('обрыв: останавливает автоплей и показывает «Переподключаемся…»', () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'lost' });
    expect(calls).toEqual(['halt', 'reconnecting']);
  });

  it('обрыв не плодит оверлеи, пока связь не вернулась', () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'lost' });
    rec.onState({ status: 'lost' }); // каждая провалившаяся попытка реконнекта
    expect(calls.filter((c) => c === 'reconnecting')).toHaveLength(1);
  });

  it('возврат без открытого раунда перечитывает баланс: потерянный спин платформа могла рассчитать', async () => {
    const { rec, calls } = harness({
      refreshBalance: async () => {
        calls.push('balance');
      },
    });
    await rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls).toEqual(['halt', 'reconnecting', 'reset', 'dismiss', 'balance']);
  });

  it('упавшее перечитывание баланса не всплывает экраном', async () => {
    const { rec, calls } = harness({
      refreshBalance: async () => {
        throw new Error('nope');
      },
    });
    await rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls).not.toContain('error');
  });

  it('исчерпанный реконнект — это уже не «сейчас вернёмся»', () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'lost', code: 'ConnectionGone' });
    expect(calls).toEqual(['halt', 'gone']);
  });

  it('возврат связи: снимает оверлей и молча доигрывает прерванный раунд', async () => {
    const drained: unknown[] = [];
    const { rec, calls } = harness({
      getState: async () => SNAP,
      drain: async (s) => {
        drained.push(s);
        calls.push('drain');
      },
    });
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    // Ни одного экрана «перезагрузите страницу» — ровно то, на что жаловались.
    expect(calls).toEqual(['halt', 'reconnecting', 'reset', 'dismiss', 'drain']);
    expect(drained).toEqual([SNAP]);
  });

  it('доигрывать нечего — просто снимаем оверлей', async () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls).toEqual(['halt', 'reconnecting', 'reset', 'dismiss']);
  });

  it('«restored» без обрыва ничего не трогает', async () => {
    // Иначе возврат связи закрыл бы чужую модалку — например, ту, что игра
    // показала по совсем другой причине.
    const { rec, calls } = harness({ getState: async () => SNAP });
    await rec.onState({ status: 'restored' });
    expect(calls).toEqual([]);
  });

  it('чужая модалка на экране: не маскируем её «Переподключаемся…»', () => {
    const { rec, calls } = harness({ isBlocked: () => true });
    rec.onState({ status: 'lost' });
    expect(calls).toEqual(['halt']); // прогон всё равно остановлен
  });

  it('чужая модалка на экране: возврат связи её не закрывает, но раунд доигрывает', async () => {
    const { rec, calls } = harness({ isBlocked: () => true, getState: async () => SNAP });
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls).toEqual(['halt', 'reset', 'drain']);
  });

  it('провал восстановления не уходит в пустоту', async () => {
    const boom = new Error('drain failed');
    const seen: unknown[] = [];
    const { rec } = harness({
      getState: async () => SNAP,
      drain: async () => {
        throw boom;
      },
      onError: (e) => seen.push(e),
    });
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(seen).toEqual([boom]);
  });

  it('getState, который упал, не мешает снять оверлей', async () => {
    const { rec, calls } = harness({
      getState: async () => {
        throw new Error('no state');
      },
    });
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls).toContain('dismiss');
    expect(calls).not.toContain('drain');
  });

  it('следующий обрыв после возврата снова показывает оверлей', async () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    rec.onState({ status: 'lost' });
    expect(calls.filter((c) => c === 'reconnecting')).toHaveLength(2);
  });

  it('возврат связи сбрасывает автоплей — прогон не «ждёт» игрока', async () => {
    // Требование Artube поверх замечания лаборатории: после реконнекта автоплей сброшен,
    // а не сохранён «до одного тапа». Сброс происходит и когда доигрывать нечего.
    const { rec, calls } = harness();
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    expect(calls.filter((c) => c === 'reset')).toHaveLength(1);
  });

  it('«restored» без обрыва автоплей не трогает', async () => {
    const { rec, calls } = harness();
    await rec.onState({ status: 'restored' });
    expect(calls).not.toContain('reset');
  });

  it('«connecting» — промежуточный статус, экран не трогает', () => {
    const { rec, calls } = harness();
    rec.onState({ status: 'connecting' });
    expect(calls).toEqual([]);
  });

  it('второй restored подряд не доигрывает раунд дважды', async () => {
    const { rec, calls } = harness({ getState: async () => SNAP });
    rec.onState({ status: 'lost' });
    await rec.onState({ status: 'restored' });
    await rec.onState({ status: 'restored' });
    expect(calls.filter((c) => c === 'drain')).toHaveLength(1);
  });

  it('пока идёт восстановление, новый обрыв не роняет контроллер', async () => {
    let release!: () => void;
    const { rec, calls } = harness({
      getState: async () => SNAP,
      drain: () =>
        new Promise<void>((r) => {
          release = r;
          calls.push('drain');
        }),
    });
    rec.onState({ status: 'lost' });
    const done = rec.onState({ status: 'restored' });
    await vi.waitFor(() => expect(calls).toContain('drain'));
    rec.onState({ status: 'lost' }); // связь ушла прямо посреди доигрывания
    release();
    await done;
    expect(calls.filter((c) => c === 'reconnecting')).toHaveLength(2);
  });
});
