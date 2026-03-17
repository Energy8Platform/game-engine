import {
  Bridge,
  type BridgeMessageType,
  type InitData,
  type GameConfigData,
  type PlayResultData,
  type SessionData,
  type PlayResultAckPayload,
} from '@energy8platform/game-sdk';

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
  onPlay?: (params: { action: string; bet: number; roundId?: string }) => Partial<PlayResultData>;
  /** Simulated network delay in ms */
  networkDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Required<DevBridgeConfig> = {
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
 * This allows games to be developed and tested without a real backend.
 *
 * @example
 * ```ts
 * // In your dev entry point or vite plugin
 * import { DevBridge } from '@energy8platform/game-engine/debug';
 *
 * const devBridge = new DevBridge({
 *   balance: 5000,
 *   currency: 'EUR',
 *   gameConfig: { id: 'my-slot', type: 'slot', betLevels: [0.2, 0.5, 1, 2] },
 *   onPlay: ({ action, bet }) => ({
 *     totalWin: Math.random() > 0.5 ? bet * (Math.random() * 20) : 0,
 *     data: {
 *       matrix: generateRandomMatrix(5, 3, 10),
 *       win_lines: [],
 *     },
 *   }),
 * });
 * devBridge.start();
 * ```
 */
export class DevBridge {
  private _config: Required<DevBridgeConfig>;
  private _balance: number;
  private _roundCounter = 0;
  private _bridge: Bridge | null = null;

  constructor(config: DevBridgeConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._balance = this._config.balance;
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

    this._bridge.on('PLAY_REQUEST', (payload: { action: string; bet: number; roundId?: string }, id?: string) => {
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
      console.log('[DevBridge] Started — listening via Bridge (devMode)');
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
    payload: { action: string; bet: number; roundId?: string },
    id?: string,
  ): void {
    const { action, bet, roundId } = payload;

    // Deduct bet
    this._balance -= bet;
    this._roundCounter++;

    // Generate result
    const customResult = this._config.onPlay({ action, bet, roundId });
    const totalWin = customResult.totalWin ?? (Math.random() > 0.6 ? bet * (1 + Math.random() * 10) : 0);

    // Credit win
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
      console.log('[DevBridge] 💰 Open deposit requested (mock: adding 1000)');
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
