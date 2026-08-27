import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { BottomBar } from '@/ui/pixi/components/BottomBar';
import { SpinDisc } from '@/ui/pixi/primitives/widgets';
import { makeContext, defaultConfig } from './_host';

/**
 * Прогон автоплея, прерванный обрывом связи (замечание Artube: «autoplay stops, and after
 * reconnection the counter is displayed correctly»). Хост зовёт setAutoplay({active:false,
 * remaining:N}) — прогон стоит, но заказанные спины ещё за игроком, и бар обязан их показать.
 * Пиксельный бар обязан вести себя ровно как DOM-овский (см. tests/html/bottombar.test.ts).
 */
function makeHost(over: Record<string, unknown> = {}) {
  return makeContext({
    config: defaultConfig({
      availableBets: [1, 2, 5],
      defaultBet: 2,
      features: { turbo: 0, autoplay: {}, buyBonus: false },
    }),
    ...over,
  });
}

const discOf = (bar: BottomBar) => (bar as unknown as { spin?: SpinDisc }).spin!;
const autoBtnOf = (bar: BottomBar) =>
  (bar as unknown as { autoBtn?: { emit(e: string): void } }).autoBtn!;
/** Внутренний режим диска: 'spin' | 'stop' | 'resume'. */
const modeOf = (d: SpinDisc) => (d as unknown as { mode: string }).mode;
const countOf = (d: SpinDisc) => (d as unknown as { countText?: { text: string } }).countText?.text;

describe('пиксельный бар: прогон прерван, счётчик остался', () => {
  it('диск показывает остаток и предлагает продолжить', () => {
    const host = makeHost();
    host.state.autoplay = { active: false, remaining: 4 };
    const bar = new BottomBar(host);
    expect(modeOf(discOf(bar))).toBe('resume');
    expect(countOf(discOf(bar))).toBe('4');
  });

  it('идущий прогон по-прежнему STOP + обратный счёт', () => {
    const host = makeHost();
    host.state.autoplay = { active: true, remaining: 7 };
    const bar = new BottomBar(host);
    expect(modeOf(discOf(bar))).toBe('stop');
    expect(countOf(discOf(bar))).toBe('7');
  });

  it('нулевой остаток — обычный диск SPIN', () => {
    const host = makeHost();
    host.state.autoplay = { active: false, remaining: 0 };
    const bar = new BottomBar(host);
    expect(modeOf(discOf(bar))).toBe('spin');
    expect(countOf(discOf(bar))).toBeUndefined();
  });

  it('тап по диску возобновляет прогон с остатка, а не крутит один спин', () => {
    const emit = vi.fn();
    const host = makeHost({ emit });
    host.state.autoplay = { active: false, remaining: 4 };
    const bar = new BottomBar(host);
    discOf(bar).emit('pointertap' as never);
    expect(emit).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 4 });
    expect(emit).not.toHaveBeenCalledWith('spin', expect.anything());
  });

  it('кнопка авто снимает остаток вместо открытия пикера', () => {
    const emit = vi.fn();
    const host = makeHost({ emit });
    host.state.autoplay = { active: false, remaining: 4 };
    const bar = new BottomBar(host);
    autoBtnOf(bar).emit('pointertap');
    expect(emit).toHaveBeenCalledWith('autoplayStop');
  });

  it('ставка не заперта, пока прогон стоит', () => {
    const host = makeHost();
    host.state.autoplay = { active: false, remaining: 4 };
    const bar = new BottomBar(host);
    expect((bar as unknown as { betUp?: { disabled: boolean } }).betUp!.disabled).toBe(false);
  });
});

describe('SpinDisc: три состояния диска', () => {
  const make = (over: Partial<Parameters<typeof SpinDisc.prototype.constructor>[0]> = {}) =>
    new SpinDisc({
      tokens: { btn: '#fff', btnInk: '#000', accent: '#f00' } as never,
      ticker: { add() {}, remove() {} } as never,
      onSpin: () => {},
      onStop: () => {},
      onResume: () => {},
      ...over,
    } as never);

  it('paused → resume-режим со счётчиком; off → чистый SPIN', () => {
    const d = make();
    d.setAutoplay('paused', 12);
    expect(modeOf(d)).toBe('resume');
    expect(countOf(d)).toBe('12');
    d.setAutoplay('off', 0);
    expect(modeOf(d)).toBe('spin');
    expect(countOf(d)).toBeUndefined();
  });

  it('бесконечный прогон рисуется знаком ∞, а не «Infinity»', () => {
    const d = make();
    d.setAutoplay('paused', Number.POSITIVE_INFINITY);
    expect(countOf(d)).toBe('∞');
  });

  it('тап в resume-режиме зовёт onResume, а не onSpin', () => {
    const calls: string[] = [];
    const d = make({ onSpin: () => calls.push('spin'), onResume: () => calls.push('resume') } as never);
    d.setAutoplay('paused', 3);
    d.emit('pointertap' as never);
    expect(calls).toEqual(['resume']);
  });
});
