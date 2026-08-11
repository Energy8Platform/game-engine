import { describe, it, expect } from 'vitest';
import { isArtubeLaunch, parseArtubeUrl } from '../src/detect';

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

  it('бэкенд всегда на том же origin — так требует дока', () => {
    const params = parseArtubeUrl('https://example-game.artube-888.live/play?sessionId=s');
    expect(params.apiBase).toBe('https://example-game.artube-888.live');
  });
});
