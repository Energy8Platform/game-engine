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
import type { GameDefinition } from '../lua';

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

  constructor(config: DevBridgeConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._balance = this._config.balance;
    this._useLuaServer = !!(this._config.luaScript && this._config.gameDefinition);
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
    const { action, bet, roundId, params } = payload;
    this._roundCounter++;

    if (this._useLuaServer) {
      // Debit bet (server deducts before Lua execution)
      // For session actions (free spins), debit is 0 — LuaEngine handles bet from session
      this._balance -= bet;

      this.executeLuaOnServer({ action, bet, roundId, params })
        .then((result) => {
          this._bridge?.send('PLAY_RESULT', result, id);
        })
        .catch((err) => {
          console.error('[DevBridge] Lua server error:', err);
          this._balance += bet;
          this._bridge?.send('PLAY_RESULT', this.buildFallbackResult(action, bet, roundId), id);
        });
    } else {
      // Fallback to onPlay callback
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

      this.delayedSend('PLAY_RESULT', result, id);
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
      creditPending: !shouldCredit,
      bonusFreeSpin: null,
      currency: this._config.currency,
      gameId: this._config.gameConfig?.id ?? 'dev-game',
    };
  }

  private buildFallbackResult(action: string, bet: number, roundId?: string): PlayResultData {
    return {
      roundId: roundId ?? `dev-round-${this._roundCounter}`,
      action,
      balanceAfter: this._balance,
      totalWin: 0,
      data: { error: 'Lua execution failed' },
      nextActions: ['spin'],
      session: null,
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
    this.delayedSend('STATE_RESPONSE', { session: this._config.session ?? null }, id);
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
