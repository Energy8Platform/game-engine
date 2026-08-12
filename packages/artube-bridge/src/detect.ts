/**
 * Детект запуска на Artube — лист-модуль без импортов моста, чтобы точка
 * входа игры могла решить, грузить ли мост, не утягивая его в бандл.
 */

export interface ArtubeUrlParams {
  sessionId: string;
  lang: string;
  device: 'desktop' | 'mobile';
  /**
   * Origin бэкенда. Дока платформы отдаёт фронт и бэк под одним доменом и
   * разводит их по пути (`/api/**` → бэкенд), поэтому это всегда own origin.
   */
  apiBase: string;
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
 * платформы в том, что подменить адрес бэкенда через URL нельзя (`apiBase` = `url.origin`), так
 * что здесь ловится ровно вырезанный идентификатор сессии.
 *
 * Чего этот детект НЕ может: параметр, удалённый целиком, неотличим от честного дев-запуска —
 * по URL это одно и то же. Вторая половина защиты структурная: в артуб-сборке
 * (`BUILD_TARGET=artube`) нет DevBridge, то есть проваливаться некуда.
 */
export type ArtubeLaunchKind = 'artube' | 'blocked' | 'offline';

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
    apiBase: url.origin,
  };
}
