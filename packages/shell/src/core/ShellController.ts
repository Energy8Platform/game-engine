import { EventEmitter } from './EventEmitter';
import { createInitialState, nextTurbo, stepBet } from './state';
import { resolveTheme, type ShellTokens } from './theme';
import { formatCurrency } from './format';
import { createI18n, type I18n } from './i18n';
import { KeyboardController, type KeyboardHost } from './keyboard';
import { PACKAGE_VERSION } from './version';
import type {
  ShellConfig, ResolvedShellConfig, ShellState, ShellEvents, ShellMode,
  AutoplayOptions, FreeSpinsState, BonusOption, ThemeConfig, ModalOptions, ReplayModalOptions,
} from './types';
import type {
  ShellRenderer, ShellHost, ShellActions, OverlayHandle, OverlayRequest, ShellLayoutMode,
} from './renderer';

export interface CreateShellOptions extends ShellConfig { renderer: ShellRenderer; }

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
  private soundRefresh: ((on: boolean) => void) | null = null;
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
  t(text: string): string { return this.i18n.t(text); }
  formatCurrency(n: number, win = false): string { return formatCurrency(n, this.config.currency, win); }
  formatWin(value: number): string { return this.formatCurrency(value, true); }
  notifyResize(w: number, h: number): void {
    const layout: ShellLayoutMode = w !== 0 && h > w ? 'mobile' : 'wide';
    if (layout !== this.layout) { this.layout = layout; this.renderer.setLayout(layout); }
    this.renderer.renderBar();
  }

  private buildActions(): ShellActions {
    const a: ShellActions = {
      spin: () => this.emit('spin'),
      stepBet: (dir) => {
        const next = stepBet(this.state, dir);
        if (next === this.state.bet) return;
        this.state.bet = next; this.emit('betChange', next); this.renderer.renderBar();
      },
      setBet: (n) => this.setBet(n),
      cycleTurbo: () => {
        const next = nextTurbo(this.state.turbo, this.config.features.turbo);
        this.state.turbo = next; this.emit('turboChange', next); this.renderer.renderBar();
      },
      toggleAutoplay: () => {
        if (this.state.autoplay.active) a.stopAutoplay();
        else this.openAutoplayPicker();
      },
      startAutoplay: (remaining) => {
        this.state.autoplay = { active: true, remaining };
        this.emit('autoplayStart', { active: true, remaining }); this.renderer.renderBar();
      },
      stopAutoplay: () => {
        this.state.autoplay = { active: false, remaining: 0 };
        this.emit('autoplayStop'); this.renderer.renderBar();
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
      get state() { return self.state; },
      get hotkeysEnabled() { return self.config.features.hotkeys !== false; },
      get spacebarEnabled() { return self.config.features.spacebar !== false; },
      get turboLevels() { return self.config.features.turbo; },
      get autoplayEnabled() { return self.config.features.autoplay != null; },
      get buyBonusEnabled() { return self.config.features.buyBonus !== false; },
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

  private pullFocus = (): void => { try { (globalThis as { focus?: () => void }).focus?.(); } catch { /* cross-origin */ } };

  // ── overlay flow ─────────────────────────────────────────────────────────────
  private show(req: OverlayRequest): void {
    this.closeModal();
    this.overlay = this.renderer.openOverlay(req) ?? null;
  }
  openMenu(): void { this.emit('menuOpen'); this.openSettings(); }
  openSettings(): void { this.emit('settingsOpen'); this.show({ kind: 'settings' }); }
  openInfo(): void { this.emit('infoOpen'); this.show({ kind: 'gameInfo' }); }
  openBuyBonus(): void { if (this.config.onBonusBuy) { this.config.onBonusBuy(); return; } this.show({ kind: 'buyBonus' }); }
  openBetPicker(): void { this.show({ kind: 'betPicker' }); }
  openAutoplayPicker(): void { this.show({ kind: 'autoplayPicker' }); }
  openReplay(opts: ReplayModalOptions): void { if (this.destroyed) return; this.show({ kind: 'replay', opts }); }
  openModal(opts: ModalOptions): void { this.show({ kind: 'modal', opts }); }
  /** Programmatically dismiss whatever overlay/modal is open. No-op when nothing is shown. */
  closeModal(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.soundRefresh = null;
    this.renderer.closeOverlay();
  }

  // ── sound ──────────────────────────────────────────────────────────────────
  setSound(on: boolean): void {
    this.soundOn = on;
    this.emit('settingChange', { key: 'sound', value: on });
    this.soundRefresh?.(on);
    this.renderer.refreshSoundIcon?.(on);
  }
  setSoundRefresh(fn: ((on: boolean) => void) | null): void { this.soundRefresh = fn; }

  // ── features ─────────────────────────────────────────────────────────────────
  activateFeature(bonus: BonusOption): void {
    this.state.activeFeature = bonus; this.emit('featureActivate', { id: bonus.id }); this.renderer.renderBar();
  }
  deactivateFeature(): void {
    const prev = this.state.activeFeature;
    if (!prev) return;
    this.state.activeFeature = null; this.emit('featureDeactivate', { id: prev.id }); this.renderer.renderBar();
  }

  // ── game-facing public API (mirrors GameShell/PixiGameShell) ───────────────────
  private money(field: 'balance' | 'win', from: number, to: number): void {
    this.renderer.renderBar();
    if (to !== from) this.renderer.animateMoney(field, from, to);
  }
  setBalance(n: number): void { const from = this.prevBalance; this.state.balance = n; this.prevBalance = n; this.money('balance', from, n); }
  setWin(n: number): void { const from = this.prevWin; this.state.win = n; this.prevWin = n; this.money('win', from, n); }
  setBet(n: number): void { this.state.bet = n; this.renderer.renderBar(); }
  setMode(mode: ShellMode): void { if (mode === 'replay') this.state.replay = true; this.state.mode = mode; this.renderer.renderBar(); }
  setBusy(busy: boolean): void { this.state.busy = busy; this.renderer.renderBar(); this.kbd?.notifyBusyChanged(busy); }
  setAutoplay(a: AutoplayOptions): void { this.state.autoplay = a; this.renderer.renderBar(); }
  setTurbo(level: number): void { this.state.turbo = level; this.renderer.renderBar(); }
  setBuyBonusEnabled(enabled: boolean): void { this.state.buyBonusEnabled = enabled; this.renderer.renderBar(); }
  setFreeSpins(fs: FreeSpinsState): void { this.state.freeSpins = fs; this.renderer.renderBar(); }
  setTheme(theme: ThemeConfig): void { this.config.theme = theme; this.tokens = resolveTheme(theme); this.renderer.applyTheme(this.tokens); this.renderer.renderBar(); }
  setLanguage(lang: string): void { this.config.language = lang; this.i18n = createI18n({ language: lang, isSocial: this.config.isSocial }); this.renderer.renderBar(); }
  setSocial(isSocial: boolean): void { this.config.isSocial = isSocial; this.i18n = createI18n({ language: this.config.language, isSocial }); this.renderer.renderBar(); }
  setLayout(layout: ShellLayoutMode): void { if (layout === this.layout) return; this.layout = layout; this.renderer.setLayout(layout); this.renderer.renderBar(); }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    if (typeof document !== 'undefined') {
      this.kbd?.detach();
      document.removeEventListener('pointerdown', this.pullFocus, true);
    }
    this.removeAllListeners();
    return Promise.resolve(this.renderer.destroy());
  }
}
