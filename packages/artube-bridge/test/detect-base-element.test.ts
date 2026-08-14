/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=s1" }
 */

/**
 * Элемент `<base>` НЕ двигает адрес бэкенда.
 *
 * `<base href>` переопределяет разрешение относительных ссылок В ДОКУМЕНТЕ —
 * им уводят ассеты на CDN. Бэкенд же смонтирован относительно адреса, по
 * которому открыта САМА страница, поэтому вывод идёт от `location`, а не от
 * `document.baseURI`: иначе игра с ассетами на CDN искала бы `/api/ws` на
 * CDN.
 *
 * На практике `<base>` в артефакте и не появляется: сборка ходит под
 * `base: './'`, то есть кладёт относительные ссылки на ассеты и никакого
 * `<base>` не пишет. Тест держит границу на случай, если кто-то его добавит.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseArtubeUrl } from '../src/detect';

afterEach(() => {
  document.head.querySelector('base')?.remove();
});

describe('<base> в документе', () => {
  it('без <base> путь страницы даёт префиксный apiBase', () => {
    expect(document.baseURI).toBe('https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=s1');
    expect(parseArtubeUrl(document.location).apiBase).toBe(
      'https://dev.artube-888.live/api/artube-o7df8qem5k',
    );
  });

  it('<base> на CDN не уводит туда бэкенд', () => {
    const base = document.createElement('base');
    base.setAttribute('href', 'https://cdn.example.com/assets/');
    document.head.appendChild(base);

    expect(document.baseURI).toBe('https://cdn.example.com/assets/');
    expect(parseArtubeUrl(document.location).apiBase).toBe(
      'https://dev.artube-888.live/api/artube-o7df8qem5k',
    );
  });
});
