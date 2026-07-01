/**
 * `@energy8platform/harness` — the renderer- and platform-agnostic dev harness.
 *
 * The harness core owns everything that is NOT specific to a particular play
 * backend or renderer: framing the game in an iframe, the screen presets, the
 * Settings / Replay UI, launch-URL assembly, the panel host and the
 * wrapper↔iframe postMessage bus.
 *
 * Everything backend-specific (the RGS protocol, curated books, balance/currency
 * bookkeeping) is contributed by a **backend plugin** (`HarnessBackend`).
 * Everything that is an extra tool panel (e.g. the reel-config sidebar) is
 * contributed by a **panel plugin** (`HarnessPanel`).
 *
 * This module is pure types + tiny helpers — no node, no DOM, no deps.
 */

// ---------------------------------------------------------------------------
// Loose vite typings — we only touch what the plugin uses.
// ---------------------------------------------------------------------------

export interface HarnessServer {
  middlewares: {
    use(handler: (req: IncomingLike, res: OutgoingLike, next: () => void) => void): void;
    use(
      route: string,
      handler: (req: IncomingLike, res: OutgoingLike, next: () => void) => void,
    ): void;
  };
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
}

/** Minimal node http request surface the harness reads. */
export interface IncomingLike {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, cb: (chunk: unknown) => void): void;
}

/** Minimal node http response surface the harness writes. */
export interface OutgoingLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/** Context handed to every plugin's `configureServer`. */
export interface HarnessServerContext {
  /** The vite dev server. */
  server: HarnessServer;
  /** Read a request body to a utf8 string. */
  readBody(req: IncomingLike): Promise<string>;
  /** Write a JSON response. */
  sendJson(res: OutgoingLike, status: number, json: unknown): void;
}

// ---------------------------------------------------------------------------
// Backend contract — the pluggable play backend (Stake RGS, or any other).
// ---------------------------------------------------------------------------

/** A single game mode surfaced to the Replay panel. */
export interface HarnessMode {
  name: string;
  /** Bet-cost multiplier (buy/ante cost a multiple of the base bet). */
  cost: number;
  /** Number of replayable events → valid ids are `0 … count-1` (0 = unknown). */
  count: number;
}

/**
 * Resolved data the core UI needs from the backend to render the bar and build
 * launch URLs. Everything here is plain JSON — it crosses the node→browser seam.
 */
export interface HarnessBackendInfo {
  /** Available currencies (ISO 4217). */
  currencies: string[];
  /** Bet levels in MAJOR units. */
  betLevelsMajor: number[];
  /** Modes for the Replay panel. `[]` hides the Replay tab. */
  modes: HarnessMode[];
  /** Launch params merged into the iframe URL by the core launcher. */
  launch: {
    /** Always included on a normal launch, e.g. `{ rgs_url, sessionID }`. */
    base: Record<string, string>;
    /** Included on a replay launch, e.g. `{ replay:'true', game, version, rgs_url }`. Presence enables Replay. */
    replayBase?: Record<string, string>;
  };
  /** Relative URLs the core Settings UI hits. `null` hides Balance/Currency. */
  controls: { setBalanceUrl: string; setCurrencyUrl: string } | null;
}

/**
 * A pluggable play backend. Mounts its own dev-server middleware (its play
 * endpoints + Balance/Currency setters) and describes itself so the core UI can
 * drive it without knowing anything about the wire protocol.
 */
export interface HarnessDescribeContext {
  /** Request host (e.g. 'localhost:5173') — used to build absolute launch URLs. */
  host: string;
}

export interface HarnessBackend {
  /** Stable id, e.g. 'stake-rgs'. */
  id: string;
  /** Mount server middleware (play endpoints, dev-control endpoints). */
  configureServer(ctx: HarnessServerContext): void | Promise<void>;
  /** Resolve the wrapper's dynamic data (lazily, on each page render). */
  describe(ctx: HarnessDescribeContext): Promise<HarnessBackendInfo>;
}

// ---------------------------------------------------------------------------
// Panel contract — an extra tool panel (reel config, etc.).
// ---------------------------------------------------------------------------

export type PanelPlacement = 'tab' | 'sidebar';

/**
 * A pluggable tool panel. Its client is a **self-contained browser ESM file**
 * (built by the panel's package) that the harness serves at a stable URL and
 * loads into the wrapper. The client talks to the game iframe over the core bus.
 */
export interface HarnessPanel {
  /** Stable id, e.g. 'reels'. */
  id: string;
  /** Tab / sidebar-header label. */
  title: string;
  /** 'tab' → popover over the game; 'sidebar' → docked right drawer. */
  placement: PanelPlacement;
  /**
   * Absolute filesystem path to the panel's self-contained browser ESM entry.
   * Must default-export `(ctx: HarnessPanelContext) => void`.
   */
  clientEntry: string;
  /**
   * JSON-serializable config forwarded to the panel client as `ctx.config`.
   * Lets a node-side panel plugin parameterize its browser UI (e.g. which
   * sections to show) without rebuilding the client bundle.
   */
  config?: unknown;
  /** Optional server middleware (most panels need none). */
  configureServer?(ctx: HarnessServerContext): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin (either flavour) + createHarness options.
// ---------------------------------------------------------------------------

/** A harness plugin contributes a backend, a panel, or both. */
export interface HarnessPlugin {
  backend?: HarnessBackend;
  panel?: HarnessPanel;
}

export interface CreateHarnessOptions {
  /** Backend + panel plugins. */
  plugins?: HarnessPlugin[];
  /** Brand chip text. Default: the backend's game id, else 'Harness'. */
  title?: string;
  /** Version chip. Default '1'. */
  version?: string;
  /** Starting dev balance in MAJOR units surfaced as the default. Default 10_000. */
  startingBalance?: number;
}

// ---------------------------------------------------------------------------
// Wrapper data — the JSON blob the plugin injects and the core client reads.
// ---------------------------------------------------------------------------

import type { ScreenPreset } from './screens';
import type { LangEntry } from './langs';

export interface WrapperPanelInfo {
  id: string;
  title: string;
  placement: PanelPlacement;
  /** URL the harness serves the panel's ESM at, e.g. '/__harness/panel/reels.js'. */
  clientUrl: string;
  /** JSON config forwarded to the panel client as `ctx.config`. */
  config?: unknown;
}

export interface WrapperData {
  title: string;
  version: string;
  screens: ScreenPreset[];
  langs: LangEntry[];
  balances: { value: number; label: string }[];
  defaultBalance: number;
  defaultCurrency: string;
  defaultLang: string;
  /** Resolved backend info + its id, or null when no backend plugin is present. */
  backend: (HarnessBackendInfo & { id: string }) | null;
  panels: WrapperPanelInfo[];
}
