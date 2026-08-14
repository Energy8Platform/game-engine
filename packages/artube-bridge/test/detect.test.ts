import { describe, it, expect } from 'vitest';
import { isArtubeLaunch, classifyArtubeLaunch, parseArtubeUrl } from '../src/detect';

describe('детект запуска на Artube', () => {
  it('sessionId в URL — это запуск на Artube', () => {
    expect(isArtubeLaunch('https://game.artube-888.live/?sessionId=abc-123')).toBe(true);
  });

  it('без sessionId — обычный дев-запуск', () => {
    expect(isArtubeLaunch('http://localhost:5173/')).toBe(false);
  });

  it('запуск на Stake не путается с Artube', () => {
    expect(
      isArtubeLaunch('https://game/?rgs_url=x.stake-engine.com&sessionID=s1'),
    ).toBe(false); // sessionID Stake пишется иначе и без sessionId
  });

  it('битый URL не роняет детект', () => {
    expect(isArtubeLaunch('не url')).toBe(false);
  });

  it('разбирает параметры запуска', () => {
    const params = parseArtubeUrl(
      'https://game.artube-888.live/?sessionId=abc-123&lang=ru&device=mobile',
    );
    expect(params).toEqual({
      sessionId: 'abc-123', lang: 'ru', device: 'mobile',
      apiBase: 'https://game.artube-888.live',
    });
  });

  it('по умолчанию язык en и десктоп', () => {
    const params = parseArtubeUrl('https://game.artube-888.live/?sessionId=s');
    expect(params.lang).toBe('en');
    expect(params.device).toBe('desktop');
  });
});

/**
 * `apiBase` = путь страницы запуска, ПЕРЕВЕШЕННЫЙ ПОД `/api`.
 *
 * Снято с живого стенда, а не выведено из общих соображений:
 *
 * ```
 * страница   https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=…&gameId=…
 * бэкенд     wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws?sessionId=…
 * ```
 *
 * Фронт — бакет CDN под `/<slug>/`; бэкенд — маршрут прокси `/api/<slug>/**`,
 * и наш собственный `/api/ws` остаётся на конце (удвоенное `api` настоящее).
 * Две прошлых версии брали origin (0.1.0) и каталог страницы (0.1.1) — обе
 * попадали туда, где бэкенда нет. См. `docs/artube-integration.md`.
 */
describe('apiBase = путь страницы, перевешенный под /api', () => {
  const apiBaseOf = (href: string) => parseArtubeUrl(href).apiBase;

  it('пер-игровой префикс пути — тот самый прод-случай, снятый со стенда', () => {
    expect(
      apiBaseOf(
        'https://dev.artube-888.live/artube-o7df8qem5k/' +
          '?sessionId=8f3daf8d-02f2-4d5d-b3f9-1f80fbcaa160&gameId=artube-o7df8qem5k',
      ),
    ).toBe('https://dev.artube-888.live/api/artube-o7df8qem5k');
  });

  it('мост из этого собирает ровно живой адрес сокета', () => {
    // Тот же расчёт, что в конструкторе ArtubeBridge: base + '/api/ws'.
    const p = parseArtubeUrl(
      'https://dev.artube-888.live/artube-o7df8qem5k/' +
        '?sessionId=8f3daf8d-02f2-4d5d-b3f9-1f80fbcaa160&gameId=artube-o7df8qem5k',
    );
    expect(`${p.apiBase.replace(/^http/, 'ws')}/api/ws?sessionId=${p.sessionId}`).toBe(
      'wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws' +
        '?sessionId=8f3daf8d-02f2-4d5d-b3f9-1f80fbcaa160',
    );
  });

  it('корень — просто origin: перевешивать нечего, `/api/api/ws` не появляется', () => {
    // Дев (вайт отдаёт игру в корне и проксирует `/api`) и гипотетический
    // прод в корне пер-игрового поддомена — одна и та же форма.
    expect(apiBaseOf('http://localhost:5175/?sessionId=s')).toBe('http://localhost:5175');
    expect(apiBaseOf('https://example-game.artube-888.live/?sessionId=s')).toBe(
      'https://example-game.artube-888.live',
    );
  });

  it('префикс берётся из ПУТИ, а не из ?gameId=', () => {
    // gameId пишет автор ссылки, и игрок правит его свободно; путь — это то,
    // откуда CDN отдал сам код игры. Подменённый gameId адрес не двигает.
    expect(
      apiBaseOf('https://host/artube-xxx/?sessionId=s&gameId=artube-someone-elses'),
    ).toBe('https://host/api/artube-xxx');
    // И наоборот: gameId нет вовсе — вывод не меняется.
    expect(apiBaseOf('https://host/artube-xxx/?sessionId=s')).toBe('https://host/api/artube-xxx');
  });

  it('URL заканчивается файлом (index.html) — файл отбрасывается', () => {
    expect(apiBaseOf('https://host/artube-xxx/index.html?sessionId=s')).toBe(
      'https://host/api/artube-xxx',
    );
    expect(apiBaseOf('https://host/index.html?sessionId=s')).toBe('https://host');
  });

  it('префикс без слэша на конце — последний сегмент всё равно каталог', () => {
    // Сервер на такой адрес обычно отвечает 301 на вариант со слэшем, но
    // полагаться на редирект нельзя: сюда мы можем попасть и до него.
    expect(apiBaseOf('https://host/artube-xxx?sessionId=s')).toBe('https://host/api/artube-xxx');
  });

  it('вложенный префикс сохраняется целиком', () => {
    expect(apiBaseOf('https://host/games/artube-xxx/?sessionId=s')).toBe(
      'https://host/api/games/artube-xxx',
    );
    expect(apiBaseOf('https://host/games/artube-xxx/index.html?sessionId=s')).toBe(
      'https://host/api/games/artube-xxx',
    );
  });

  it('query и фрагмент в вывод не попадают', () => {
    expect(apiBaseOf('https://host/artube-xxx/?sessionId=s&lang=ru&device=mobile#anchor')).toBe(
      'https://host/api/artube-xxx',
    );
  });

  it('нестандартный порт — часть адреса бэкенда', () => {
    expect(apiBaseOf('http://127.0.0.1:8080/artube-xxx/?sessionId=s')).toBe(
      'http://127.0.0.1:8080/api/artube-xxx',
    );
  });

  it('каталог с точкой в имени распознаётся по слэшу на конце', () => {
    expect(apiBaseOf('https://host/artube-xxx/v1.2/?sessionId=s')).toBe(
      'https://host/api/artube-xxx/v1.2',
    );
  });

  it('Location (а не строка) разбирается так же — это то, что даёт браузер', () => {
    const location = { href: 'https://host/artube-xxx/?sessionId=s' } as Location;
    expect(parseArtubeUrl(location).apiBase).toBe('https://host/api/artube-xxx');
  });

  it('вывод идёт от КАТАЛОГА страницы, а не от первого её сегмента', () => {
    // Допущение, на котором стоит вывод: index.html лежит в корне того самого
    // пути, который платформа перевешивает под `/api` — это и есть то, что
    // кладёт сборка (`base: './'`, один index.html в корне артефакта).
    // Страница на уровень глубже даёт и `apiBase` на уровень глубже.
    expect(apiBaseOf('https://host/artube-xxx/game/index.html?sessionId=s')).toBe(
      'https://host/api/artube-xxx/game',
    );
  });
});

describe('классификация запуска (защитный контур)', () => {
  it('непустой sessionId — полноценный запуск на Artube', () => {
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=abc-123')).toBe('artube');
  });

  it('параметра нет вовсе — честный дев-запуск, оффлайн', () => {
    expect(classifyArtubeLaunch('http://localhost:3000/')).toBe('offline');
  });

  it('sessionId вырезан (?sessionId=) — блокируем, а не сваливаемся в оффлайн', () => {
    // Ровно тот сценарий, ради которого класс существует: запуск ЗАЯВЛЯЕТ сессию, но
    // идентификатора нет. Молчаливый откат в оффлайн-мост = бесплатные спины.
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=')).toBe('blocked');
    expect(isArtubeLaunch('https://game.artube-888.live/?sessionId=')).toBe(false);
  });

  it('sessionId из одних пробелов — тоже испорченный запуск', () => {
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=%20%20')).toBe('blocked');
    expect(isArtubeLaunch('https://game.artube-888.live/?sessionId=%20%20')).toBe(false);
    expect(() => parseArtubeUrl('https://game.artube-888.live/?sessionId=%20%20')).toThrow(
      /sessionId/,
    );
  });

  it('пробелы по краям живого идентификатора не ломают запуск', () => {
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=%20abc%20')).toBe('artube');
    expect(parseArtubeUrl('https://game.artube-888.live/?sessionId=%20abc%20').sessionId).toBe(
      'abc',
    );
  });

  it('запуск на Stake — это не «испорченный Artube», а оффлайн для нас', () => {
    expect(classifyArtubeLaunch('https://game/?rgs_url=x.stake-engine.com&sessionID=s1')).toBe(
      'offline',
    );
  });

  it('битый URL не роняет классификацию', () => {
    expect(classifyArtubeLaunch('не url')).toBe('offline');
  });

  it('дублированный sessionId: побеждает первый — пустой первый блокирует запуск', () => {
    // Классификация и разбор обязаны читать ОДНО и то же значение, иначе подсунутый пустой первый
    // параметр пропустил бы гейт, а мост поехал бы на втором. Fail-closed: 'blocked'.
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=&sessionId=real')).toBe(
      'blocked',
    );
    expect(() =>
      parseArtubeUrl('https://game.artube-888.live/?sessionId=&sessionId=real'),
    ).toThrow(/sessionId/);
    // И наоборот: живой первый — запуск валиден и мост берёт именно его.
    expect(classifyArtubeLaunch('https://game.artube-888.live/?sessionId=real&sessionId=')).toBe(
      'artube',
    );
    expect(parseArtubeUrl('https://game.artube-888.live/?sessionId=real&sessionId=').sessionId).toBe(
      'real',
    );
  });
});
