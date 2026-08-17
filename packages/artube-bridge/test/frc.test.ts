/**
 * Кампания фри-раундов на стороне моста: то, что игра читает, чтобы нарисовать
 * анонсер, счётчик и итог.
 *
 * Мост здесь — переводчик и не более: анонсера в протоколе `CasinoGameSDK` нет,
 * поэтому кампания живёт на прямых методах моста, а рисует её игра.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerFrc, ServerInit, ServerResult } from '../src/types';

const backend = vi.hoisted(() => ({
  connect: vi.fn(),
  play: vi.fn(),
  ack: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
  activateCampaign: vi.fn(),
  declineCampaign: vi.fn(),
  /** Подписчики, которых мост навесил на клиента: ключ — имя события. */
  handlers: new Map<string, (arg: any) => void>(),
}));

vi.mock('../src/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client')>();
  return {
    ...actual,
    ArtubeClient: class {
      connect = backend.connect;
      play = backend.play;
      ack = backend.ack;
      close = backend.close;
      activateCampaign = backend.activateCampaign;
      declineCampaign = backend.declineCampaign;
      on = (event: string, cb: (arg: any) => void) => {
        backend.handlers.set(event, cb);
        backend.on(event, cb);
      };
    },
  };
});

const { ArtubeBridge } = await import('../src/bridge');

function installWindow(): void {
  (globalThis as { window?: any }).window = (globalThis as { window?: any }).window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window.__casinoBridgeChannel;
}

const OFFERED: ServerFrc = {
  campaignId: 'camp-1', status: 'offered', roundsLeft: 5, roundsTotal: 5,
  totalWin: 0, isComplete: false, bet: 1, betIndex: 1,
  validFrom: '2026-01-01T00:00:00Z', validTo: '2036-01-01T00:00:00Z',
};

function init(frc: ServerFrc | null = OFFERED): ServerInit {
  return {
    currency: 'USD', balance: 100, demo: false, frc,
    config: {
      betLevels: [0.1, 1, 5], defaultBetIndex: 1, currencyMinimalUnit: 0.01,
      autoSpinCounts: [10], locales: ['EN'],
      rtp: { isVisible: true, shownRtp: 96.5 }, platformMaxWin: null,
    },
  };
}

function result(over: Partial<ServerResult> = {}): ServerResult {
  return {
    roundId: 'r1', action: 'spin', data: {}, winX: 2, totalWinX: 2, betAmount: 1,
    nextActions: ['spin'], spinsRemaining: 0, spinsPlayed: 1, balanceAfter: 102,
    creditPending: false, maxWinReached: false, ...over,
  };
}

const URL_LIVE = 'https://game.artube-888.live/?sessionId=s1&lang=ru&device=mobile';

describe('ArtubeBridge — кампания фри-раундов', () => {
  let bridge: InstanceType<typeof ArtubeBridge>;

  beforeEach(async () => {
    installWindow();
    backend.handlers.clear();
    backend.connect.mockReset().mockResolvedValue(init());
    backend.play.mockReset().mockResolvedValue(result());
    backend.on.mockReset();
    backend.activateCampaign.mockReset();
    backend.declineCampaign.mockReset();
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
  });

  it('кампания из init доступна игре целиком — всё, что нужно анонсеру', () => {
    expect(bridge.campaign).toEqual(OFFERED);
    // Тип «с таймером» рисуется по этому полю; без него анонсер не может
    // сказать «Успейте сыграть до…».
    expect(bridge.campaign!.validTo).toBe('2036-01-01T00:00:00Z');
    // И индекс, которым игра обязана поставить ставку кампании.
    expect(bridge.campaign!.betIndex).toBe(1);
  });

  it('сессия без кампании — campaign равен null, активировать нечего', async () => {
    backend.connect.mockResolvedValue(init(null));
    const plain = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await plain.ready();
    expect(plain.campaign).toBeNull();
    await expect(plain.activateCampaign()).rejects.toMatchObject({ code: 'FrcNotFound' });
    expect(backend.activateCampaign).not.toHaveBeenCalled();
    plain.destroy();
  });

  it('activateCampaign уходит на бэкенд и обновляет снимок с уведомлением игры', async () => {
    const active: ServerFrc = { ...OFFERED, status: 'active' };
    backend.activateCampaign.mockResolvedValue(active);
    const seen: Array<ServerFrc | null> = [];
    bridge.onCampaignChange((frc) => seen.push(frc));

    // Идентификатор подставляется сам — игре не нужно его хранить.
    const returned = await bridge.activateCampaign();
    expect(backend.activateCampaign).toHaveBeenCalledWith('camp-1');
    expect(returned.status).toBe('active');
    expect(bridge.campaign!.status).toBe('active');
    expect(seen).toEqual([active]);
  });

  it('declineCampaign переводит кампанию в declined', async () => {
    backend.declineCampaign.mockResolvedValue({ ...OFFERED, status: 'declined' });
    await bridge.declineCampaign();
    expect(backend.declineCampaign).toHaveBeenCalledWith('camp-1');
    expect(bridge.campaign!.status).toBe('declined');
  });

  it('отказ бэкенда не двигает снимок', async () => {
    backend.activateCampaign.mockRejectedValue(
      new (await import('../src/client')).ArtubeBackendError('FrcBetNotAllowed', 'nope'),
    );
    await expect(bridge.activateCampaign()).rejects.toMatchObject({ code: 'FrcBetNotAllowed' });
    // Кампания осталась предложенной: активации не случилось.
    expect(bridge.campaign!.status).toBe('offered');
  });

  it('счётчик кампании освежается ответом на каждый фри-раунд', async () => {
    backend.activateCampaign.mockResolvedValue({ ...OFFERED, status: 'active' });
    await bridge.activateCampaign();
    const seen: Array<ServerFrc | null> = [];
    bridge.onCampaignChange((frc) => seen.push(frc));

    backend.play.mockResolvedValue(
      result({ frc: { rounds_left: 4, total_win: 2, is_complete: false } }),
    );
    await (bridge as any).onPlay({ action: 'spin', bet: 1 }, 'm1');

    expect(bridge.campaign).toMatchObject({ roundsLeft: 4, totalWin: 2, status: 'active' });
    expect(seen).toHaveLength(1);
  });

  it('завершение кампании приезжает кадром frc и возвращает игру в обычный режим', async () => {
    backend.activateCampaign.mockResolvedValue({ ...OFFERED, status: 'active' });
    await bridge.activateCampaign();
    const seen: Array<ServerFrc | null> = [];
    bridge.onCampaignChange((frc) => seen.push(frc));

    // Так это приходит с бэкенда: отдельный кадр вслед за последним результатом.
    backend.handlers.get('frc')!({
      ...OFFERED, status: 'completed', roundsLeft: 0, totalWin: 12, isComplete: true,
    });

    expect(bridge.campaign).toMatchObject({ status: 'completed', roundsLeft: 0, totalWin: 12 });
    expect(seen).toHaveLength(1);
    // Итоговая сумма — то, что показывает попап завершения.
    expect(seen[0]!.totalWin).toBe(12);
  });

  it('реконнект предлагает кампанию заново, а не продолжает молча', async () => {
    backend.activateCampaign.mockResolvedValue({ ...OFFERED, status: 'active' });
    await bridge.activateCampaign();
    expect(bridge.campaign!.status).toBe('active');

    const seen: Array<ServerFrc | null> = [];
    bridge.onCampaignChange((frc) => seen.push(frc));
    // Свежее соединение: бэкенд заново предлагает кампанию с остатком по
    // версии платформы. Промолчи мост — игра осталась бы с заблокированной
    // ставкой и «активной» кампанией, которой на этом соединении нет.
    backend.handlers.get('init')!(init({ ...OFFERED, status: 'offered', roundsLeft: 3 }));

    expect(bridge.campaign).toMatchObject({ status: 'offered', roundsLeft: 3 });
    expect(seen).toHaveLength(1);
  });

  it('реконнект на сессию без кампании обнуляет снимок', async () => {
    backend.handlers.get('init')!(init(null));
    expect(bridge.campaign).toBeNull();
  });
});
