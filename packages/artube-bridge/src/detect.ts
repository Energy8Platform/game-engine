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

export function isArtubeLaunch(input: string | URL | Location): boolean {
  const url = toUrl(input);
  return Boolean(url?.searchParams.get('sessionId'));
}

export function parseArtubeUrl(input: string | URL | Location): ArtubeUrlParams {
  const url = toUrl(input);
  if (!url) throw new Error('artube-bridge: не удалось разобрать URL запуска');
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) throw new Error('artube-bridge: в URL нет sessionId');
  const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : 'desktop';
  return {
    sessionId,
    lang: url.searchParams.get('lang') ?? 'en',
    device,
    apiBase: url.origin,
  };
}
