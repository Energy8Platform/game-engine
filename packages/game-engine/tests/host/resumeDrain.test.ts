import { describe, it, expect, vi } from 'vitest';
import {
  createResumeDrain,
  resumeBonusView,
  overrideWithBook,
  type ResumeDrainDeps,
} from '@/host/resumeDrain';
import type { PlayResultData } from '@energy8platform/platform-core';
import type { FreeSpinsView } from '@/host/freeSpinsCounter';

/**
 * Замечание Artube:
 *   «Refresh During FS — if the page is refreshed during Free Spins, the Free Spins progress is
 *    preserved and the counter is accurate.»
 *   Найдено: «The counter is reset to 0/0 while the previous FS round is active.»
 *
 * Счётчик фри-спинов живёт в шелле и на старте равен 0/0. Доигрывание восстановленного раунда
 * переключает бар в бонусный режим — и обязано в тот же момент вписать в счётчик реальные числа
 * платформы. Иначе игрок смотрит целый фри-спин под «0 / 0».
 */

interface Spin extends Record<string, unknown> {
  totalWin: number;
  roundId?: string;
  nextActions?: string[];
  complete?: boolean;
}

/** Сегмент открытого раунда, как его отдаёт мост: session считает ВСЕ сегменты, включая триггер. */
function segment(over: {
  played: number;
  remaining: number;
  totalWin?: number;
  next?: string[];
}): PlayResultData {
  return {
    roundId: 'r1',
    action: 'free_spin',
    totalWin: over.totalWin ?? 0,
    nextActions: over.next ?? ['free_spin'],
    session: {
      spinsPlayed: over.played,
      spinsRemaining: over.remaining,
      totalWin: over.totalWin ?? 0,
      completed: over.remaining === 0,
    },
    creditPending: over.remaining > 0,
  } as unknown as PlayResultData;
}

/** Лента наблюдаемых событий бара + сцены, в порядке их появления. */
function harness(segments: PlayResultData[], over: Partial<ResumeDrainDeps<Spin>> = {}) {
  const log: string[] = [];
  const queue = segments.slice(1);
  const deps: ResumeDrainDeps<Spin> = {
    scene: () => ({
      async onSpin(_r, _ctx) {
        log.push('animate');
      },
    }),
    play: async () => {
      log.push('play');
      return queue.shift()!;
    },
    ack: () => log.push('ack'),
    normalize: (raw) => ({ totalWin: (raw as { totalWin: number }).totalWin }),
    context: (action) => ({
      bet: 1,
      action,
      mode: 'FREESPINS',
      formatAmount: String,
      get turbo() {
        return 0;
      },
    }),
    setWin: () => {},
    setMode: (m) => log.push(`mode:${m}`),
    setBusy: (b) => log.push(`busy:${b}`),
    winReporter: { open: () => {}, close: () => {} },
    applyBonusReadout: (_r, v: FreeSpinsView) => log.push(`counter:${v.current}/${v.total}`),
    bonusMode: 'freeSpins',
    ...over,
  };
  return { log, drain: createResumeDrain<Spin>(deps) };
}

describe('resumeBonusView', () => {
  it('снимает счётчик фри-спинов с сессии, отбрасывая сегмент-триггер', () => {
    // 5 сегментов сыграно (триггер + 4 фри-спина), 6 впереди → 4 из 10.
    expect(resumeBonusView({ session: { spinsPlayed: 5, spinsRemaining: 6 } }, 12)).toEqual({
      current: 4,
      total: 10,
      totalWin: 12,
    });
  });

  it('без сессии считать нечего — null, а не выдуманные нули', () => {
    expect(resumeBonusView({ session: null }, 0)).toBeNull();
    expect(resumeBonusView({}, 0)).toBeNull();
    expect(resumeBonusView(null, 0)).toBeNull();
  });

  it('счётчик не уходит в минус на кривых числах', () => {
    expect(resumeBonusView({ session: { spinsPlayed: 0, spinsRemaining: 0 } }, 0)).toEqual({
      current: 0,
      total: 0,
      totalWin: 0,
    });
  });
});

describe('overrideWithBook', () => {
  const view = { current: 4, total: 10, totalWin: 12 };

  it('книга раунда важнее арифметики по сессии', () => {
    // Реконструкция по сессии предполагает ровно один сегмент-триггер перед фри-спинами —
    // форма, которая есть не у каждой игры. Когда книга называет счёт прямо, верим ей.
    expect(overrideWithBook(view, { total: 12, remaining: 5 })).toEqual({
      current: 7,
      total: 12,
      totalWin: 12,
    });
  });

  it('без счётчиков в книге вид остаётся как был', () => {
    expect(overrideWithBook(view, undefined)).toEqual(view);
    expect(overrideWithBook(view, { awarded: 10 })).toEqual(view);
  });

  it('одного remaining хватает, чтобы поправить сыгранное', () => {
    expect(overrideWithBook(view, { remaining: 2 })).toEqual({
      current: 8,
      total: 10,
      totalWin: 12,
    });
  });
});

describe('createResumeDrain: перезагрузка посреди фри-спинов', () => {
  it('счётчик встаёт на место ДО первой анимации, а не после неё', async () => {
    const h = harness([
      segment({ played: 5, remaining: 6, totalWin: 12 }), // снимок: 4 из 10 сыграно
      segment({ played: 6, remaining: 5, totalWin: 15 }),
      segment({ played: 7, remaining: 0, totalWin: 20, next: [] }),
    ]);
    await h.drain(segment({ played: 5, remaining: 6, totalWin: 12 }), true);

    // Ровно это видел тестировщик: между сменой режима и первой анимацией бар
    // обязан уже знать «4 / 10», иначе он рисует 0/0 весь первый фри-спин.
    expect(h.log.slice(0, 4)).toEqual(['busy:true', 'mode:freeSpins', 'counter:4/10', 'animate']);
  });

  it('счётчик растёт по сегментам и заканчивается на полном раунде', async () => {
    const h = harness([
      segment({ played: 5, remaining: 2, totalWin: 12 }),
      segment({ played: 6, remaining: 1, totalWin: 15 }),
      segment({ played: 7, remaining: 0, totalWin: 20, next: [] }),
    ]);
    await h.drain(segment({ played: 5, remaining: 2, totalWin: 12 }), true);

    expect(h.log.filter((l) => l.startsWith('counter:'))).toEqual([
      'counter:4/6', // снимок, до анимации
      'counter:4/6', // он же после неё
      'counter:5/6',
      'counter:6/6',
    ]);
  });

  it('быстрая доигровка (Finish) тоже показывает правильный счётчик', async () => {
    const h = harness([
      segment({ played: 5, remaining: 1, totalWin: 12 }),
      segment({ played: 6, remaining: 0, totalWin: 18, next: [] }),
    ]);
    await h.drain(segment({ played: 5, remaining: 1, totalWin: 12 }), false);

    expect(h.log).not.toContain('animate'); // без анимации
    expect(h.log.filter((l) => l.startsWith('counter:'))[0]).toBe('counter:4/5');
  });

  it('каждый сегмент подтверждается — последний расчитывает раунд', async () => {
    const h = harness([
      segment({ played: 5, remaining: 1, totalWin: 12 }),
      segment({ played: 6, remaining: 0, totalWin: 18, next: [] }),
    ]);
    await h.drain(segment({ played: 5, remaining: 1, totalWin: 12 }), true);
    expect(h.log.filter((l) => l === 'ack')).toHaveLength(2);
    expect(h.log.at(-1)).toBe('busy:false');
    expect(h.log).toContain('mode:base'); // бонус закрыт, бар вернулся в базовый режим
  });

  it('без сцены доигрывать нечего — бар не трогаем', async () => {
    const h = harness([segment({ played: 5, remaining: 1 })], { scene: () => undefined });
    await h.drain(segment({ played: 5, remaining: 1 }), true);
    expect(h.log).toEqual([]);
  });

  it('упавший сегмент не оставляет бар запертым', async () => {
    const boom = new Error('scene exploded');
    const h = harness([segment({ played: 5, remaining: 1 })], {
      scene: () => ({
        onSpin: async () => {
          throw boom;
        },
      }),
    });
    await expect(h.drain(segment({ played: 5, remaining: 1 }), true)).rejects.toThrow(boom);
    expect(h.log.at(-1)).toBe('busy:false');
  });

  it('счётчик из книги игры перебивает счёт по сессии', async () => {
    const first = segment({ played: 5, remaining: 6, totalWin: 12, next: [] });
    const h = harness([first], {
      // Игра сама разбирает свой раунд и знает: осталось 3 из 12.
      normalize: (raw) => ({
        totalWin: (raw as { totalWin: number }).totalWin,
        freeSpins: { total: 12, remaining: 3 },
      }),
    });
    await h.drain(first, true);
    expect(h.log[2]).toBe('counter:9/12'); // не 4/10, посчитанные по сегментам
  });

  it('снимок без сессии не выдумывает счётчик', async () => {
    // Раунд без сессии — уже закрытый: бонусного режима нет, счётчика тоже.
    const one = { roundId: 'r1', totalWin: 7, nextActions: [] } as unknown as PlayResultData;
    const h = harness([one]);
    await h.drain(one, true);
    expect(h.log.filter((l) => l.startsWith('counter:'))).toEqual([]);
    expect(h.log).not.toContain('mode:freeSpins');
  });
});
