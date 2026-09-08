import './setup-canvas';
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PixiRenderer } from '@/ui/pixi/PixiRenderer';
import { ShellController } from '@/core/ShellController';
import type { Popover } from '@/ui/pixi/primitives/popover';

/**
 * Замечание Artube, целиком:
 *   «Orientation Change — On mobile devices, when the screen is rotated during spin, win animation,
 *    or Gamble, the UI adapts correctly and the game does not crash.»
 *   Найдено: «The UI is not adopted if to change screen rotation while menu is opened.»
 *
 * Что происходило: меню — light-dismiss попап, он кладётся в стек ЯВНО без подложки
 * (`pushLayer(layer, { backdrop: false })`), потому что игра под ним должна оставаться видимой и
 * резкой. Но `onResize` звал `makeBackdrop()` для ЛЮБОГО открытого слоя, не спрашивая, просил ли
 * тот подложку. Поворот экрана с открытым меню — единственный момент, когда это выстреливало:
 * поверх игры внезапно ложился замороженный размытый снимок кадра, а `modalLayer` рисуется НАД
 * `barLayer`, так что вместе с игрой он закрывал и сам бар. Игрок видел меню поверх матового
 * стекла, под которым не осталось ни игры, ни бара, — до самого закрытия меню.
 *
 * Собираем настоящий PixiRenderer с фейковым Application (как mount-layout/menu тесты) и дёргаем
 * приватный onResize — ровно то, что делает pixi при `renderer.resize()` на повороте.
 */

const stubTicker = { add() {}, remove() {} };

function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} }, // без GL: makeBackdrop ловит свой throw и оставляет базу
    stage: new Container(),
  } as unknown as Application;
}

interface Priv {
  backdrop?: { node: Container };
  currentLayer: Popover | null;
  onResize: () => void;
}

function mountShell(w: number, h: number) {
  const app = fakeApp(w, h);
  const renderer = new PixiRenderer({ app, parent: new Container() });
  const controller = new ShellController({
    renderer,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: {},
    features: { turbo: 3, autoplay: {}, buyBonus: {} },
  });
  const priv = renderer as unknown as Priv;
  /** Поворот: pixi ресайзит рендерер под новый экран и шлёт 'resize'. */
  const rotate = (nw: number, nh: number): void => {
    app.screen.width = nw;
    app.screen.height = nh;
    priv.onResize();
  };
  return { controller, renderer, priv, rotate };
}

describe('поворот экрана с открытым меню', () => {
  it('не накрывает игру и бар матовой подложкой, которую меню не просило', () => {
    const { controller, priv, rotate } = mountShell(452, 812); // портрет, mobile-раскладка
    controller.actions.openMenu();
    expect(priv.currentLayer).not.toBeNull();
    expect(priv.backdrop).toBeUndefined(); // на открытии подложки нет — и не должно появиться

    rotate(812, 452); // ландшафт

    expect(priv.backdrop).toBeUndefined();
    expect(priv.currentLayer).not.toBeNull(); // меню пережило поворот
  });

  it('меню всё-таки переезжает под новую раскладку', () => {
    const { controller, priv, rotate } = mountShell(452, 812);
    controller.actions.openMenu();
    const before = { x: priv.currentLayer!.cardX, y: priv.currentLayer!.cardY };

    rotate(812, 452);

    const after = { x: priv.currentLayer!.cardX, y: priv.currentLayer!.cardY };
    expect(after).not.toEqual(before); // карточка встала по новому бару, а не осталась на старом месте
    expect(after.y).toBeGreaterThanOrEqual(0); // и не уехала за верхний край короткого экрана
  });

  it('модалке, которая подложку просила, поворот её сохраняет', () => {
    // Зеркальная половина: чинить надо только меню, обычные модалки матовое стекло получают
    // на открытии и обязаны его пересниять под новый размер.
    const { controller, priv, rotate } = mountShell(452, 812);
    controller.openModal({ title: 'T', body: 'B' });
    expect(priv.backdrop).toBeDefined();

    rotate(812, 452);

    expect(priv.backdrop).toBeDefined();
  });
});
