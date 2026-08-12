/**
 * @vitest-environment jsdom
 *
 * Вендорный контроллер загрузочного экрана Artube (`@artube/loader` 2.1.0).
 *
 * Проверяем ровно то поведение, на которое опирается движок, и ровно те
 * свойства, которые легко потерять при следующем ре-вендоринге:
 *  - привязку к пяти id, которые печатает вайт-половина
 *    (`@energy8platform/artube-server/vite` → `ARTUBE_LOADER_ELEMENT_IDS`);
 *  - кроссфейд «партнёрская фаза → фирменная» ровно на первом `updateProgress`
 *    с value > 0 — на нём держится вся хореография передачи экрана движку;
 *  - бросок без разметки (иначе `createArtubeLoader` был бы не нужен).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LoaderViewController, createArtubeLoader } from '../src/loader';

/** Разметка, которую в index.html впрыскивает `artubePartnerLoader()` (обе фазы). */
function mountMarkup(withPartner = true): void {
  document.body.innerHTML = `
<div id="loader" class="loader">
  ${withPartner ? `<div id="loader-partner" class="loader-phase loader-partner active"><div class="loader-partner-logo"></div></div>` : ''}
  <div id="loader-artube" class="loader-phase loader-artube">
    <div class="loader-artube-gradient"></div>
    <div class="loader-artube-logo"></div>
    <div id="progress-container" class="progress-container hidden-progress">
      <div class="progress-bg"><div id="progress-bar" class="progress-bar"></div></div>
    </div>
  </div>
</div>`;
}

const el = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('LoaderViewController (вендорный @artube/loader 2.1.0)', () => {
  it('без разметки конструктор бросает — как в апстриме', () => {
    expect(() => new LoaderViewController()).toThrow(/Loader elements not found/);
  });

  it('showLoader показывает контейнер прогресса, но НЕ переключает фазу', () => {
    mountMarkup();
    const c = new LoaderViewController();
    c.showLoader();
    expect(el('progress-container').classList.contains('hidden-progress')).toBe(false);
    // Партнёрская фаза ещё активна: фирменного экрана игрок пока не видел.
    expect(el('loader-partner').classList.contains('active')).toBe(true);
    expect(el('loader-artube').classList.contains('active')).toBe(false);
  });

  it('кроссфейд на фирменную фазу — на первом же updateProgress > 0', () => {
    mountMarkup();
    const c = new LoaderViewController();

    c.updateProgress(0); // ноль не переключает: 0 === currentProgress, ранний выход
    expect(el('loader-artube').classList.contains('active')).toBe(false);

    c.updateProgress(1);
    expect(el('loader-partner').classList.contains('active')).toBe(false);
    expect(el('loader-artube').classList.contains('active')).toBe(true);
    expect(el('progress-bar').style.width).toBe('1%');
  });

  it('updateProgress — это ПРОЦЕНТЫ 0..100, они пишутся в width', () => {
    mountMarkup();
    const c = new LoaderViewController();
    c.updateProgress(42.5);
    expect(el('progress-bar').style.width).toBe('42.5%');
    c.updateProgress(100);
    expect(el('progress-bar').style.width).toBe('100%');
  });

  it('без партнёрской фазы showLoader сразу включает фирменную', () => {
    mountMarkup(false);
    const c = new LoaderViewController();
    c.showLoader();
    expect(el('loader-artube').classList.contains('active')).toBe(true);
  });

  it('hideLoader вешает класс с анимацией и снимает элемент по её концу', () => {
    mountMarkup();
    const c = new LoaderViewController();
    c.hideLoader();
    const loader = el('loader');
    expect(loader.classList.contains('hidden-loader')).toBe(true);
    // jsdom анимаций не крутит — эмулируем событие, которое шлёт браузер.
    const ev = new Event('animationend') as AnimationEvent;
    Object.defineProperty(ev, 'animationName', { value: 'hideLoader' });
    loader.dispatchEvent(ev);
    expect(document.getElementById('loader')).toBeNull();
  });

  it('чужая animationend элемент не убирает', () => {
    mountMarkup();
    new LoaderViewController().hideLoader();
    const ev = new Event('animationend') as AnimationEvent;
    Object.defineProperty(ev, 'animationName', { value: 'somethingElse' });
    el('loader').dispatchEvent(ev);
    expect(document.getElementById('loader')).not.toBeNull();
  });
});

describe('createArtubeLoader (добавка Energy8, не апстрим)', () => {
  it('без разметки — null, а не бросок: это и есть страж для не-Artube сборок', () => {
    expect(createArtubeLoader()).toBeNull();
  });

  it('с разметкой — рабочий контроллер', () => {
    mountMarkup();
    const c = createArtubeLoader();
    expect(c).toBeInstanceOf(LoaderViewController);
    c!.updateProgress(50);
    expect(el('progress-bar').style.width).toBe('50%');
  });

  it('структурно совместим с ExternalLoadingOverlay движка', () => {
    mountMarkup();
    const c = createArtubeLoader()!;
    for (const m of ['showLoader', 'updateProgress', 'hideLoader'] as const) {
      expect(typeof c[m]).toBe('function');
    }
  });
});
