import { BlurFilter, ColorMatrixFilter, Container, Graphics, RenderTexture, Sprite, type Application, type Ticker } from 'pixi.js';
import { EventEmitter } from './EventEmitter';
import type { ShellHost, ShellLayer, LayerHandle } from './context';
import type {
  PixiShellConfig,
  ShellState,
  ShellEvents,
  ShellMode,
  AutoplayOptions,
  FreeSpinsState,
  BonusOption,
  ThemeConfig,
  ModalOptions,
  ReplayModalOptions,
} from './types';
import { createInitialState } from './state';
import { resolveTheme, type ShellTokens } from './theme';
import { formatCurrency } from './format';
import { createI18n, type I18n } from './i18n';
import { KeyboardController, type KeyboardHost } from './keyboard';
import { installShellFont, whenFontReady } from './text';
import { countUpText, tween } from './motion';
import { BottomBar } from './components/BottomBar';
import { openSettings } from './components/Settings';
import { openGameInfo } from './components/GameInfo';
import { openBuyBonus } from './components/BuyBonus';
import { openBetPicker, openAutoplayPicker } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';

/** The Pixi rendering of the Energy8 game shell — the 1:1 analogue of platform-core's GameShell.
 *  Attaches to a Pixi Application and draws the bottom control bar + full-screen overlays/modals. */
export class PixiGameShell extends EventEmitter<ShellEvents> implements ShellHost {
  readonly config: PixiShellConfig;
  state: ShellState;
  tokens: ShellTokens;
  readonly ticker: Ticker;
  readonly canvas?: HTMLCanvasElement;
  layout: 'wide' | 'mobile' = 'wide';

  private app: Application;
  private root = new Container();
  private barLayer = new Container();
  private modalLayer = new Container();
  private bar?: BottomBar;
  private currentLayer: ShellLayer | null = null;
  private destroyed = false;
  private prevBalance: number;
  private prevWin: number;
  private moneyAnims: Array<() => void> = [];
  private kbd!: KeyboardController;
  private i18n!: I18n;

  constructor(config: PixiShellConfig) {
    super();
    installShellFont();
    this.config = config;
    this.i18n = createI18n({ language: config.language, isSocial: config.isSocial });
    this.app = config.app;
    this.ticker = config.app.ticker;
    this.canvas = config.app.canvas as HTMLCanvasElement | undefined;
    this.state = createInitialState(config);
    this.tokens = resolveTheme(config.theme);
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;

    this.root.eventMode = 'static';
    this.root.addChild(this.barLayer, this.modalLayer);
    (config.parent ?? this.app.stage).addChild(this.root);
    // make sure the stage delivers global pointer moves (drag, sliders)
    this.app.stage.eventMode = 'static';

    this.syncLayout();
    this.app.renderer.on('resize', this.onResize);

    if (typeof document !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const shell = this;
      const host: KeyboardHost = {
        get state() { return shell.state; },
        get hotkeysEnabled() { return shell.config.features.hotkeys !== false; },
        get spacebarEnabled() { return shell.config.features.spacebar !== false; },
        get turboLevels() { return shell.config.features.turbo; },
        get autoplayEnabled() { return shell.config.features.autoplay != null; },
        get buyBonusEnabled() { return shell.config.features.buyBonus !== false; },
        hasOpenLayer: () => shell.currentLayer !== null,
        routeToLayer: () => false,
        spin: () => shell.emit('spin'),
        stepBet: () => {},
        toggleAutoplay: () => {},
        cycleTurbo: () => {},
        openBuyBonus: () => {},
        openInfo: () => {},
        openMenu: () => {},
        toggleMute: () => {},
        closeLayer: () => shell.closeLayer(),
      };
      this.kbd = new KeyboardController(host);
      this.kbd.attach();
      // Stake serves the game in an iframe; on first paint focus is on the HOST page, so a
      // `document` keydown never fires and Space scrolls the parent. Pull focus into the frame on
      // the first pointer interaction so the spacebar shortcut works. Harmless full-page.
      document.addEventListener('pointerdown', this.pullFocus, true);
    }

    this.render();
    whenFontReady(() => {
      if (!this.destroyed) this.render();
    });
  }

  // ── ShellHost ───────────────────────────────────────────────────────────────
  get screenW(): number {
    return this.app.screen.width;
  }
  get screenH(): number {
    return this.app.screen.height;
  }

  /** Height of the bottom control bar in px (0 before first layout, or in replay-only chrome). */
  get barHeight(): number {
    return this.bar?.height ?? 0;
  }

  /** Insets a scene should avoid. Only the bottom bar is reserved; the rest is full-bleed. */
  get safeArea(): { top: number; right: number; bottom: number; left: number } {
    return { top: 0, right: 0, bottom: this.barHeight, left: 0 };
  }

  t(text: string): string {
    return this.i18n.t(text);
  }
  fmt(n: number): string {
    return formatCurrency(n, this.config.currency);
  }
  fmtWin(n: number): string {
    return formatCurrency(n, this.config.currency, true);
  }

  render(): void {
    if (this.destroyed) return;
    this.cancelMoneyAnims();
    if (this.bar) {
      this.barLayer.removeChild(this.bar);
      this.bar.destroy({ children: true });
    }
    this.bar = new BottomBar(this);
    this.barLayer.addChild(this.bar);
    this.bar.applyFit();
    this.animateMoney();
  }

  private animateMoney(): void {
    if (!this.bar) return;
    if (this.bar.balanceValue && this.state.balance !== this.prevBalance) {
      this.moneyAnims.push(
        countUpText(this.ticker, this.bar.balanceValue, this.prevBalance, this.state.balance, (n) => this.fmt(n)),
      );
    }
    if (this.bar.winValue && this.state.win !== this.prevWin) {
      this.moneyAnims.push(
        countUpText(this.ticker, this.bar.winValue, this.prevWin, this.state.win, (n) => this.fmtWin(n)),
      );
    }
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
  }

  private cancelMoneyAnims(): void {
    for (const c of this.moneyAnims) c();
    this.moneyAnims = [];
  }

  pushLayer(node: ShellLayer): LayerHandle {
    this.clearLayer();
    this.makeBackdrop(); // frosted snapshot of the scene behind (the DOM's backdrop-filter:blur)
    this.currentLayer = node;
    this.modalLayer.addChild(node);
    this.fitModals();
    return {
      root: node,
      close: () => {
        if (this.currentLayer === node) this.closeLayer();
      },
    };
  }

  closeLayer(): void {
    this.clearLayer();
  }

  private clearLayer(): void {
    if (this.currentLayer) {
      this.currentLayer.onRemove?.();
      this.modalLayer.removeChild(this.currentLayer);
      this.currentLayer.destroy({ children: true });
      this.currentLayer = null;
    }
    this.removeBackdrop();
  }

  private backdrop?: { node: Container; texture: RenderTexture };

  /** Snapshot the scene behind the modal layer and blur it — the Pixi analogue of the overlay's
   *  `backdrop-filter: blur(20px) saturate(120%)`. Static (captured at open time): the game is paused
   *  under a modal, so a live re-blur each frame isn't worth the cost. */
  private makeBackdrop(): void {
    this.removeBackdrop();
    const renderer = this.app.renderer;
    const w = this.screenW;
    const h = this.screenH;
    if (w <= 0 || h <= 0) return;
    const node = new Container();
    // A SOLID base the size of the screen, under the blurred snapshot: the low-res blurred sprite can
    // fall a hair short at the right/bottom edges, and without this the SHARP scene would show through
    // the semi-transparent veil there. The base is the veil's own colour so the (rare) uncovered strip
    // reads as more frost, never sharp game.
    node.addChild(new Graphics().rect(0, 0, w, h).fill(0x0c111c));
    this.modalLayer.addChild(node);
    this.backdrop = { node, texture: RenderTexture.create({ width: w, height: h, resolution: 0.25 }) };
    try {
      // Heavy downscale (¼ res) is the blur-STRENGTH lever (each texel covers more screen), far cheaper
      // than a full-res large-radius blur and smooth over fine detail. Effective on-screen blur ≈
      // strength / resolution = 14 / 0.25 ≈ 56px → the background dissolves into a frost. A huge
      // `strength` instead under-samples into a thin/streaky blur, so we keep the kernel moderate.
      const texture = this.backdrop.texture;
      this.modalLayer.visible = false; // never capture the (empty) modal layer / a stale backdrop
      renderer.render({ container: this.app.stage, target: texture, clear: true });
      this.modalLayer.visible = true;
      const sprite = new Sprite(texture);
      // Overscan ~6% so the blurred snapshot's faded edges sit just off-screen.
      sprite.anchor.set(0.5);
      sprite.position.set(w / 2, h / 2);
      sprite.width = w * 1.06;
      sprite.height = h * 1.06;
      const blur = new BlurFilter({ strength: 14, quality: 6 });
      blur.repeatEdgePixels = true; // no transparent edge halo
      const saturate = new ColorMatrixFilter();
      saturate.saturate(0.3, false); // x = amount*2/3 + 1 ≈ 1.2 → saturate(120%) (matches the DOM)
      sprite.filters = [blur, saturate];
      node.addChild(sprite); // over the solid base, below the modal layer node
    } catch {
      this.modalLayer.visible = true; // headless / no GL → skip the blur, the solid base + veil show
    }
  }

  private removeBackdrop(): void {
    if (this.backdrop) {
      this.modalLayer.removeChild(this.backdrop.node);
      this.backdrop.node.destroy({ children: true });
      this.backdrop.texture.destroy(true);
      this.backdrop = undefined;
    }
  }

  fitModals(): void {
    this.currentLayer?.fit?.();
  }

  openMenu(): void {
    this.emit('menuOpen');
    this.openSettings();
  }
  openSettings(): void {
    this.emit('settingsOpen');
    this.pushLayer(openSettings(this));
  }
  openInfo(): void {
    this.emit('infoOpen');
    this.pushLayer(openGameInfo(this));
  }
  openBuyBonus(): void {
    if (this.config.onBonusBuy) {
      this.config.onBonusBuy();
      return;
    }
    const overlay = openBuyBonus(this);
    if (overlay) this.pushLayer(overlay);
  }
  openBetPicker(): void {
    this.pushLayer(openBetPicker(this));
  }
  openAutoplayPicker(): void {
    this.pushLayer(openAutoplayPicker(this));
  }
  openModal(opts: ModalOptions): void {
    this.pushLayer(buildModal(this, opts));
  }
  /** Programmatically dismiss whatever overlay/modal is open (e.g. auto-close a reconnect
   *  overlay once the link is restored). No-op when nothing is open. */
  closeModal(): void {
    this.closeLayer();
  }
  /** Currency-aware money formatter for WIN amounts (variable decimals) — handed to scenes so
   *  games format money without knowing the currency. */
  formatWin(value: number): string {
    return this.fmtWin(value);
  }
  openReplay(opts: ReplayModalOptions): void {
    if (this.destroyed) return;
    this.pushLayer(buildReplayModal(this, opts));
  }

  activateFeature(bonus: BonusOption): void {
    this.state.activeFeature = bonus;
    this.emit('featureActivate', { id: bonus.id });
    this.render();
  }
  deactivateFeature(): void {
    const prev = this.state.activeFeature;
    if (!prev) return;
    this.state.activeFeature = null;
    this.emit('featureDeactivate', { id: prev.id });
    this.render();
  }

  // ── public API (mirrors GameShell) ───────────────────────────────────────────
  setBalance(n: number): void {
    this.state.balance = n;
    this.render();
  }
  setWin(n: number): void {
    this.state.win = n;
    this.render();
  }
  setBet(n: number): void {
    this.state.bet = n;
    this.render();
  }
  setMode(mode: ShellMode): void {
    if (mode === 'replay') this.state.replay = true; // sticky: a replay stays a replay across modes
    this.state.mode = mode;
    this.render();
  }
  setBusy(busy: boolean): void {
    this.state.busy = busy;
    this.render();
    this.kbd?.notifyBusyChanged(busy);
  }
  setAutoplay(a: AutoplayOptions): void {
    this.state.autoplay = a;
    this.render();
  }
  setTurbo(level: number): void {
    this.state.turbo = level;
    this.render();
  }
  setBuyBonusEnabled(enabled: boolean): void {
    this.state.buyBonusEnabled = enabled;
    this.render();
  }
  setFreeSpins(fs: FreeSpinsState): void {
    this.state.freeSpins = fs;
    this.render();
  }

  /** Show/hide the whole shell (bar + overlays). Used by the host to scope the bar to the
   *  slot scene — hidden over the intro / non-slot scenes. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Recolour the shell at runtime (switch dark/light scheme or accent). */
  setTheme(theme: ThemeConfig): void {
    this.config.theme = theme;
    this.tokens = resolveTheme(theme);
    this.render();
  }

  /** Toggle the social vocabulary at runtime (rebuilds resolver, re-renders bar). */
  setSocial(isSocial: boolean): void {
    this.config.isSocial = isSocial;
    this.i18n = createI18n({ language: this.config.language, isSocial });
    this.render();
  }

  /** Swap the active language at runtime (rebuilds resolver, re-renders bar). */
  setLanguage(lang: string): void {
    this.config.language = lang;
    this.i18n = createI18n({ language: lang, isSocial: this.config.isSocial });
    this.render();
  }

  /** Force the bar layout (wide/mobile). Normally derived from the renderer size on resize; this
   *  is the manual override (mirrors GameShell.setLayout). It is re-derived on the next resize. */
  setLayout(layout: 'wide' | 'mobile'): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.render();
  }

  // ── layout / input ────────────────────────────────────────────────────────────
  private onResize = (): void => {
    this.syncLayout();
    this.render();
    if (this.currentLayer) {
      this.currentLayer.resize?.(this.screenW, this.screenH);
      this.makeBackdrop(); // re-snapshot at the new size
      if (this.backdrop) this.modalLayer.setChildIndex(this.backdrop.node, 0); // keep it below the layer
    }
  };

  private syncLayout(): void {
    const w = this.screenW;
    const h = this.screenH;
    this.layout = w !== 0 && h > w ? 'mobile' : 'wide';
  }

  /** Pull window focus into the iframe on first pointer interaction so `document` keydown (the
   *  spacebar shortcut) fires. Harmless when already focused / full-page. */
  private pullFocus = (): void => {
    try {
      window.focus();
    } catch {
      /* cross-origin / non-browser */
    }
  };

  /** Fade out (≈250ms, like GameShell's REMOVE_FADE_MS) then tear down; resolves when removed. */
  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    if (typeof document !== 'undefined') {
      this.kbd?.detach();
      document.removeEventListener('pointerdown', this.pullFocus, true);
    }
    this.cancelMoneyAnims();
    this.removeAllListeners();
    this.clearLayer();
    this.root.eventMode = 'none';
    return new Promise<void>((resolve) => {
      tween(this.ticker, {
        duration: 250,
        onUpdate: (p) => {
          this.root.alpha = 1 - p;
        },
        onComplete: () => {
          this.root.destroy({ children: true });
          resolve();
        },
      });
    });
  }
}
