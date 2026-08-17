/**
 * Как соединение узнаёт, что сессия демо.
 *
 * Живая платформа прислала `SessionInfoResponse` БЕЗ поля `currency` — не
 * `null`, как обещает `demo-mode.md`, и не ISO-строку, как требует
 * `session-info.md`, — а потом отвергла спин с
 * `OperationNotAllowed: Operation Latest is not allowed for demo user.`
 *
 * Прочитать из этого «нет ключа ⇒ демо» нельзя: ровно так же выглядит
 * РЕАЛЬНАЯ сессия, чья валюта совпала с дефолтом сериализатора (игрок:
 * «с другой любой валютой работает, а с дефолтной USD видимо нет»). Поэтому
 * демо — только явный `null` и только вердикт самой платформы; отсутствие
 * поля читается как реальные деньги и проверяется одним запросом.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { handleConnection } from '../src/http/ws';
import { classifyCurrency, isDemoSession, buildInit, demoStartingBalance } from '../src/session/init';
import { GamesApiError, isDemoUserRejection } from '../src/games-api/errors';
import type { SessionInfoResponse } from '../src/games-api/types';
import type { Logger, LogContext } from '../src/http/log';

const GAME_SETTINGS = {
  default_bet_index: 3,
  currency_minimal_unit: 0.01,
  allowed_bets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  available_auto_spin_counts: [10, 25, 50],
  rtp_options: [],
  rtp_settings: { is_visible: false },
  locales: ['EN'],
};

/**
 * `SessionInfoResponse` в том виде, в каком он приходит по проводу.
 * `Partial` намеренно: смысл теста — поля, которых в JSON нет.
 */
function info(overrides: Partial<SessionInfoResponse> = {}): SessionInfoResponse {
  return { security_hash: 'h', balance: 999999, game_settings: GAME_SETTINGS, ...overrides };
}

/** Отказ платформы ровно в той форме, в какой он приехал с живого стенда. */
function demoRejection(operation = 'Latest'): GamesApiError {
  return new GamesApiError({
    code: 'OperationNotAllowed',
    message: `Operation ${operation} is not allowed for demo user.`,
  });
}

class FakeSocket extends EventEmitter {
  readonly sent: any[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {}
}

/** Движок, который отдаёт один финальный сегмент с выигрышем 2× ставки. */
const engine = {
  startRound: async () => ({
    error: '',
    script_sha256: 'sha',
    data_json: '{}',
    win: 2,
    total_win: 2,
    next_actions: [] as string[],
    spins_remaining: 0,
    spins_played: 1,
    round_complete: true,
  }),
};

/**
 * Движок многосегментного раунда: первый сегмент открывает фичу, второй её
 * закрывает. Нужен, чтобы проверить середину раунда — там переключаться нельзя.
 */
function complexEngine() {
  const segment = (final: boolean) => ({
    error: '',
    script_sha256: 'sha',
    data_json: '{}',
    win: 1,
    total_win: final ? 3 : 1,
    next_actions: final ? [] : ['free_spin'],
    spins_remaining: final ? 0 : 1,
    spins_played: final ? 2 : 1,
    round_complete: final,
  });
  return {
    startRound: vi.fn(async () => segment(false)),
    getRound: vi.fn(async () => ({ found: true, script_sha256: 'sha', spins_played: 1 })),
    step: vi.fn(async () => segment(true)),
  };
}

interface PlatformOptions {
  /** Отвергать раундовые RPC вердиктом «демо-пользователь». */
  rejectAsDemo?: boolean;
  /** Своя ошибка для раундовых RPC — для проверки, что чужой отказ не переключает. */
  rejectWith?: () => Error;
}

/** Заглушка платформы: считает КАЖДУЮ раундовую RPC, которой могло не быть. */
function platformApi(session: SessionInfoResponse, opts: PlatformOptions = {}) {
  const reject = opts.rejectWith ?? (opts.rejectAsDemo ? () => demoRejection() : null);
  const guard = <T>(value: () => T) => async () => {
    if (reject) throw reject();
    return value();
  };
  return {
    sessionInfo: vi.fn(async () => session),
    playRound: vi.fn(guard(() => ({
      round_id: 'r', balance: 42, win: 0, is_platform_max_win_reached: false,
    }))),
    openRound: vi.fn(guard(() => ({ round_version: 0, round_id: 'r', balance: 42 }))),
    updateRoundState: vi.fn(guard(() => ({ round_version: 1 }))),
    closeRound: vi.fn(guard(() => ({ balance: 42 }))),
    autocloseRound: vi.fn(guard(() => ({ balance: 42 }))),
    on: () => {},
    off: () => {},
  };
}

function collectingLog(warnings: Array<{ message: string; context?: LogContext }>): Logger {
  const log: Logger = {
    info: () => {},
    warn: (message, context) => warnings.push({ message, context }),
    error: () => {},
    child: () => log,
  };
  return log;
}

interface PlaySession {
  api: ReturnType<typeof platformApi>;
  warnings: Array<{ message: string; context?: LogContext }>;
  init: any;
  /** Сыграть ещё одно действие и дождаться ответа на него. */
  play(action?: string): Promise<{ result?: any; error?: any }>;
}

/** Поднять соединение и дать играть по одному действию за раз. */
async function openSession(
  session: SessionInfoResponse,
  opts: PlatformOptions & { startingDemoBalance?: number; engine?: unknown } = {},
): Promise<PlaySession> {
  const socket = new FakeSocket();
  const api = platformApi(session, opts);
  const warnings: Array<{ message: string; context?: LogContext }> = [];
  await handleConnection(socket as unknown as WebSocket, 'sess', {
    api: api as any,
    engine: (opts.engine ?? engine) as any,
    gameId: 'g',
    costMultipliers: { spin: 1, free_spin: 0 },
    startingDemoBalance: opts.startingDemoBalance ?? 1000,
    log: collectingLog(warnings),
  });
  let plays = 0;
  const play = async (action = 'spin') => {
    const id = `p${++plays}`;
    socket.emit('message', JSON.stringify({ t: 'play', id, action, betIndex: 3 }));
    for (let i = 0; i < 100; i++) {
      const answered = socket.sent.find((m) => (m.t === 'result' || m.t === 'error') && m.id === id);
      if (answered) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return {
      result: socket.sent.find((m) => m.t === 'result' && m.id === id),
      error: socket.sent.find((m) => m.t === 'error' && m.id === id),
    };
  };
  return { api, warnings, init: socket.sent.find((m) => m.t === 'init'), play };
}

/** Ни одна из пяти раундовых RPC доки не должна была уйти на платформу. */
function expectNoRoundRpcs(api: ReturnType<typeof platformApi>): void {
  expect(api.playRound).not.toHaveBeenCalled();
  expect(api.openRound).not.toHaveBeenCalled();
  expect(api.updateRoundState).not.toHaveBeenCalled();
  expect(api.closeRound).not.toHaveBeenCalled();
  expect(api.autocloseRound).not.toHaveBeenCalled();
}

describe('чтение currency из SessionInfo', () => {
  it('отсутствие currency НЕ делает сессию демо: раунд уходит на платформу', async () => {
    const s = await openSession(info());
    const { result, error } = await s.play();

    expect(s.init.demo).toBe(false);
    expect(error).toBeUndefined();
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
    expect(result.balanceAfter).toBe(42); // баланс платформы, не локальный
  });

  it('отклонение от доки попадает в лог, но сессию не переводит в демо', async () => {
    const s = await openSession(info());
    const deviation = s.warnings.find((w) => w.message.includes('currency'));

    expect(deviation).toBeDefined();
    expect(deviation!.context?.currency_on_wire).toBe('absent');
    expect(deviation!.message).toContain('реальные деньги');
  });

  it('явный currency: null — задокументированное демо, без предупреждения', async () => {
    const s = await openSession(info({ currency: null }));
    const { result } = await s.play();

    expect(s.init.demo).toBe(true);
    expect(result).toBeDefined();
    expectNoRoundRpcs(s.api);
    expect(s.warnings.find((w) => w.message.includes('currency'))).toBeUndefined();
  });

  it('настоящая валюта — это реальные деньги: раунд уходит на платформу', async () => {
    const s = await openSession(info({ currency: 'USD' }));
    const { result } = await s.play();

    expect(s.init.demo).toBe(false);
    expect(s.init.currency).toBe('USD');
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
    expect(result.balanceAfter).toBe(42);
  });

  it('валюту не назвали — играем в USD за реальные деньги, а не в демо', async () => {
    // Поле пропадает из ответа у ДЕФОЛТНОЙ валюты (сериализатор выбрасывает
    // значения, равные дефолтному), и наблюдение это подтверждает: на любой
    // явно заданной валюте всё работало, ломалось только здесь.
    const s = await openSession(info());
    const { result } = await s.play();

    expect(s.init.demo).toBe(false);
    expect(s.init.currency).toBe('USD');
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
    expect(result.balanceAfter).toBe(42);
  });

  it('в собственном кадре демо — отдельное поле, а валюта явный null', async () => {
    const { init } = await openSession(info({ currency: null }));

    expect(init).toHaveProperty('currency');
    expect(init.currency).toBeNull();
    expect(init.demo).toBe(true);
  });

  it('пустая строка и не-строка — тоже не признак демо, а отклонение', () => {
    expect(isDemoSession(info({ currency: '' }))).toBe(false);
    expect(classifyCurrency(info({ currency: '' }))).toMatchObject({
      demo: false, wire: 'invalid', code: 'USD', deviates: true,
    });
    expect(classifyCurrency(info({ currency: 7 as unknown as string }))).toMatchObject({
      demo: false, wire: 'invalid', deviates: true,
    });
  });

  it('классификация провода: демо — ровно и только явный null', () => {
    expect(classifyCurrency(info({ currency: 'USD' }))).toMatchObject({
      demo: false, wire: 'code', code: 'USD', deviates: false,
    });
    expect(classifyCurrency(info({ currency: null }))).toMatchObject({
      demo: true, wire: 'null', code: null, deviates: false,
    });
    // Валюту не назвали — это USD, а не отсутствие валюты: поле пропадает у
    // дефолтного значения, и на любой явно заданной валюте всё работало.
    expect(classifyCurrency(info())).toMatchObject({
      demo: false, wire: 'absent', code: 'USD', deviates: true,
    });
  });
});

describe('вердикт платформы отказом на раундовой RPC', () => {
  it('распознаётся по коду И по тексту, без привязки к имени операции', () => {
    // Живой провод: без артикля. Дока (error-handling.md:209): с артиклем.
    expect(isDemoUserRejection(demoRejection())).toBe(true);
    expect(isDemoUserRejection(demoRejection('OpenRound'))).toBe(true);
    expect(isDemoUserRejection(new GamesApiError({
      code: 'OperationNotAllowed',
      message: 'Operation PlayRound is not allowed for a demo user.',
    }))).toBe(true);

    // Тот же код, но про другое: реального игрока переводить нельзя.
    expect(isDemoUserRejection(new GamesApiError({
      code: 'OperationNotAllowed', message: 'Operation PlayRound is not allowed.',
    }))).toBe(false);
    // Про демо, но другой код — это не вердикт о сессии.
    expect(isDemoUserRejection(new GamesApiError({
      code: 'InvalidRoundOperation', message: 'not allowed for demo user',
    }))).toBe(false);
    expect(isDemoUserRejection(new Error('Operation X is not allowed for demo user.'))).toBe(false);
  });

  it('спин, отвергнутый как демо, доигрывается локально — игрок видит успех', async () => {
    const s = await openSession(info(), { rejectAsDemo: true });
    const { result, error } = await s.play();

    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    // Проба ушла ровно одна, и она же — единственная раундовая RPC платформе.
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
    // Ставка allowed_bets[3] = 1, выигрыш 2× → 999999 - 1 + 2.
    expect(result.balanceAfter).toBe(1000000);
    // Раунд после переключения — новый и с чистой позицией: рецепт
    // (`spins_played === 1 + actions.length`) не разъезжается.
    expect(result.spinsPlayed).toBe(1);
    expect(result.creditPending).toBe(false);
  });

  it('переключение переживает действие: второй спин платформу не трогает', async () => {
    const s = await openSession(info(), { rejectAsDemo: true });
    await s.play();
    const second = await s.play();

    expect(second.error).toBeUndefined();
    expect(second.result).toBeDefined();
    // Всё ещё одна проба за всё соединение — переспрашивать нечего.
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
    // Кошелёк непрерывен: 1000000 - 1 + 2.
    expect(second.result.balanceAfter).toBe(1000001);
  });

  it('переключение доходит до лога вместе с текстом платформы', async () => {
    const s = await openSession(info(), { rejectAsDemo: true });
    await s.play();
    const flip = s.warnings.find((w) => w.message.includes('локальный кошелёк'));

    expect(flip).toBeDefined();
    expect(flip!.context?.currency_on_wire).toBe('absent');
    expect(String(flip!.context?.platform_message)).toContain('demo user');
    expect(flip!.context?.demo_balance).toBe(999999);
  });

  it('чужой OperationNotAllowed не переводит сессию на локальный кошелёк', async () => {
    const s = await openSession(info(), {
      rejectWith: () => new GamesApiError({
        code: 'OperationNotAllowed', message: 'Operation PlayRound is not allowed.',
      }),
    });
    const { result, error } = await s.play();

    expect(result).toBeUndefined();
    expect(error.code).toBe('OperationNotAllowed');
    // Ровно одна попытка: локально доигрывать не пытались.
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
  });

  it('середина раунда не переключается: там ставка уже списана платформой', async () => {
    // Первый сегмент открывает раунд на платформе (деньги двинулись), а
    // отказ приходит на CloseRound второго. Досчитать такой раунд локальным
    // кошельком значило бы зачислить выигрыш в бутафорию.
    const failing = complexEngine();
    const s = await openSession(info(), { engine: failing });
    const opened = await s.play();
    expect(opened.result.creditPending).toBe(true);

    s.api.closeRound.mockRejectedValue(demoRejection('CloseRound'));
    const mid = await s.play('free_spin');

    expect(mid.result).toBeUndefined();
    expect(mid.error.code).toBe('OperationNotAllowed');
    expect(s.api.closeRound).toHaveBeenCalled();
  });
});

describe('баланс демо-сессии', () => {
  it('init называет то же число, с которого стартует демо-кошелёк', async () => {
    // Платформа сообщила 999999, DEMO_BALANCE = 1000. Игрок обязан увидеть
    // одно и то же до и после первого спина.
    const s = await openSession(info({ currency: null }), { startingDemoBalance: 1000 });
    const { result } = await s.play();

    expect(s.init.balance).toBe(999999);
    // Ставка allowed_bets[3] = 1, выигрыш 2× → 999999 - 1 + 2.
    expect(result.balanceAfter).toBe(1000000);
  });

  it('непригодный платформенный баланс уступает настроенному DEMO_BALANCE', async () => {
    const s = await openSession(info({ currency: null, balance: 0 }), { startingDemoBalance: 500 });
    const { result } = await s.play();

    expect(s.init.balance).toBe(500);
    expect(result.balanceAfter).toBe(501);
  });

  it('стартовый баланс демо: платформенный, если он пригоден', () => {
    expect(demoStartingBalance(info(), 1000)).toBe(999999);
    expect(demoStartingBalance(info({ balance: 0 }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: -5 }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: undefined }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: NaN }), 1000)).toBe(1000);
  });

  it('реальной сессии баланс никто не подменяет', async () => {
    expect(buildInit(info({ currency: 'USD', balance: 150.75 })).balance).toBe(150.75);
    // И у сессии без валюты тоже: локальный кошелёк ей не заводится вовсе,
    // пока платформа сама не назовёт её демо.
    const s = await openSession(info({ balance: 150.75 }), { startingDemoBalance: 1000 });
    expect(s.init.balance).toBe(150.75);
    expect(s.init.demo).toBe(false);
  });
});
