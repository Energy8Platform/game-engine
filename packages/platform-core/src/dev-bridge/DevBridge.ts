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
}

const DEFAULT_CONFIG: Omit<Required<DevBridgeConfig>, 'luaScript' | 'gameDefinition' | 'luaSeed'> = {
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
  private _config: Required<Pick<DevBridgeConfig, 'balance' | 'currency' | 'gameConfig' | 'assetsUrl' | 'session' | 'onPlay' | 'networkDelay' | 'debug'>> & Pick<DevBridgeConfig, 'luaScript' | 'gameDefinition' | 'luaSeed'>;
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

  constructor(config: DevBridgeConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._balance = this._config.balance;
    this._useLuaServer = !!(this._config.luaScript && this._config.gameDefinition);
    this._sessionTtlMs = parseSessionTtl(this._config.gameDefinition?.session_ttl);
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
    const initData: InitData = {
      balance: this._balance,
      currency: this._config.currency,
      config: this._config.gameConfig as GameConfigData,
      session: this._config.session,
      assetsUrl: this._config.assetsUrl,
    };

    this.delayedSend('INIT', initData, id);
  }

  private handlePlayRequest(
    payload: PlayParams,
    id?: string,
  ): void {
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
   * server-side ActionDefinition.DebitAmount:
   *   - debit: 'bet'             → bet (× ante_bet.cost_multiplier when params.ante_bet=true)
   *   - debit: 'buy_bonus_cost'  → bet × buy_bonus.modes[mode].cost_multiplier
   *   - debit: 'ante_bet_cost'   → bet × ante_bet.cost_multiplier
   *   - anything else (incl. 'none', '', missing action)  →  0
   *
   * The empty/missing default returns 0 to match the server's
   * `decimal.Zero` fallback — important for table-game continuations
   * (e.g. blackjack `hit`/`stand`) where the action exists with no debit.
   *
   * Note: in the platform protocol the client sends the *base* bet only
   * (`PlayParams.bet`); the cost multiplier lives in the GameDefinition.
   * Session continuations must be invoked with the triggering bet — LuaEngine
   * pulls the active session's bet from the persisted session state.
   */
  private computeDebit(
    action: string,
    bet: number,
    params: Record<string, unknown> | undefined,
  ): number {
    const def = this._config.gameDefinition;
    const actionDef = def?.actions?.[action];

    if (!def || !actionDef) {
      // Server short-circuits unknown actions before computing debit;
      // returning 0 here keeps semantics aligned if the guard is ever bypassed.
      return 0;
    }

    switch (actionDef.debit) {
      case 'buy_bonus_cost': {
        const modeName = actionDef.buy_bonus_mode;
        const mode = modeName ? def.buy_bonus?.modes?.[modeName] : undefined;
        if (!mode) {
          console.warn(
            `[DevBridge] Action "${action}" has debit: "buy_bonus_cost" but no matching buy_bonus mode (${modeName ?? '<unset>'}). Falling back to base bet.`,
          );
          return bet;
        }
        return bet * mode.cost_multiplier;
      }
      case 'ante_bet_cost': {
        const multiplier = def.ante_bet?.cost_multiplier;
        if (typeof multiplier !== 'number') {
          console.warn(
            `[DevBridge] Action "${action}" has debit: "ante_bet_cost" but no ante_bet.cost_multiplier defined. Falling back to base bet.`,
          );
          return bet;
        }
        return bet * multiplier;
      }
      case 'bet': {
        // The platform also debits ante_bet pricing on regular `bet` actions
        // when the client signals it via params.ante_bet. Mirror that here.
        if (params && (params as Record<string, unknown>)['ante_bet'] === true) {
          const multiplier = def.ante_bet?.cost_multiplier;
          if (typeof multiplier === 'number') {
            return bet * multiplier;
          }
        }
        return bet;
      }
      default:
        // 'none', '', or any unrecognized debit mode → 0 (server default).
        return 0;
    }
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
