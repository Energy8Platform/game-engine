import type { EventEmitter } from './EventEmitter';
import type { ShellTokens } from './theme';
import type {
  ResolvedShellConfig, ShellState, ShellEvents, BonusOption,
  ModalOptions, ReplayModalOptions, VolumeKey,
} from './types';
import type { MenuItem } from './menu';

export type ShellLayoutMode = 'wide' | 'mobile';

/** The view side the controller drives. A renderer holds its own mount target (DOM element /
 *  Pixi app) and translates state → pixels; it never owns logic. */
export interface ShellRenderer {
  /** Bind to the brain. Called once during createShell, before the first renderBar. */
  mount(host: ShellHost): void;
  /** (Re)build the bottom bar from host.state. MUST cancel any in-flight money count-up first. */
  renderBar(): void;
  /** Switch bar layout. The controller derives wide|mobile from host.notifyResize. */
  setLayout(layout: ShellLayoutMode): void;
  /** Apply colour tokens (CSS vars in DOM / repaint in Pixi). */
  applyTheme(tokens: ShellTokens): void;
  /** Count a money readout from→to on the freshly-rendered bar (DOM rAF / Pixi ticker).
   *  `durationMs` overrides the renderer's default count-up length — a cascade/tumble scene
   *  reporting a win per step needs each count-up to fit inside its step. */
  animateMoney(field: 'balance' | 'win', from: number, to: number, durationMs?: number): void;
  /** Build + show an overlay from a controller-supplied model; return a handle for key routing
   *  and programmatic close. Returns void when nothing was shown. */
  openOverlay(req: OverlayRequest): OverlayHandle | void;
  /** Tear down any open overlay. */
  closeOverlay(): void;
  /** Fade out + remove all nodes; resolve when gone. */
  destroy(): Promise<void> | void;

  // ── optional surface facade ──────────────────────────────────────────────
  // A renderer that draws a bottom bar exposes these so an embedding host can reserve space for it
  // and toggle the whole shell. createShell() forwards them onto the returned shell (with inert
  // defaults when a renderer omits them), so every renderer — built-in or custom — is host-drivable.
  /** Insets a scene should avoid (only the bottom bar is reserved; the rest is full-bleed). */
  readonly safeArea?: SafeArea;
  /** Height of the bottom control bar in px (0 before first layout / when there's no bar). */
  readonly barHeight?: number;
  /** Show/hide the whole shell (bar + overlays). */
  setVisible?(visible: boolean): void;
}

/** Bottom-bar inset a host reserves for scene content. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The surface facade createShell() guarantees on the returned shell, delegating to the renderer
 *  (inert defaults when the renderer omits a member). Hosts embedding a shell read these. */
export interface ShellSurface {
  readonly safeArea: SafeArea;
  readonly barHeight: number;
  setVisible(visible: boolean): void;
}

/** What the renderer (and its components) read from the brain. */
export interface ShellHost {
  readonly state: ShellState;
  readonly config: ResolvedShellConfig;
  readonly tokens: ShellTokens;
  readonly layout: ShellLayoutMode;
  readonly soundOn: boolean;
  /** Resolve a built-in string (translation + optional socialize). */
  t(text: string): string;
  /** Currency-aware money formatting (win=true ⇒ variable decimals). */
  formatCurrency(n: number, win?: boolean): string;
  /** Typed event emit — same signature as the shells. */
  emit: EventEmitter<ShellEvents>['emit'];
  /** Renderer reports its surface size; the controller recomputes layout + re-renders. */
  notifyResize(w: number, h: number): void;
  /** Flip shared sound state (emits settingChange + refreshes an open Settings icon). */
  setSound(on: boolean): void;
  /** Current volume slider position (0..1) for music/sfx. */
  getVolume(key: VolumeKey): number;
  /** Set a volume slider (0..1): clamps, stores, emits `settingChange`, and live-updates an open
   *  Settings overlay. Called by the slider control on drag AND by game code as the public API. */
  setVolume(key: VolumeKey, value: number): void;
  /** The configured menu items (see core/menu.ts). */
  readonly menu: MenuItem[];
  /** Current value of a menu item — presets included (sound → soundOn, music/sfx → volumes). */
  getMenuValue(id: string): boolean | number | undefined;
  /** Set a menu value: clamps ranges, stores, emits `settingChange`, refreshes an open menu. */
  setMenuValue(id: string, value: boolean | number): void;
  /** An open menu registers a row updater here (null clears it on close). */
  setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void;
  /** Logic-bearing actions invoked by renderer controls. */
  readonly actions: ShellActions;
  /** Re-show the replay summary modal through the controller (keeps its OverlayHandle in sync).
   *  Used as the modal's own reopen callback after START REPLAY, so a renderer never re-pushes a
   *  replay modal behind the controller's back (which would strand `overlay` and dead-end the
   *  next close). */
  openReplay(opts: ReplayModalOptions): void;
}

/** Every state-changing thing a control can do. Each runs logic in the controller, emits the
 *  matching event, and triggers a re-render. Renderers MUST route input through these. */
export interface ShellActions {
  spin(): void;
  stepBet(dir: 1 | -1): void;
  setBet(n: number): void;
  cycleTurbo(): void;
  toggleAutoplay(): void;
  startAutoplay(remaining: number): void;
  stopAutoplay(): void;
  openMenu(): void;
  openSettings(): void;
  openInfo(): void;
  openBuyBonus(): void;
  openBetPicker(): void;
  openAutoplayPicker(): void;
  selectBuyBonus(id: string): void;
  activateFeature(b: BonusOption): void;
  deactivateFeature(): void;
  setSound(on: boolean): void;
  closeOverlay(): void;
}

export interface OverlayHandle {
  /** Overlay-specific keys (e.g. arrows in a picker). Return true to consume. */
  onKey?(e: KeyboardEvent): boolean;
  /** Programmatically close this overlay. */
  close(): void;
}

export type OverlayRequest =
  | { kind: 'menu' }
  | { kind: 'gameInfo' }
  | { kind: 'buyBonus' }
  | { kind: 'betPicker' }
  | { kind: 'autoplayPicker' }
  | { kind: 'replay'; opts: ReplayModalOptions }
  | { kind: 'modal'; opts: ModalOptions };
