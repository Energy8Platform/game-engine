/**
 * A constructor shaped like platform-core's `DevBridge`. Declared structurally so this package
 * never has to import platform-core's types — it is an optional peer, and a game that runs only
 * on Stake must build without it installed.
 */
export interface DevBridgeLike {
  start(): void;
  stop(): void;
}

export interface DevBridgeCtor {
  new (config: Record<string, unknown>): DevBridgeLike;
}

/** What the game hands `session-stake` through the `stake.adapter` point. */
export interface StakeAdapterBundle {
  /** The game's `BookAdapter`. Typed as unknown so this package never imports stake-bridge. */
  adapter: unknown;
  /** Spec mode name → Stake mode name. */
  modeMap: Record<string, string>;
  /** The game id Stake knows this game by. */
  gameId: string;
}

/** A constructor shaped like stake-bridge's `StakeBridge`. Structural, for the same peer reason. */
export interface StakeBridgeLike {
  ready(): Promise<void>;
  destroy?(): void;
}

export interface StakeBridgeCtor {
  new (options: Record<string, unknown>): StakeBridgeLike;
}

/**
 * What a session provider is, and — more importantly — what it is not.
 *
 * A provider does NOT return a session. Every backend in this codebase (DevBridge, StakeBridge,
 * ArtubeBridge) installs itself on the same in-process SDK memory channel, and then ONE
 * `createPlatformSession()` handshake talks to whatever installed itself. `createSlotGame` says
 * this out loud where it refuses to build two bridges at once: "both bridges install themselves
 * in-process on the SAME SDK memory channel".
 *
 * So the contract is: put your backend on the channel, and hand back a disposer. The runtime does
 * the handshake exactly once, afterwards, for whichever provider won.
 */
export interface SessionContext {
  /** The launch URL. Injected rather than read from `location` so tests need no DOM. */
  url: string;
  /** The build target this bundle was produced for, e.g. 'stake'. */
  buildTarget?: string;
  /** This contribution's validated settings — point schema plus the provider's own fields. */
  settings: Record<string, unknown>;
  /**
   * How `session-dev` reaches DevBridge. Defaults to a dynamic import of platform-core; a test
   * injects a fake. An injected seam beats module mocking here because the real specifier must
   * stay dynamic — a static one is resolved by every bundler, and a game without platform-core
   * installed would fail to build.
   */
  loadDevBridge?: () => Promise<DevBridgeCtor>;
  /** How `session-stake` reaches StakeBridge. Same optional-peer reasoning as `loadDevBridge`. */
  loadStakeBridge?: () => Promise<StakeBridgeCtor>;
  /**
   * The resolved plan, so a provider can activate a point of its own. `session-stake` needs it to
   * reach `stake.adapter`; `session-dev` ignores it.
   */
  plan?: import('@energy8engine/kernel').ResolvedPlan;
}

/** What a provider hands back after installing itself. */
export interface InstalledSession {
  /** Tear the backend down. Called when the game shuts down, or when installation is rolled back. */
  dispose?: () => void | Promise<void>;
}

/** A session provider: install a backend on the SDK channel, return a disposer. */
export type SessionProvider = (ctx: SessionContext) => InstalledSession | Promise<InstalledSession>;

/**
 * Wrap a provider for the kernel's factory contract.
 *
 * The kernel's `create()` resolves to a FACTORY — `(settings) => instance` — and `activatePoint`
 * calls it with the contribution's validated settings. Our instance IS the provider function, so
 * a bare `create: async () => install` would make the kernel call `install(settings)` and pass a
 * settings object where a SessionContext belongs. This wrapper is the one line that keeps the two
 * contracts straight, and every provider must use it.
 *
 *   create: async () => provider(install)
 *
 * Settings still reach the provider — `runGame` puts them on `ctx.settings`, where a provider can
 * read them alongside the launch url.
 */
export function provider(fn: SessionProvider): () => SessionProvider {
  return () => fn;
}
