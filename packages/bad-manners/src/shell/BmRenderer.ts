import { BlurFilter, Container, Graphics, RenderTexture, Sprite, type Application, type Text } from 'pixi.js';
import type { OverlayHandle, OverlayRequest, SafeArea, ShellHost, ShellRenderer, ShellTokens } from '@energy8platform/shell';
import { bmAssetsLoaded, loadBmAssets } from './assets';
import type { BmCtx, Layer } from './context';
import { Hud } from './Hud';
import { tween } from './motion';
import { setDisplayLanguage } from './text';
import { BLUR, LIME, parseColor, setAccent } from './theme';
import { openMenu } from './overlays/Menu';
import { openGameInfo } from './overlays/GameInfo';
import { openBuyBonus } from './overlays/BuyBonus';
import { openBetPicker, openAutoplayPicker } from './overlays/pickers';
import { buildModal, buildReplayModal } from './overlays/modals';

/** The Pixi view half of the BM shell (adapted from the HB renderer): owns the HUD and the overlay
 *  layer, counts money up, snapshots a blurred backdrop under panels, and reports its size back to
 *  the controller. Logic stays in the shell's controller. */
export class BmRenderer implements ShellRenderer {
  private app: Application;
  private parent?: Container;
  private host!: ShellHost;
  private ctx!: BmCtx;
  private root = new Container();
  private barLayer = new Container();
  private modalLayer = new Container();
  private bar?: Hud;
  private layer: Layer | null = null;
  private menuOpen = false;
  private layerBackdrop = false;
  private backdrop?: { node: Container; texture: RenderTexture };
  private money: Array<() => void> = [];
  private destroyed = false;
  /** The accent the factory was given (a game's `theme.accent` wins over it). */
  private baseAccent?: string | number;
  private accent = LIME;

  constructor(opts: { app: Application; parent?: Container; accent?: string | number }) {
    this.app = opts.app;
    this.parent = opts.parent;
    this.baseAccent = opts.accent;
  }

  /** `theme.accent`, else the factory's accent, else the kit's lime. */
  private resolveAccent(): number {
    return parseColor(this.host.config.theme?.accent) ?? parseColor(this.baseAccent) ?? LIME;
  }

  /** Repaint the kit in `accent`, then rebuild the bar and the open layer. */
  private paint(accent: number): void {
    this.accent = accent;
    setAccent(accent);
    void loadBmAssets(accent).then(() => {
      if (this.destroyed || accent !== this.accent) return;
      this.renderBar();
      this.layer?.resize?.(this.screenW, this.screenH);
    });
  }

  private get screenW(): number {
    return this.app.screen.width;
  }
  private get screenH(): number {
    return this.app.screen.height;
  }

  // ── ShellRenderer ─────────────────────────────────────────────────────────
  mount(host: ShellHost): void {
    this.host = host;
    this.ctx = this.makeContext();
    setDisplayLanguage(host.config.language);
    this.root.eventMode = 'static';
    this.root.addChild(this.barLayer, this.modalLayer);
    (this.parent ?? this.app.stage).addChild(this.root);
    this.app.stage.eventMode = 'static'; // global pointer moves (sliders, drags)
    this.app.renderer.on('resize', this.onResize);
    // the renderer was sized before this shell mounted; seed the layout from the current screen
    if (this.screenW > 0) host.notifyResize(this.screenW, this.screenH);
    this.paint(this.resolveAccent());
  }

  renderBar(): void {
    if (this.destroyed || !bmAssetsLoaded(this.accent)) return;
    this.cancelMoney();
    if (this.bar) {
      this.barLayer.removeChild(this.bar);
      this.bar.destroy({ children: true });
    }
    this.bar = new Hud(this.ctx);
    this.barLayer.addChild(this.bar);
    this.bar.applyFit();
    if (this.menuOpen) this.bar.setMenuOpen(true);
    this.layer?.resize?.(this.screenW, this.screenH);
  }

  setLayout(): void {
    this.renderBar();
  }

  /** Only the accent is themable (§3.1's lime); the rest of the palette is the brand's. */
  applyTheme(_tokens: ShellTokens): void {
    const a = this.resolveAccent();
    if (a !== this.accent) this.paint(a);
    else this.renderBar();
  }

  animateMoney(field: 'balance' | 'win', from: number, to: number, durationMs?: number): void {
    const text = field === 'balance' ? this.bar?.balanceValue : this.bar?.winValue;
    if (!text) return;
    const fmt = field === 'balance' ? this.ctx.fmt : this.ctx.fmtWin;
    // tokens motion.winCount: power1.out
    const dur = durationMs ?? 450;
    this.money.push(
      tween(this.app.ticker, {
        duration: dur,
        ease: (p) => 1 - (1 - p) * (1 - p),
        onUpdate: (p) => setText(text, fmt(from + (to - from) * p)),
        onComplete: () => setText(text, fmt(to)),
      }),
    );
  }

  private cancelMoney(): void {
    for (const c of this.money) c();
    this.money = [];
  }

  openOverlay(req: OverlayRequest): OverlayHandle | void {
    let layer: Layer | null = null;
    switch (req.kind) {
      case 'menu':
        layer = openMenu(this.ctx, () => this.bar?.menuAnchor() ?? null);
        break;
      case 'gameInfo':
        layer = openGameInfo(this.ctx);
        break;
      case 'buyBonus':
        layer = openBuyBonus(this.ctx);
        break;
      case 'betPicker':
        layer = openBetPicker(this.ctx);
        break;
      case 'autoplayPicker':
        layer = openAutoplayPicker(this.ctx);
        break;
      case 'replay':
        layer = buildReplayModal(this.ctx, req.opts, () => this.host.openReplay(req.opts));
        break;
      case 'modal':
        layer = buildModal(this.ctx, req.opts);
        break;
    }
    if (!layer) return;
    // the menu slides over the live game; every panel gets the blurred snapshot (§4.8)
    this.pushLayer(layer, { backdrop: req.kind !== 'menu' });
    // the burger turns into the ✕ while its menu is open
    this.menuOpen = req.kind === 'menu';
    if (this.menuOpen) this.bar?.setMenuOpen(true);
    const built = layer;
    return { onKey: built.onKey?.bind(built), close: () => this.closeOverlay() };
  }

  closeOverlay(): void {
    this.clearLayer();
  }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    this.cancelMoney();
    this.clearLayer();
    this.root.eventMode = 'none';
    return new Promise<void>((resolve) => {
      tween(this.app.ticker, {
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

  get safeArea(): SafeArea {
    return this.bar?.safeArea() ?? { top: 0, right: 0, bottom: 0, left: 0 };
  }

  get barHeight(): number {
    return this.safeArea.bottom;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  // ── layers ────────────────────────────────────────────────────────────────
  private pushLayer(node: Layer, opts?: { backdrop?: boolean }): void {
    this.clearLayer();
    this.layerBackdrop = opts?.backdrop !== false;
    if (this.layerBackdrop) this.makeBackdrop();
    this.layer = node;
    this.modalLayer.addChild(node);
  }

  private clearLayer(): void {
    if (this.layer) {
      this.layer.onRemove?.();
      this.modalLayer.removeChild(this.layer);
      this.layer.destroy({ children: true });
      this.layer = null;
    }
    this.layerBackdrop = false;
    this.removeBackdrop();
    if (this.menuOpen) this.bar?.setMenuOpen(false);
    this.menuOpen = false;
  }

  /** §4.8: a snapshot of the game, blurred (12). The panel draws its own scrim over it. */
  private makeBackdrop(): void {
    this.removeBackdrop();
    const w = this.screenW;
    const h = this.screenH;
    if (w <= 0 || h <= 0) return;
    const node = new Container();
    node.addChild(new Graphics().rect(0, 0, w, h).fill(0x000000));
    this.modalLayer.addChildAt(node, 0);
    this.backdrop = { node, texture: RenderTexture.create({ width: w, height: h, resolution: 0.5 }) };
    try {
      this.modalLayer.visible = false;
      this.app.renderer.render({ container: this.app.stage, target: this.backdrop.texture, clear: true });
      this.modalLayer.visible = true;
      const sprite = new Sprite(this.backdrop.texture);
      sprite.width = w;
      sprite.height = h;
      const blur = new BlurFilter({ strength: BLUR, quality: 4 });
      blur.repeatEdgePixels = true;
      sprite.filters = [blur];
      node.addChild(sprite);
    } catch {
      this.modalLayer.visible = true; // no GL (tests): the black base shows
    }
  }

  private removeBackdrop(): void {
    if (!this.backdrop) return;
    this.modalLayer.removeChild(this.backdrop.node);
    this.backdrop.node.destroy({ children: true });
    this.backdrop.texture.destroy(true);
    this.backdrop = undefined;
  }

  private onResize = (): void => {
    if (this.destroyed) return;
    this.host.notifyResize(this.screenW, this.screenH);
    if (this.layer) {
      this.layer.resize?.(this.screenW, this.screenH);
      if (this.layerBackdrop) this.makeBackdrop();
    }
  };

  private makeContext(): BmCtx {
    const host = this.host;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get state() {
        return host.state;
      },
      get config() {
        return host.config;
      },
      get tokens() {
        return host.tokens;
      },
      get layout() {
        return host.layout;
      },
      get soundOn() {
        return host.soundOn;
      },
      get menu() {
        return host.menu;
      },
      get actions() {
        return host.actions;
      },
      openReplay: (o) => host.openReplay(o),
      t: (s) => host.t(s),
      formatCurrency: (n, win) => host.formatCurrency(n, win),
      emit: host.emit.bind(host),
      notifyResize: (w, h) => host.notifyResize(w, h),
      setSound: (on) => host.setSound(on),
      getVolume: (k) => host.getVolume(k),
      setVolume: (k, v) => host.setVolume(k, v),
      getMenuValue: (id) => host.getMenuValue(id),
      setMenuValue: (id, v) => host.setMenuValue(id, v),
      setMenuRefresh: (fn) => host.setMenuRefresh(fn),
      get ticker() {
        return self.app.ticker;
      },
      get canvas() {
        return self.app.canvas as HTMLCanvasElement | undefined;
      },
      get screenW() {
        return self.app.screen.width;
      },
      get screenH() {
        return self.app.screen.height;
      },
      render: () => self.renderBar(),
      pushLayer: (node, opts) => self.pushLayer(node, opts),
      // through the controller, so it drops its overlay handle too
      closeLayer: () => host.actions.closeOverlay(),
      fmt: (n) => host.formatCurrency(n),
      fmtWin: (n) => host.formatCurrency(n, true),
    };
  }
}

function setText(t: Text, s: string): void {
  if (!t.destroyed) t.text = s;
}
