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

  it('бэкенд всегда на том же origin — так требует дока', () => {
    const params = parseArtubeUrl('https://example-game.artube-888.live/play?sessionId=s');
    expect(params.apiBase).toBe('https://example-game.artube-888.live');
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
});
