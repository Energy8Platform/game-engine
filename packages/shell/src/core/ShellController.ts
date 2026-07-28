import { EventEmitter } from './EventEmitter';
import { createInitialState, nextTurbo, stepBet } from './state';
import { resolveTheme, type ShellTokens } from './theme';
import { formatCurrency } from './format';
import { createI18n, type I18n } from './i18n';
import { KeyboardController, type KeyboardHost } from './keyboard';
import { DEFAULT_MENU, rangeBounds, seedMenuValues, type MenuItem, type MenuRangeItem } from './menu';
import { PACKAGE_VERSION } from './version';
import type {
  ShellConfig,
  ResolvedShellConfig,
  ShellState,
  ShellEvents,
  ShellMode,
  AutoplayOptions,
  FreeSpinsState,
  BonusReadout,
  BonusOption,
  ThemeConfig,
  ModalOptions,
  ReplayModalOptions,
  VolumeKey,
} from './types';
import type {
  ShellRenderer,
  ShellHost,
  ShellActions,
  OverlayHandle,
  OverlayRequest,
  ShellLayoutMode,
} from './renderer';

export interface CreateShellOptions extends ShellConfig {
  renderer: ShellRenderer;
}

/** Apply defaults to the raw config (the mount target lives on the renderer, not here). */
export function resolveConfig(config: ShellConfig): ResolvedShellConfig {
  return {
    language: config.language,
    currency: config.currency,
    availableBets: config.availableBets,
    defaultBet: config.defaultBet,
    currentBet: config.currentBet,
    balance: config.balance,
    win: config.win,
    mode: config.mode,
    gameInfo: config.gameInfo,
    features: config.features,
    theme: config.theme,
    onBonusBuy: config.onBonusBuy,
    volumes: config.volumes,
    menu: config.menu,
    version: config.version ?? '1.0.0',
    isSocial: config.isSocial ?? false,
    replay: config.replay ?? config.mode === 'replay',
  };
}

/** The renderer-agnostic brain. Owns state, events, keyboard, i18n, theme, overlay flow and the
 *  game-facing public API; drives a ShellRenderer for the view. Implements ShellHost so the
 *  renderer + its components read everything they need through one interface. */
export class ShellController extends EventEmitter<ShellEvents> implements ShellHost {
  readonly config: ResolvedShellConfig;
  state: ShellState;
  tokens: ShellTokens;
  layout: ShellLayoutMode = 'wide';
  soundOn = true;
  readonly engineVersion = PACKAGE_VERSION;
  readonly actions: ShellActions;

  private renderer: ShellRenderer;
  private i18n: I18n;
  private kbd?: KeyboardController;
  private overlay: OverlayHandle | null = null;
  private menuItems: MenuItem[];
  private menuRefresh: ((id: string, value: boolean | number) => void) | null = null;
  private overlayKind: OverlayRequest['kind'] | null = null;
  private prevBalance: number;
  private prevWin: number;
  private destroyed = false;

  constructor(opts: CreateShellOptions) {
    super();
    const { renderer, ...config } = opts;
    this.renderer = renderer;
    this.config = resolveConfig(config);
    this.i18n = createI18n({ language: this.config.language, isSocial: this.config.isSocial });
    this.state = createInitialState(this.config);
    this.menuItems = this.config.menu ?? DEFAULT_MENU;
    this.tokens = resolveTheme(this.config.theme);
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
    this.actions = this.buildActions();

    renderer.mount(this);
    if (typeof document !== 'undefined') {
      this.attachKeyboard();
      document.addEventListener('pointerdown', this.pullFocus, true);
    }
    this.renderer.applyTheme(this.tokens);
    this.renderer.renderBar();
  }

  // ── ShellHost ──────────────────────────────────────────────────────────────
  t(text: string): string {
    return this.i18n.t(text);
  }
  formatCurrency(n: number, win = false): string {
    return formatCurrency(n, this.config.currency, win);
  }
  formatWin(value: number): string {
    return this.formatCurrency(value, true);
  }
  notifyResize(w: number, h: number): void {
    const layout: ShellLayoutMode = w !== 0 && h > w ? 'mobile' : 'wide';
    if (layout !== this.layout) {
      this.layout = layout;
      this.renderer.setLayout(layout);
    }
    this.renderer.renderBar();
  }

  private buildActions(): ShellActions {
    const a: ShellActions = {
      spin: () => this.emit('spin'),
      stepBet: (dir) => {
        const next = stepBet(this.state, dir);
        if (next === this.state.bet) return;
        this.state.bet = next;
        this.emit('betChange', next);
        this.renderer.renderBar();
      },
      setBet: (n) => {
        if (n !== this.state.bet) {
          this.state.bet = n;
          this.emit('betChange', n);
          this.renderer.renderBar();
        }
      },
      cycleTurbo: () => {
        const next = nextTurbo(this.state.turbo, this.config.features.turbo);
        this.state.turbo = next;
        this.emit('turboChange', next);
        this.renderer.renderBar();
      },
      toggleAutoplay: () => {
        if (this.state.autoplay.active) a.stopAutoplay();
        else this.openAutoplayPicker();
      },
      startAutoplay: (remaining) => {
        this.state.autoplay = { active: true, remaining };
        this.emit('autoplayStart', { active: true, remaining });
        this.renderer.renderBar();
      },
      stopAutoplay: () => {
        this.state.autoplay = { active: false, remaining: 0 };
        this.emit('autoplayStop');
        this.renderer.renderBar();
      },
      openMenu: () => this.openMenu(),
      openSettings: () => this.openSettings(),
      openInfo: () => this.openInfo(),
      openBuyBonus: () => this.openBuyBonus(),
      openBetPicker: () => this.openBetPicker(),
      openAutoplayPicker: () => this.openAutoplayPicker(),
      selectBuyBonus: (id) => this.emit('buyBonusSelect', { id }),
      activateFeature: (b) => this.activateFeature(b),
      deactivateFeature: () => this.deactivateFeature(),
      setSound: (on) => this.setSound(on),
      closeOverlay: () => this.closeModal(),
    };
    return a;
  }

  private attachKeyboard(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const host: KeyboardHost = {
      get state() {
        return self.state;
      },
      get hotkeysEnabled() {
        return self.config.features.hotkeys !== false;
      },
      get spacebarEnabled() {
        return self.config.features.spacebar !== false;
      },
      get turboLevels() {
        return self.config.features.turbo;
      },
      get autoplayEnabled() {
        return self.config.features.autoplay != null;
      },
      get buyBonusEnabled() {
        return self.config.features.buyBonus !== false;
      },
      hasOpenLayer: () => self.overlay !== null,
      routeToLayer: (e) => self.overlay?.onKey?.(e) ?? false,
      spin: () => self.actions.spin(),
      stepBet: (d) => self.actions.stepBet(d),
      toggleAutoplay: () => self.actions.toggleAutoplay(),
      cycleTurbo: () => self.actions.cycleTurbo(),
      openBuyBonus: () => self.actions.openBuyBonus(),
      openInfo: () => self.actions.openInfo(),
      openMenu: () => self.actions.openMenu(),
      toggleMute: () => self.setSound(!self.soundOn),
      closeLayer: () => self.closeModal(),
    };
    this.kbd = new KeyboardController(host);
    this.kbd.attach();
  }

  private pullFocus = (): void => {
    try {
      (globalThis as { focus?: () => void }).focus?.();
    } catch {
      /* cross-origin */
    }
  };

  // ── overlay flow ─────────────────────────────────────────────────────────────
  private show(req: OverlayRequest): void {
    this.closeModal();
    this.overlay = this.renderer.openOverlay(req) ?? null;
    this.overlayKind = this.overlay ? req.kind : null;
  }
  /** Open the bar menu. Called again while it is open, it closes it — the burger toggles. */
  openMenu(): void {
    if (this.overlayKind === 'menu') {
      this.closeModal();
      return;
    }
    this.emit('menuOpen');
    this.show({ kind: 'menu' });
  }
  /** @deprecated The Settings overlay is gone — this opens the bar menu. */
  openSettings(): void {
    this.emit('settingsOpen');
    this.openMenu();
  }
  openInfo(): void {
    this.emit('infoOpen');
    this.show({ kind: 'gameInfo' });
  }
  openBuyBonus(): void {
    if (this.config.onBonusBuy) {
      this.config.onBonusBuy();
      return;
    }
    this.show({ kind: 'buyBonus' });
  }
  openBetPicker(): void {
    this.show({ kind: 'betPicker' });
  }
  openAutoplayPicker(): void {
    this.show({ kind: 'autoplayPicker' });
  }
  openReplay(opts: ReplayModalOptions): void {
    if (this.destroyed) return;
    this.show({ kind: 'replay', opts });
  }
  openModal(opts: ModalOptions): void {
    this.show({ kind: 'modal', opts });
  }
  /** Programmatically dismiss whatever overlay/modal is open. No-op when nothing is shown. */
  closeModal(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.overlayKind = null;
    this.menuRefresh = null;
    this.renderer.closeOverlay();
  }

  // ── sound ──────────────────────────────────────────────────────────────────
  setSound(on: boolean): void {
    this.soundOn = on;
    this.emit('settingChange', { key: 'sound', value: on });
    this.menuRefresh?.('sound', on);
  }

  // ── volume ─────────────────────────────────────────────────────────────────
  getVolume(key: VolumeKey): number {
    return this.state.volumes[key];
  }
  /** Set a volume slider (0..1). Shared by the slider control (drag) and game code (public API):
   *  clamps, stores so a reopened menu popover reflects it, emits `settingChange`, and
   *  live-updates the slider if the menu is currently open. */
  setVolume(key: VolumeKey, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.state.volumes[key] = v;
    this.emit('settingChange', { key, value: v });
    this.menuRefresh?.(key, v);
  }

  // ── menu ───────────────────────────────────────────────────────────────────
  get menu(): MenuItem[] {
    return this.menuItems;
  }
  /** Replace the item list. Values of ids already in state are kept; new ids are seeded. */
  setMenu(items: MenuItem[]): void {
    this.menuItems = items;
    this.state.menu = seedMenuValues(items, this.state.menu);
    if (this.overlayKind === 'menu') this.show({ kind: 'menu' });
  }
  getMenuValue(id: string): boolean | number | undefined {
    if (id === 'sound') return this.soundOn;
    if (id === 'music' || id === 'sfx') return this.state.volumes[id];
    return this.state.menu[id];
  }
  /** Set a menu value. Presets route to their own homes so there is never a second copy. */
  setMenuValue(id: string, value: boolean | number): void {
    if (id === 'sound') {
      this.setSound(value !== false);
      return;
    }
    if (id === 'music' || id === 'sfx') {
      this.setVolume(id, Number(value));
      return;
    }
    const next = typeof value === 'number' ? this.clampRange(id, value) : value;
    this.state.menu[id] = next;
    this.emit('settingChange', { key: id, value: next });
    this.menuRefresh?.(id, next);
  }
  setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void {
    this.menuRefresh = fn;
  }
  /** Clamp to the declared bounds of a custom `range` item (a non-range id passes through). */
  private clampRange(id: string, value: number): number {
    const item = this.menuItems.find((i) => (i as { id?: string }).id === id) as
      | MenuRangeItem
      | undefined;
    if (!item || (item as { type?: string }).type !== 'range') return value;
    const { min, max } = rangeBounds(item);
    return Math.max(min, Math.min(max, value));
  }

  // ── features ─────────────────────────────────────────────────────────────────
  activateFeature(bonus: BonusOption): void {
    this.state.activeFeature = bonus;
    this.emit('featureActivate', { id: bonus.id });
    this.renderer.renderBar();
  }
  deactivateFeature(): void {
    const prev = this.state.activeFeature;
    if (!prev) return;
    this.state.activeFeature = null;
    this.emit('featureDeactivate', { id: prev.id });
    this.renderer.renderBar();
  }

  // ── game-facing public API (mirrors GameShell/PixiGameShell) ───────────────────
  private money(field: 'balance' | 'win', from: number, to: number, durationMs?: number): void {
    this.renderer.renderBar();
    if (to !== from) this.renderer.animateMoney(field, from, to, durationMs);
  }
  setBalance(n: number): void {
    const from = this.prevBalance;
    this.state.balance = n;
    this.prevBalance = n;
    this.money('balance', from, n);
  }
  /** Set the WIN readout. Counts up/down from the previous value by default. Pass
   *  `{ animate: false }` to SNAP instantly (renderBar cancels any in-flight count-up) — used by the
   *  host to clear WIN to 0 at spin start, where an animated count-DOWN would look wrong.
   *  `{ durationMs }` shortens/lengthens the count-up (default 450ms) — a scene reporting a win per
   *  cascade step passes its step length so each count-up finishes before the next step lands. */
  setWin(n: number, opts?: { animate?: boolean; durationMs?: number }): void {
    const from = this.prevWin;
    this.state.win = n;
    this.prevWin = n;
    if (opts?.animate === false) {
      this.renderer.renderBar(); // instant repaint from state; cancels running money anims
      return;
    }
    this.money('win', from, n, opts?.durationMs);
  }
  setBet(n: number): void {
    this.state.bet = n;
    this.renderer.renderBar();
  }
  setMode(mode: ShellMode): void {
    if (mode === 'replay') this.state.replay = true;
    this.state.mode = mode;
    this.renderer.renderBar();
  }
  setBusy(busy: boolean): void {
    this.state.busy = busy;
    this.renderer.renderBar();
    this.kbd?.notifyBusyChanged(busy);
  }
  setAutoplay(a: AutoplayOptions): void {
    this.state.autoplay = a;
    this.renderer.renderBar();
  }
  setTurbo(level: number): void {
    this.state.turbo = level;
    this.renderer.renderBar();
  }
  setBuyBonusEnabled(enabled: boolean): void {
    this.state.buyBonusEnabled = enabled;
    this.renderer.renderBar();
  }
  setFreeSpins(fs: FreeSpinsState): void {
    this.state.freeSpins = fs;
    this.state.bonus = null;
    this.renderer.renderBar();
  }
  /** Generic bonus readout (adventure / hold-and-spin / respins). Sets a game-supplied label+value
   *  override for the bar hero and folds `totalWin` into the shared accumulator. Pairs with
   *  `setMode('bonus')`. `setFreeSpins()` clears the override back to the derived current/total. */
  setBonus(b: BonusReadout): void {
    this.state.bonus = { label: b.label, value: b.value };
    this.state.freeSpins = { ...this.state.freeSpins, totalWin: b.totalWin };
    this.renderer.renderBar();
  }
  setTheme(theme: ThemeConfig): void {
    this.config.theme = theme;
    this.tokens = resolveTheme(theme);
    this.renderer.applyTheme(this.tokens);
    this.renderer.renderBar();
  }
  setLanguage(lang: string): void {
    this.config.language = lang;
    this.i18n = createI18n({ language: lang, isSocial: this.config.isSocial });
    this.renderer.renderBar();
  }
  setSocial(isSocial: boolean): void {
    this.config.isSocial = isSocial;
    this.i18n = createI18n({ language: this.config.language, isSocial });
    this.renderer.renderBar();
  }
  setLayout(layout: ShellLayoutMode): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.renderer.setLayout(layout);
    this.renderer.renderBar();
  }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    // With the menu (or any overlay) open at teardown, `menuRefresh` / `overlay` / `overlayKind`
    // would otherwise survive the renderer's destroy — so a later setVolume()/setSound() call
    // invokes a stale row updater against already-destroyed Pixi Graphics (or a detached DOM node)
    // and throws. Run BEFORE the renderer teardown below, while it can still close cleanly.
    this.closeModal();
    if (typeof document !== 'undefined') {
      this.kbd?.detach();
      document.removeEventListener('pointerdown', this.pullFocus, true);
    }
    this.removeAllListeners();
    return Promise.resolve(this.renderer.destroy());
  }
}
