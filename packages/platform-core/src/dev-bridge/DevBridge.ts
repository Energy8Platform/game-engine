import {
  Bridge,
  type BridgeMessageType,
  type InitData,
  type GameConfigData,
  type PlayResultData,
  type SessionData,
  type PlayResultAckPayload,
  type PlayParams,
} from '@energy8platform/game-sdk';
import type { GameDefinition, BetLevelsConfig } from '../lua/types';

/**
 * A detected replay launch — the host wants to re-play a historical round
 * instead of placing live bets. `mode`/`roundId` are forwarded verbatim to
 * {@link ReplayConfig.resolve}.
 */
export interface ReplayLaunch {
  /** Game mode the round was recorded in (e.g. "BASE", "BONUS"). */
  mode?: string;
  /** Identifier of the recorded round to replay. */
  roundId?: string;
}

/**
 * Opt-in replay support for the DevBridge mock host.
 *
 * In production the casino backend serves a recorded round; in dev the
 * DevBridge IS the host. Provide a `resolve` callback that returns the
 * recorded rounds — DevBridge stays agnostic about where they come from
 * (fetch, static fixtures, localStorage, …). When a replay launch is
 * detected, the bridge flips `config.replayMode = true` and feeds the
 * recorded `PlayResultData[]` back on each play request, without touching
 * the wallet.
 */
export interface ReplayConfig {
  /**
   * Resolve the recorded rounds for a replay launch. Receives the `mode`
   * and `roundId` from {@link detect}. May be async (e.g. a fetch).
   */
  resolve: (
    mode: string | undefined,
    roundId: string | undefined,
  ) => PlayResultData[] | Promise<PlayResultData[]>;

  /**
   * Decide whether this launch is a replay and extract its params.
   * Defaults to reading `?replay=1&mode=…&event=…` from the browser URL.
   * Return `null` for a normal (non-replay) launch.
   */
  detect?: () => ReplayLaunch | null;
}

/**
 * Default replay detector — reads `?replay=…&mode=…&event=…` from the
 * browser URL. Returns `null` outside the browser or when `replay` is absent
 * or falsy, so the bridge falls back to normal (live) play.
 */
function defaultReplayDetect(): ReplayLaunch | null {
  const loc = (globalThis as { location?: { search?: string } }).location;
  if (!loc?.search) return null;
  const params = new URLSearchParams(loc.search);
  const replay = params.get('replay');
  if (!replay || replay === '0' || replay === 'false') return null;
  return {
    mode: params.get('mode') ?? undefined,
    roundId: params.get('event') ?? params.get('roundId') ?? undefined,
  };
}

/** Default session TTL when GameDefinition.session_ttl is omitted (24h). */
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a Go-style duration string ("24h", "5ms", "30s", "10m") into
 * milliseconds. Mirrors GameDefinition.SessionTTLDuration on the server.
 */
function parseSessionTtl(ttl: string | undefined): number {
  if (!ttl) return DEFAULT_SESSION_TTL_MS;
  const m = ttl.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!m) return DEFAULT_SESSION_TTL_MS;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'ms': return n;
    case 's':  return n * 1000;
    case 'm':  return n * 60 * 1000;
    case 'h':  return n * 60 * 60 * 1000;
    default:   return DEFAULT_SESSION_TTL_MS;
  }
}

/**
 * Validate a bet against the game's bet_levels config — mirrors the server's
 * validateBet. Levels-list takes priority over min/max range.
 */
function isBetAllowed(bet: number, levels: number[] | BetLevelsConfig | undefined): boolean {
  if (!levels) return true;
  if (Array.isArray(levels)) {
    return levels.includes(bet);
  }
  if (levels.levels && levels.levels.length > 0) {
    return levels.levels.includes(bet);
  }
  if (levels.min !== undefined && bet < levels.min) return false;
  if (levels.max !== undefined && bet > levels.max) return false;
  return true;
}

/**
 * Generate a server-style UUID for a fresh round. Falls back to a counter
 * suffix if `crypto.randomUUID` isn't available (very old runtimes).
 */
function generateRoundId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Minimal fallback — not crypto-strong, but keeps the wire shape sane.
  return 'dev-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
}

export interface DevBridgeConfig {
  /** Mock initial balance */
  balance?: number;
  /** Mock currency */
  currency?: string;
  /** Game config */
  gameConfig?: Partial<GameConfigData>;
  /** Base URL for assets (default: '/assets/') */
  assetsUrl?: string;
  /** Active session to resume (null = no active session) */
  session?: SessionData | null;
  /** Custom play result handler — return mock result data */
  onPlay?: (params: PlayParams) => Partial<PlayResultData>;
  /** Simulated network delay in ms */
  networkDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Lua script source code. When set, play requests are routed to the Vite dev server's LuaEngine. */
  luaScript?: string;
  /** Game definition for Lua engine (actions, transitions, etc.) */
  gameDefinition?: GameDefinition;
  /** RNG seed for deterministic Lua execution */
  luaSeed?: number;
  /**
   * Opt-in historical-round replay. When the detector reports a replay
   * launch, the bridge serves recorded rounds instead of running Lua/onPlay.
   * See {@link ReplayConfig}.
   */
  replay?: ReplayConfig;
}

const DEFAULT_CONFIG: Omit<Required<DevBridgeConfig>, 'luaScript' | 'gameDefinition' | 'luaSeed' | 'replay'> = {
  balance: 10000,
  currency: 'USD',
  gameConfig: {
    id: 'dev-game',
    type: 'slot',
    version: '1.0.0',
    viewport: { width: 1920, height: 1080 },
    betLevels: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50],
  },
  assetsUrl: '/assets/',
  session: null,
  onPlay: () => ({}),
  networkDelay: 200,
  debug: true,
};

/**
 * Mock host bridge for local development.
 *
 * Uses the SDK's `Bridge` class in `devMode` to communicate with
 * `CasinoGameSDK` via a shared in-memory `MemoryChannel`, removing
 * the need for postMessage and iframes.
 *
 * When `luaScript` is set, play requests are sent to the Vite dev server
 * which runs LuaEngine in Node.js — no fengari in the browser.
 *
 * @example
 * ```ts
 * import { DevBridge } from '@energy8platform/platform-core/dev-bridge';
 *
 * const devBridge = new DevBridge({
 *   balance: 5000,
 *   currency: 'EUR',
 *   gameConfig: { id: 'my-slot', type: 'slot', betLevels: [0.2, 0.5, 1, 2] },
 *   onPlay: ({ action, bet }) => ({
 *     totalWin: Math.random() > 0.5 ? bet * (Math.random() * 20) : 0,
 *     data: { matrix: [[1,2,3],[4,5,6],[7,8,9]] },
 *   }),
 * });
 * devBridge.start();
 * ```
 */
export class DevBridge {
  private _config: Required<Pick<DevBridgeConfig, 'balance' | 'currency' | 'gameConfig' | 'assetsUrl' | 'session' | 'onPlay' | 'networkDelay' | 'debug'>> & Pick<DevBridgeConfig, 'luaScript' | 'gameDefinition' | 'luaSeed' | 'replay'>;
  private _balance: number;
  private _roundCounter = 0;
  private _bridge: Bridge | null = null;
  private _useLuaServer: boolean;
  /** Last PlayResult sent — mirrors what `GET /games/{id}/session` returns. */
  private _lastPlayResult: PlayResultData | null = null;
  /** Active session round id; non-null while a session is in progress. */
  private _activeRoundId: string | null = null;
  /** Wall-clock expiry timestamp for the active session. */
  private _sessionExpiresAt: number | null = null;
  /** Pre-parsed session TTL from gameDefinition.session_ttl. */
  private _sessionTtlMs: number;
  /** Detected replay launch, or null when not replaying. */
  private _replayLaunch: ReplayLaunch | null = null;
  /** Recorded rounds for the active replay (resolved lazily once). */
  private _replayResults: Promise<PlayResultData[]> | null = null;
  /** Cursor into the recorded rounds; wraps to 0 on "Play Again". */
  private _replayCursor = 0;

  constructor(config: DevBridgeConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._balance = this._config.balance;
    this._useLuaServer = !!(this._config.luaScript && this._config.gameDefinition);
    this._sessionTtlMs = parseSessionTtl(this._config.gameDefinition?.session_ttl);
    if (this._config.replay) {
      const detect = this._config.replay.detect ?? defaultReplayDetect;
      this._replayLaunch = detect();
    }
  }

  /** True when this bridge was launched as a historical-round replay. */
  get isReplay(): boolean {
    return this._replayLaunch !== null;
  }

  /** Current mock balance */
  get balance(): number {
    return this._balance;
  }

  /** Start listening for SDK messages */
  start(): void {
    if (this._bridge) return;

    console.debug('[DevBridge] Starting with config:', this._config);

    this._bridge = new Bridge({ devMode: true, debug: this._config.debug });

    this._bridge.on('GAME_READY', (_payload: unknown, id?: string) => {
      this.handleGameReady(id);
    });

    this._bridge.on('PLAY_REQUEST', (payload: PlayParams, id?: string) => {
      this.handlePlayRequest(payload, id);
    });

    this._bridge.on('PLAY_RESULT_ACK', (payload: PlayResultAckPayload) => {
      this.handlePlayAck(payload);
    });

    this._bridge.on('GET_BALANCE', (_payload: unknown, id?: string) => {
      this.handleGetBalance(id);
    });

    this._bridge.on('GET_STATE', (_payload: unknown, id?: string) => {
      this.handleGetState(id);
    });

    this._bridge.on('OPEN_DEPOSIT', () => {
      this.handleOpenDeposit();
    });

    if (this._config.debug) {
      const mode = this._useLuaServer ? 'Lua (server-side)' : 'onPlay callback';
      console.log(`[DevBridge] Started — mode: ${mode}`);
    }
  }

  /** Stop listening */
  stop(): void {
    if (this._bridge) {
      this._bridge.destroy();
      this._bridge = null;
    }

    if (this._config.debug) {
      console.log('[DevBridge] Stopped');
    }
  }

  /** Set mock balance */
  setBalance(balance: number): void {
    this._balance = balance;
    this._bridge?.send('BALANCE_UPDATE', { balance: this._balance });
  }

  /** Destroy the dev bridge */
  destroy(): void {
    this.stop();
  }

  // ─── Message Handling ──────────────────────────────────

  private handleGameReady(id?: string): void {
    if (this._replayLaunch) {
      this.handleReplayGameReady(id);
      return;
    }

    const initData: InitData = {
      balance: this._balance,
      currency: this._config.currency,
      config: this._config.gameConfig as GameConfigData,
      session: this._config.session,
      assetsUrl: this._config.assetsUrl,
    };

    this.delayedSend('INIT', initData, id);
  }

  /**
   * Replay INIT: flip `config.replayMode = true` and take balance/currency
   * from the recorded results (the wallet is never touched in replay).
   */
  private handleReplayGameReady(id?: string): void {
    this.resolveReplayResults()
      .then((results) => {
        const first = results[0];
        if (first) {
          this._balance = first.balanceAfter;
        }
        const initData: InitData = {
          balance: this._balance,
          currency: first?.currency ?? this._config.currency,
          config: {
            ...this._config.gameConfig,
            replayMode: true,
          } as GameConfigData,
          session: null,
          assetsUrl: this._config.assetsUrl,
        };
        this.delayedSend('INIT', initData, id);
      })
      .catch((err) => {
        console.error('[DevBridge] Replay resolve failed:', err);
        this.sendError(id, 'ENGINE_ERROR', err?.message ?? 'replay resolve failed');
      });
  }

  /** Resolve (and cache) the recorded rounds for the active replay launch. */
  private resolveReplayResults(): Promise<PlayResultData[]> {
    if (!this._replayResults) {
      const { mode, roundId } = this._replayLaunch ?? {};
      this._replayResults = Promise.resolve(
        this._config.replay!.resolve(mode, roundId),
      );
    }
    return this._replayResults;
  }

  /**
   * Replay PLAY_REQUEST: serve the recorded round at the cursor and advance.
   * No wallet movement, no bet/session validation. The first spin past the
   * end resets the cursor to 0 ("Play Again"). An empty record list behaves
   * like an exhausted live session.
   */
  private handleReplayPlay(id?: string): void {
    this.resolveReplayResults()
      .then((results) => {
        if (!results || results.length === 0) {
          this.sendError(id, 'NO_ACTIVE_SESSION', 'replay has no recorded rounds');
          return;
        }
        // Play Again: a spin past the end wraps back to the first round.
        if (this._replayCursor >= results.length) {
          this._replayCursor = 0;
        }
        const next = results[this._replayCursor++];
        this._lastPlayResult = next;
        // Mirror the recorded balance so GET_BALANCE / HUD stay consistent.
        this._balance = next.balanceAfter;
        this.delayedSend('PLAY_RESULT', next, id);
      })
      .catch((err) => {
        console.error('[DevBridge] Replay resolve failed:', err);
        this.sendError(id, 'ENGINE_ERROR', err?.message ?? 'replay resolve failed');
      });
  }

  private handlePlayRequest(
    payload: PlayParams,
    id?: string,
  ): void {
    if (this._replayLaunch) {
      this.handleReplayPlay(id);
      return;
    }

    const { action, bet, params } = payload;
    this._roundCounter++;

    if (this._useLuaServer) {
      const def = this._config.gameDefinition!;
      // Mirror the server's INVALID_INPUT short-circuit: an unknown action
      // is rejected before any wallet movement, with no PLAY_RESULT.
      const actionDef = def.actions?.[action];
      if (!actionDef) {
        this.sendError(id, 'INVALID_INPUT', `unknown action "${action}"`);
        return;
      }

      // Bet validation — server returns 400 INVALID_AMOUNT before the
      // engine. We mirror that so games can't silently accept bad bets.
      if (!isBetAllowed(bet, def.bet_levels)) {
        this.sendError(id, 'INVALID_AMOUNT', `bet ${bet} is not in allowed bet_levels`);
        return;
      }

      // Session-state guards (server: 409 ACTIVE_SESSION_EXISTS / 404 NoActiveSession / 410 ExpiredSession).
      const sessionExpired =
        this._activeRoundId !== null &&
        this._sessionExpiresAt !== null &&
        Date.now() > this._sessionExpiresAt;

      if (actionDef.requires_session) {
        if (sessionExpired) {
          this.clearSessionState();
          this.sendError(id, 'SESSION_EXPIRED', 'game session has expired');
          return;
        }
        if (this._activeRoundId === null) {
          this.sendError(id, 'NO_ACTIVE_SESSION', `action "${action}" requires an active session`);
          return;
        }
      } else {
        // Non-session action over an active (non-expired) session — server's
        // acquireSession would fail with ACTIVE_SESSION_EXISTS.
        if (this._activeRoundId !== null && !sessionExpired) {
          this.sendError(id, 'ACTIVE_SESSION_EXISTS', 'an active game session already exists');
          return;
        }
        if (sessionExpired) {
          // Drop stale session state so a fresh non-session action can proceed.
          this.clearSessionState();
        }
      }

      // Compute the debit amount for this action — mirrors the platform's
      // server-side rules so Buy Bonus / Ante Bet actions debit the right
      // multiple of bet instead of just the base bet.
      const debit = this.computeDebit(action, bet, params);

      // Server returns 402 INSUFFICIENT_FUNDS before the wallet is touched
      // and never reaches the engine. DevBridge must do the same so the
      // SDK's play() rejects with the right SDKError code.
      if (debit > this._balance) {
        this.sendError(
          id,
          'INSUFFICIENT_FUNDS',
          `insufficient funds (need ${debit}, have ${this._balance})`,
        );
        return;
      }

      this._balance -= debit;

      // Round id rules mirror server's playRound:
      //   non-session  → fresh UUID, client-supplied id is ignored
      //   session-based → reuse the active session's round id
      const serverRoundId = actionDef.requires_session
        ? this._activeRoundId!
        : generateRoundId();

      this.executeLuaOnServer({ action, bet, roundId: serverRoundId, params })
        .then((result) => {
          this._lastPlayResult = result;
          this.updateSessionState(result);
          this._bridge?.send('PLAY_RESULT', result, id);
        })
        .catch((err) => {
          console.error('[DevBridge] Lua server error:', err);
          this._balance += debit;
          this.sendError(id, 'ENGINE_ERROR', err?.message ?? 'lua execution failed');
        });
    } else {
      // Fallback to onPlay callback
      const { roundId } = payload;
      const customResult = this._config.onPlay({ action, bet, roundId, params });
      const totalWin = customResult.totalWin ?? (Math.random() > 0.6 ? bet * (1 + Math.random() * 10) : 0);

      this._balance += totalWin;

      const result: PlayResultData = {
        roundId: roundId ?? `dev-round-${this._roundCounter}`,
        action,
        balanceAfter: this._balance,
        totalWin: Math.round(totalWin * 100) / 100,
        data: customResult.data ?? {},
        nextActions: customResult.nextActions ?? ['spin'],
        session: customResult.session ?? null,
        creditPending: false,
        bonusFreeSpin: customResult.bonusFreeSpin ?? null,
        currency: this._config.currency,
        gameId: this._config.gameConfig?.id ?? 'dev-game',
      };

      this._lastPlayResult = result;
      this.delayedSend('PLAY_RESULT', result, id);
    }
  }

  /** Send a PLAY_ERROR correlated to the original PLAY_REQUEST id. */
  private sendError(id: string | undefined, code: string, message: string): void {
    this._bridge?.send('PLAY_ERROR', { code, message }, id);
  }

  /**
   * Refresh tracked session state from the latest PlayResult.
   *  - new/ongoing session → remember roundId + (re)set expiry
   *  - completed/no session → clear tracking
   */
  private updateSessionState(result: PlayResultData): void {
    const session = result.session;
    if (session && !session.completed) {
      if (this._activeRoundId === null) {
        this._activeRoundId = result.roundId;
        this._sessionExpiresAt = Date.now() + this._sessionTtlMs;
      }
    } else {
      this.clearSessionState();
    }
  }

  /** Drop active-session tracking (called on completion or expiry sweep). */
  private clearSessionState(): void {
    this._activeRoundId = null;
    this._sessionExpiresAt = null;
  }

  /**
   * Compute the wallet debit for a play request, mirroring the platform's
   * v5 ActionDefinition.DebitAmount:
   *   - debit: 'bet'           → bet × (cost_multiplier || 1)
   *   - debit: 'none'/missing  → 0
   *   - any other value        → 0 (legacy v4 modes like 'buy_bonus_cost'
   *                                are no longer recognized; surfacing as 0
   *                                forces config breakage to the surface)
   *
   * The action carries its own cost (cost_multiplier + opaque feature_data).
   * No top-level buy_bonus/ante_bet blocks. No params.ante_bet flag — ante
   * is just a separate action with its own cost_multiplier.
   */
  private computeDebit(
    action: string,
    bet: number,
    _params: Record<string, unknown> | undefined,
  ): number {
    const actionDef = this._config.gameDefinition?.actions?.[action];
    if (!actionDef || actionDef.debit !== 'bet') {
      return 0;
    }
    const mult = actionDef.cost_multiplier;
    if (typeof mult === 'number' && mult > 0 && mult !== 1) {
      return bet * mult;
    }
    return bet;
  }

  private async executeLuaOnServer(params: PlayParams): Promise<PlayResultData> {
    const response = await fetch('/__lua-play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error ?? `HTTP ${response.status}`);
    }

    const luaResult = await response.json();

    // Server credit logic:
    // shouldCredit = (no session) OR (session.completed)
    // creditAmount = result.totalWin
    const shouldCredit = !luaResult.session || luaResult.session.completed;
    if (shouldCredit && luaResult.totalWin > 0) {
      this._balance += luaResult.totalWin;
    }

    return {
      roundId: params.roundId ?? `dev-round-${this._roundCounter}`,
      action: params.action,
      balanceAfter: this._balance,
      totalWin: Math.round(luaResult.totalWin * 100) / 100,
      data: luaResult.data,
      nextActions: luaResult.nextActions,
      session: luaResult.session,
      // creditPending=true on the wire means "wallet credit failed, queued
      // for retry" — not "credit deferred until session completes". DevBridge
      // never simulates credit failures, so this is always false.
      creditPending: false,
      bonusFreeSpin: null,
      currency: this._config.currency,
      gameId: this._config.gameConfig?.id ?? 'dev-game',
    };
  }

  private handlePlayAck(_payload: PlayResultAckPayload): void {
    if (this._config.debug) {
      console.log('[DevBridge] Play acknowledged');
    }
  }

  private handleGetBalance(id?: string): void {
    this.delayedSend('BALANCE_UPDATE', { balance: this._balance }, id);
  }

  private handleGetState(id?: string): void {
    // Mirror the platform's GET /games/{id}/session: the response wraps the
    // last PlayResult-shaped snapshot, which the SDK reads back as
    // `payload.session.session` (SessionData) and `payload.session.balanceAfter`.
    // Only surface it while a session is active and not yet completed —
    // matches GameUseCase.GetActiveSession.
    const last = this._lastPlayResult;
    const session = last && last.session && !last.session.completed ? last : null;
    this.delayedSend('STATE_RESPONSE', { session }, id);
  }

  private handleOpenDeposit(): void {
    if (this._config.debug) {
      console.log('[DevBridge] Open deposit requested (mock: adding 1000)');
    }
    this._balance += 1000;
    this._bridge?.send('BALANCE_UPDATE', { balance: this._balance });
  }

  // ─── Communication ─────────────────────────────────────

  private delayedSend(type: BridgeMessageType, payload: unknown, id?: string): void {
    const delay = this._config.networkDelay;
    if (delay > 0) {
      setTimeout(() => this._bridge?.send(type, payload, id), delay);
    } else {
      this._bridge?.send(type, payload, id);
    }
  }
}
