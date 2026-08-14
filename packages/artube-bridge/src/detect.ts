/**
 * Детект запуска на Artube — лист-модуль без импортов моста, чтобы точка
 * входа игры могла решить, грузить ли мост, не утягивая его в бандл.
 */

export interface ArtubeUrlParams {
  sessionId: string;
  lang: string;
  device: 'desktop' | 'mobile';
  /**
   * База адресов бэкенда: **каталог страницы запуска** — origin плюс путь по
   * последний `/`, без завершающего слэша (мост дописывает `/api/ws`).
   *
   * Платформа отдаёт фронт и бэк под ОДНИМ адресом игры и разводит их по пути
   * (`/api/**` → бэкенд), но «один адрес игры» — это не обязательно корень
   * домена. Реальный деплой монтирует игру под пер-игровым ПРЕФИКСОМ ПУТИ
   * (`https://dev.artube-888.live/artube-o7df8qem5k/`), и её бэкенд живёт под
   * тем же префиксом. Вывод из `url.origin` выбрасывал префикс и уводил сокет
   * на `wss://dev.artube-888.live/api/ws`, которого там нет.
   *
   * Каталог покрывает обе формы разом: под пер-игровым поддоменом
   * (`https://example-game.artube-888.live/`) он равен origin и даёт ровно то
   * `/api/**`, что описывает дока платформы; под префиксом — `<префикс>/api/**`.
   *
   * Считается от `location`, а НЕ от `document.baseURI`: `<base href>` двигает
   * разрешение ссылок в документе (им уводят ассеты на CDN), а бэкенд
   * смонтирован под путём, по которому открыта сама страница. Сборка игры
   * (`base: './'`) никакого `<base>` и не пишет.
   */
  apiBase: string;
}

/**
 * Каталог страницы запуска — origin + путь по последний `/`, без query,
 * фрагмента и без завершающего слэша.
 *
 * Последний сегмент пути считается ФАЙЛОМ (и отбрасывается), только если в
 * нём есть точка: так `…/artube-xxx/index.html` даёт `…/artube-xxx`, а
 * `…/artube-xxx` без слэша на конце — тоже `…/artube-xxx`, а не корень
 * домена. Голого разрешения относительного URL (`new URL('./', href)`) для
 * второго случая не хватает: по правилам URL сегмент без слэша — это файл, и
 * префикс потерялся бы ровно так же, как терялся при выводе из origin.
 * Обычно сервер на такой адрес отвечает 301 на вариант со слэшем, но
 * полагаться на редирект нельзя — до него мы уже успели построить адрес.
 *
 * Известный предел этой эвристики: каталог с точкой в имени и БЕЗ слэша на
 * конце (`…/v1.2?sessionId=…`) прочтётся как файл. Отличить его от файла по
 * URL нечем, а канонический (и отдаваемый редиректом) вид такого адреса —
 * со слэшем, где эвристика не нужна вовсе.
 */
function directoryOf(url: URL): string {
  const path = url.pathname;
  const lastSlash = path.lastIndexOf('/');
  const lastSegment = path.slice(lastSlash + 1);
  const dir =
    lastSegment === '' || lastSegment.includes('.') ? path.slice(0, lastSlash + 1) : `${path}/`;
  // Через URL, а не конкатенацией с `origin`: у непрозрачных origin
  // (`file:`, `blob:`) `origin` — это строка "null".
  return new URL(dir, url).href.replace(/\/$/, '');
}

function toUrl(input: string | URL | Location): URL | null {
  const href = typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/**
 * Значение `sessionId` из URL: обрезанное по краям, `null` — если параметра
 * нет вовсе. Пустая строка (`?sessionId=`, `?sessionId=%20`) — это НЕ «нет
 * параметра»: запуск заявляет сессию, но идентификатор пуст, см.
 * {@link classifyArtubeLaunch}.
 */
function sessionIdOf(url: URL): string | null {
  const raw = url.searchParams.get('sessionId');
  return raw === null ? null : raw.trim();
}

export function isArtubeLaunch(input: string | URL | Location): boolean {
  return classifyArtubeLaunch(input) === 'artube';
}

/** Как хосту трактовать URL запуска — см. {@link classifyArtubeLaunch}. */
export type ArtubeLaunchKind = 'artube' | 'blocked' | 'offline';

/**
 * Как хосту трактовать URL запуска:
 *  - `'artube'`  — полноценный запуск на Artube (есть непустой `sessionId`); грузим мост.
 *  - `'blocked'` — запуск ЗАЯВЛЯЕТ сессию (`sessionId` в URL есть), но идентификатор пуст или
 *    состоит из пробелов: вырезан или испорчен по дороге. Игра обязана отказаться стартовать.
 *  - `'offline'` — маркера сессии нет вовсе: обычный дев-запуск (оффлайн-мост).
 *
 * Зачем `'blocked'` отдельно от `'offline'` — тот же довод, что у `classifyStakeLaunch`
 * в `@energy8platform/stake-bridge/detect`: без него испорченный запуск не проходит проверку
 * «это Artube?» и МОЛЧА сваливается в оффлайн/дев-мост, где игрок крутит бесплатно. Отличие
 * платформы в том, что подменить адрес бэкенда через URL нельзя (`apiBase` — каталог самой
 * страницы запуска, см. {@link ArtubeUrlParams}), так что здесь ловится ровно вырезанный
 * идентификатор сессии.
 *
 * Чего этот детект НЕ может: параметр, удалённый целиком, неотличим от честного дев-запуска —
 * по URL это одно и то же. В продакшене проваливаться всё равно некуда: бутстрап DevBridge
 * внедряет вайт-плагин с `apply: 'serve'`, так что ни одна сборка его не несёт — независимо от
 * `BUILD_TARGET` (артуб-таргет важен для `dev`, а не для сборки). А под обычным `npm run dev`
 * DevBridge уже поднят к моменту старта игры, и защищает там именно отказ игры стартовать.
 *
 * Дубль параметра (`?sessionId=&sessionId=real`) разрешается ПЕРВЫМ вхождением — так же, как его
 * прочитает `parseArtubeUrl` и, значит, мост. Для подсунутого пустого первого значения это
 * означает `'blocked'`: отказ, а не тихий выбор «удобного» второго.
 */
export function classifyArtubeLaunch(input: string | URL | Location): ArtubeLaunchKind {
  const url = toUrl(input);
  if (!url) return 'offline'; // неразбираемый URL — нечего защищать
  const sessionId = sessionIdOf(url);
  if (sessionId === null) return 'offline'; // не Artube-запуск → дев/оффлайн
  return sessionId ? 'artube' : 'blocked';
}

export function parseArtubeUrl(input: string | URL | Location): ArtubeUrlParams {
  const url = toUrl(input);
  if (!url) throw new Error('artube-bridge: не удалось разобрать URL запуска');
  const sessionId = sessionIdOf(url);
  if (!sessionId) throw new Error('artube-bridge: в URL нет sessionId');
  const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : 'desktop';
  return {
    sessionId,
    lang: url.searchParams.get('lang') ?? 'en',
    device,
    apiBase: directoryOf(url),
  };
}
