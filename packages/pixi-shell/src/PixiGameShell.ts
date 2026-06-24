import { BlurFilter, Container, RenderTexture, Sprite, type Application, type Ticker } from 'pixi.js';
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
import { socialize } from './i18n';
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
  private keysBound = false;

  constructor(config: PixiShellConfig) {
    super();
    installShellFont();
    this.config = config;
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
      document.addEventListener('keydown', this.onKeyDown);
      // Stake serves the game in an iframe; on first paint focus is on the HOST page, so a
      // `document` keydown never fires and Space scrolls the parent. Pull focus into the frame on
      // the first pointer interaction so the spacebar shortcut works. Harmless full-page.
      document.addEventListener('pointerdown', this.pullFocus, true);
      this.keysBound = true;
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

  t(text: string): string {
    return this.config.isSocial ? socialize(text) : text;
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

  private backdrop?: { sprite: Sprite; texture: RenderTexture };

  /** Snapshot the scene behind the modal layer and blur it — the Pixi analogue of the overlay's
   *  `backdrop-filter: blur(20px)`. Static (captured at open time): the game is paused under a
   *  modal, so a live re-blur each frame isn't worth the cost. */
  private makeBackdrop(): void {
    this.removeBackdrop();
    const renderer = this.app.renderer;
    const w = this.screenW;
    const h = this.screenH;
    if (w <= 0 || h <= 0) return;
    try {
      // Downsample the snapshot (½ res) then blur moderately, and let the sprite upscale it back:
      // the downscale + upscale already softens heavily, and a moderate strength stays within the
      // blur kernel (a huge strength under-samples → a thin, weak blur). Net: a strong frosted
      // backdrop that hides the shell well, far cheaper than a full-res large-radius blur.
      const texture = RenderTexture.create({ width: w, height: h, resolution: 0.5 });
      this.modalLayer.visible = false; // never capture the (empty) modal layer / a stale backdrop
      renderer.render({ container: this.app.stage, target: texture, clear: true });
      this.modalLayer.visible = true;
      const sprite = new Sprite(texture);
      const blur = new BlurFilter({ strength: 10, quality: 5 });
      blur.repeatEdgePixels = true; // no transparent edge halo
      sprite.filters = [blur];
      this.modalLayer.addChild(sprite); // below the layer node, which is added next
      this.backdrop = { sprite, texture };
    } catch {
      this.modalLayer.visible = true; // headless / no GL → skip the blur, the veil tint still shows
    }
  }

  private removeBackdrop(): void {
    if (this.backdrop) {
      this.modalLayer.removeChild(this.backdrop.sprite);
      this.backdrop.sprite.destroy();
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

  /** Recolour the shell at runtime (switch dark/light scheme or accent). */
  setTheme(theme: ThemeConfig): void {
    this.config.theme = theme;
    this.tokens = resolveTheme(theme);
    this.render();
  }

  /** Toggle the social vocabulary at runtime (re-renders the bar; reopen overlays to refresh). */
  setSocial(isSocial: boolean): void {
    this.config.isSocial = isSocial;
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
      if (this.backdrop) this.modalLayer.setChildIndex(this.backdrop.sprite, 0); // keep it below the layer
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

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed || e.code !== 'Space' || e.repeat) return;
    if (this.config.features.spacebar === false) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    e.preventDefault(); // Space is ours — swallow the page scroll even when we then bail below
    if (this.currentLayer) return; // an overlay/modal is open
    if (this.state.mode !== 'base' || this.state.busy || this.state.autoplay.active) return;
    this.emit('spin');
  };

  /** Fade out (≈250ms, like GameShell's REMOVE_FADE_MS) then tear down; resolves when removed. */
  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    if (this.keysBound && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKeyDown);
      document.removeEventListener('pointerdown', this.pullFocus, true);
      this.keysBound = false;
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
