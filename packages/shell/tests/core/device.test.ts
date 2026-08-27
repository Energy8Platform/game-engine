import { describe, it, expect } from 'vitest';
import { keyboardCapable } from '@/core/device';

/**
 * Замечание Artube:
 *   «Spacebar to Spin — the setting functions correctly and is not available on mobile devices.»
 *   Найдено: «Hotkeys section is displayed on mobile client. While hot keys can't be used.
 *    Including the "space" button.»
 *
 * Клавиатура — не про ориентацию экрана (узкое окно на десктопе всё ещё с клавиатурой) и не про
 * наличие тача (у ноутбука с тачскрином клавиатура есть). Спрашиваем ровно то, что нужно: каким
 * указателем игрок работает и умеет ли он наводить курсор.
 */
const win = (query: Record<string, boolean>) => ({
  matchMedia: (q: string) => ({ matches: query[q] ?? false }),
});

const TOUCH = '(pointer: coarse) and (hover: none)';

describe('keyboardCapable', () => {
  it('тачскрин без курсора — клавиатуры нет', () => {
    expect(keyboardCapable(win({ [TOUCH]: true }) as never)).toBe(false);
  });

  it('обычный десктоп — клавиатура есть', () => {
    expect(keyboardCapable(win({ [TOUCH]: false }) as never)).toBe(true);
  });

  it('ноутбук с тачскрином не считается мобильным: основной указатель точный', () => {
    // Тач есть, но primary pointer — мышь, и hover работает: медиазапрос не сходится.
    expect(keyboardCapable(win({ '(pointer: coarse)': true, [TOUCH]: false }) as never)).toBe(true);
  });

  it('без window / без matchMedia считаем, что клавиатура есть', () => {
    expect(keyboardCapable(undefined)).toBe(true);
    expect(keyboardCapable({} as never)).toBe(true);
  });

  it('сломанный matchMedia не роняет шелл', () => {
    const broken = {
      matchMedia: () => {
        throw new Error('nope');
      },
    };
    expect(keyboardCapable(broken as never)).toBe(true);
  });
});
