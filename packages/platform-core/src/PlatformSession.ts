import { CasinoGameSDK } from '@energy8platform/game-sdk';
import type {
  InitData,
  PlayParams,
  PlayResultData,
  BalanceData,
} from '@energy8platform/game-sdk';
import { DevBridge, type DevBridgeConfig } from './dev-bridge/DevBridge';
import { EventEmitter } from './EventEmitter';

/**
 * Options for {@link createPlatformSession}.
 */
export interface PlatformSessionConfig {
  /**
   * Optional DevBridge mock-host config. When provided, a DevBridge is started
   * in-process and the SDK connects to it via in-memory channel — no real
   * casino backend required. Use this for local development and offline
   * testing.
   */
  dev?: DevBridgeConfig;

  /**
   * SDK configuration. Pass an options object, or `false` to skip SDK
   * initialization entirely (no host communication, used by tests and
   * head-less simulation).
   */
  sdk?: SDKOptions | false;
}

export interface SDKOptions {
  parentOrigin?: string;
  timeout?: number;
  debug?: boolean;
  /** Use in-memory channel instead of postMessage (no iframe required) */
  devMode?: boolean;
}

/**
 * Events forwarded from the underlying SDK by the PlatformSession.
 */
export interface PlatformSessionEvents {
  /** Player balance changed (forwarded from CasinoGameSDK) */
  balanceUpdate: BalanceData;
  /** SDK or transport error */
  error: Error;
}

/**
 * Lifecycle wrapper around CasinoGameSDK + (optional) DevBridge.
 *
 * Use `createPlatformSession()` to construct one. The session owns the SDK
 * handshake, optional in-process dev host, and a typed event bus that
 * forwards SDK events upward.
 *
 * Phaser/Three/custom-engine consumers use this directly:
 *
 * ```ts
 * const session = await createPlatformSession({
 *   dev: { luaScript, gameDefinition, balance: 10000, currency: 'EUR' },
 * });
 *
 * session.on('balanceUpdate', ({ balance }) => updateHud(balance));
 * const result = await session.play({ action: 'spin', bet: 1 });
 * ```
 */
export class PlatformSession extends EventEmitter<PlatformSessionEvents> {
  /** SDK instance, or null when `sdk: false` was passed. */
  public readonly sdk: CasinoGameSDK | null;
  /** Data returned by the SDK handshake, or null in offline mode. */
  public readonly initData: InitData | null;
  /** DevBridge mock host, or null when `dev` was not provided. */
  public readonly devBridge: DevBridge | null;

  constructor(opts: {
    sdk: CasinoGameSDK | null;
    initData: InitData | null;
    devBridge: DevBridge | null;
  }) {
    super();
    this.sdk = opts.sdk;
    this.initData = opts.initData;
    this.devBridge = opts.devBridge;
  }

  /** Current player balance from the SDK (0 if no SDK). */
  get balance(): number {
    return this.sdk?.balance ?? 0;
  }

  /** Current currency from the SDK ('USD' fallback). */
  get currency(): string {
    return this.sdk?.currency ?? 'USD';
  }

  /**
   * Send a play request through the SDK and resolve with the host result.
   * Throws if the session was constructed with `sdk: false`.
   */
  async play(params: PlayParams): Promise<PlayResultData> {
    if (!this.sdk) {
      throw new Error('[PlatformSession] play() requires an active SDK (constructed with sdk: false)');
    }
    return this.sdk.play(params);
  }

  /** Tear down the SDK, DevBridge, and clear listeners. */
  destroy(): void {
    this.sdk?.destroy();
    this.devBridge?.destroy();
    this.removeAllListeners();
  }
}

/**
 * Build a PlatformSession.
 *
 * Steps performed:
 *   1. If `config.dev` is set → start a DevBridge with those options
 *   2. Unless `config.sdk === false` → construct CasinoGameSDK and await its handshake
 *   3. Forward `error` and `balanceUpdate` events from the SDK
 */
export async function createPlatformSession(
  config: PlatformSessionConfig = {},
): Promise<PlatformSession> {
  // 1. Optionally start the DevBridge mock host
  let devBridge: DevBridge | null = null;
  if (config.dev) {
    devBridge = new DevBridge(config.dev);
    devBridge.start();
  }

  // 2. Initialize SDK (unless explicitly disabled)
  let sdk: CasinoGameSDK | null = null;
  let initData: InitData | null = null;

  if (config.sdk !== false) {
    const sdkOpts = typeof config.sdk === 'object' ? config.sdk : {};
    sdk = new CasinoGameSDK(sdkOpts);
    initData = await sdk.ready();
  }

  // 3. Build the session and wire SDK event forwarding
  const session = new PlatformSession({ sdk, initData, devBridge });

  if (sdk) {
    sdk.on('error', (err: Error) => {
      session.emit('error', err);
    });
    sdk.on('balanceUpdate', (data: BalanceData) => {
      session.emit('balanceUpdate', data);
    });
  }

  return session;
}
