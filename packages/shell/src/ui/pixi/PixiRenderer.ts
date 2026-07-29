import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Application,
  type Text,
  type Ticker,
} from 'pixi.js';
import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';
import type { ShellTokens } from '@/core/theme';
import type { PixiComponentContext, ShellLayer, LayerHandle } from './context';
import { installShellFont, whenFontReady } from './text';
import { countUpText, tween } from './motion-pixi';
import { BottomBar } from './components/BottomBar';
import { openMenu } from './components/Menu';
import { openGameInfo } from './components/GameInfo';
import { openBuyBonus } from './components/BuyBonus';
import { openBetPicker, openAutoplayPicker } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';

export interface PixiRendererOptions {
  app: Application;
  parent?: Container;
}

/** The Pixi VIEW half of the shell — the renderer the controller drives. Owns the root/bar/modal
 *  containers, builds the BottomBar + overlays, runs money count-ups + the frosted backdrop, and
 *  reports its surface size back to the controller. All the keyboard / pull-focus / overlay-flow
 *  logic lives in the ShellController; this class is pure Pixi rendering — a 1:1 port of the
 *  PixiGameShell rendering methods. */
export class PixiRenderer implements ShellRenderer {
  private app: Application;
  private parent?: Container;
  private host!: ShellHost;
  private ctx!: PixiComponentContext;

  private root = new Container();
  private barLayer = new Container();
  private modalLayer = new Container();
  private bar?: BottomBar;
  private currentLayer: ShellLayer | null = null;
  private backdrop?: { node: Container; texture: RenderTexture };
  private moneyAnims: Array<() => void> = [];
  private destroyed = false;

  constructor(opts: PixiRendererOptions) {
    this.app = opts.app;
    this.parent = opts.parent;
  }

  private get ticker(): Ticker {
    return this.app.ticker;
  }
  private get screenW(): number {
    return this.app.screen.width;
  }
  private get screenH(): number {
    return this.app.screen.height;
  }

  // ── ShellRenderer ────────────────────────────────────────────────────────────
  mount(host: ShellHost): void {
    installShellFont();
    this.host = host;
    this.ctx = this.makeContext();

    this.root.eventMode = 'static';
    this.root.addChild(this.barLayer, this.modalLayer);
    (this.parent ?? this.app.stage).addChild(this.root);
    // make sure the stage delivers global pointer moves (drag, sliders)
    this.app.stage.eventMode = 'static';

    this.app.renderer.on('resize', this.onResize);
    // Seed the layout from the CURRENT screen size. The renderer was resized to the container during
    // boot (ViewportManager.refresh) BEFORE this shell mounted and subscribed above, so that initial
    // 'resize' event is already gone and won't fire again on a stationary device. Without this seed
    // the controller's layout stays at its 'wide' DEFAULT — a portrait mobile would show the DESKTOP
    // bar. (The HTML renderer gets this for free: its ResizeObserver fires immediately on observe.)
    if (this.screenW > 0) this.host.notifyResize(this.screenW, this.screenH);
    whenFontReady(() => {
      if (!this.destroyed) this.renderBar();
    });
  }

  renderBar(): void {
    if (this.destroyed) return;
    this.cancelMoneyAnims();
    if (this.bar) {
      this.barLayer.removeChild(this.bar);
      this.bar.destroy({ children: true });
    }
    this.bar = new BottomBar(this.ctx);
    this.barLayer.addChild(this.bar);
    this.bar.applyFit();
    // renderBar() runs on every resize AND on ~20 other state changes (bet/win/turbo/mode/…), any of
    // which can change the bar's own fitScale()/menuPlate() (e.g. a WIN pill appearing mid-autoplay
    // retriggers the wide layout's overflow-tightening branch). Only onResize used to reposition the
    // open layer, so a live bar-content change while the menu was open left it at the stale
    // scale/position until the next resize. Every ShellLayer's resize() only re-reads current
    // geometry and re-fits/re-centres itself — none of them call back into renderBar() (verified:
    // Popover, CardModal, Overlay, BuyBonusOverlay) — so this cannot recurse; `currentLayer` is
    // `null` whenever nothing is open, so this cannot throw either.
    this.currentLayer?.resize?.(this.screenW, this.screenH);
  }

  setLayout(): void {
    this.renderBar();
  }

  /** Tokens are read live from host.tokens by the components, so a theme change is just a re-render
   *  (mirrors PixiGameShell.setTheme which re-rendered). */
  applyTheme(_tokens: ShellTokens): void {
    this.renderBar();
  }

  /** Count a money readout from→to on the freshly-rendered bar's value Text node. Mirrors
   *  PixiGameShell.animateMoney (which counted on the just-built bar's value Texts). */
  animateMoney(field: 'balance' | 'win', from: number, to: number, durationMs?: number): void {
    if (!this.bar) return;
    // countUpText defaults durationMs to 450 — pass it only when the caller overrode it.
    const count = (text: Text, fmt: (n: number) => string) =>
      durationMs == null
        ? countUpText(this.ticker, text, from, to, fmt)
        : countUpText(this.ticker, text, from, to, fmt, durationMs);
    if (field === 'balance' && this.bar.balanceValue) {
      this.moneyAnims.push(count(this.bar.balanceValue, (n) => this.ctx.fmt(n)));
    } else if (field === 'win' && this.bar.winValue) {
      this.moneyAnims.push(count(this.bar.winValue, (n) => this.ctx.fmtWin(n)));
    }
  }

  private cancelMoneyAnims(): void {
    for (const c of this.moneyAnims) c();
    this.moneyAnims = [];
  }

  openOverlay(req: OverlayRequest): OverlayHandle | void {
    let layer: ShellLayer | null = null;
    switch (req.kind) {
      case 'menu':
        // Getters, not `this.bar` by value: renderBar() destroys/rebuilds the bar on every resize
        // and ~20 other state changes, in the same resize handler that then repositions this popover
        // — see Menu.ts's openMenu doc comment for why this must stay lazy. menuAnchor (the burger)
        // is the arrow's pointer; menuPlate (the plaque) drives placement; fitScale is the same
        // factor BottomBar applies to its own content via `inner.scale`.
        layer = openMenu(
          this.ctx,
          () => this.bar?.menuAnchor() ?? null,
          () => this.bar?.menuPlate() ?? null,
          () => this.bar?.fitScale() ?? 1,
        );
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
    this.pushLayer(layer, { backdrop: req.kind !== 'menu' });
    const built = layer;
    return {
      onKey: built.onKey ? built.onKey.bind(built) : undefined,
      close: () => this.closeOverlay(),
    };
  }

  closeOverlay(): void {
    this.closeLayer();
  }

  /** Fade out (≈250ms, like GameShell's REMOVE_FADE_MS) then tear down; resolves when removed. */
  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    this.cancelMoneyAnims();
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

  // ── layer stack ────────────────────────────────────────────────────────────
  pushLayer(node: ShellLayer, opts?: { backdrop?: boolean }): LayerHandle {
    this.clearLayer();
    // Light-dismiss layers (the menu popover) opt out with `{ backdrop: false }` — no frosted
    // snapshot, the game stays visible behind them. Every other caller is unaffected (defaults on).
    if (opts?.backdrop !== false) this.makeBackdrop(); // frosted snapshot (the DOM's backdrop-filter:blur)
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

  fitModals(): void {
    this.currentLayer?.fit?.();
  }

  // ── frosted backdrop ─────────────────────────────────────────────────────────
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

  // ── safe area / visibility (PixiGameShell parity) ─────────────────────────────
  /** Height of the bottom control bar in px (0 before first layout, or in replay-only chrome). */
  get barHeight(): number {
    return this.bar?.height ?? 0;
  }

  /** Insets a scene should avoid. Only the bottom bar is reserved; the rest is full-bleed. */
  get safeArea(): { top: number; right: number; bottom: number; left: number } {
    return { top: 0, right: 0, bottom: this.barHeight, left: 0 };
  }

  /** Show/hide the whole shell (bar + overlays). */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  // ── resize ───────────────────────────────────────────────────────────────────
  private onResize = (): void => {
    if (this.destroyed) return;
    // Report the new surface size; the controller recomputes layout (wide|mobile) and re-renders the
    // bar (setLayout → renderBar / renderBar). This keeps PixiGameShell.onResize behaviour: the bar
    // is rebuilt at the new size, then the open layer is re-fit and the backdrop re-snapshotted.
    this.host.notifyResize(this.screenW, this.screenH);
    if (this.currentLayer) {
      this.currentLayer.resize?.(this.screenW, this.screenH);
      this.makeBackdrop(); // re-snapshot at the new size
      if (this.backdrop) this.modalLayer.setChildIndex(this.backdrop.node, 0); // keep it below the layer
    }
  };

  // ── PixiComponentContext factory ──────────────────────────────────────────────
  /** Build the surface pixi components read: the core brain (host) plus the Pixi-specific members
   *  (ticker, canvas, screen size, the layer-stack methods, fmt/fmtWin shorthands). */
  private makeContext(): PixiComponentContext {
    const host = this.host;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const ctx: PixiComponentContext = {
      // — core ShellHost (forwarded) —
      get state() { return host.state; },
      get config() { return host.config; },
      get tokens() { return host.tokens; },
      get layout() { return host.layout; },
      get soundOn() { return host.soundOn; },
      get menu() { return host.menu; },
      get actions() { return host.actions; },
      openReplay: (opts) => host.openReplay(opts),
      t: (s) => host.t(s),
      formatCurrency: (n, win) => host.formatCurrency(n, win),
      emit: host.emit.bind(host),
      notifyResize: (w, h) => host.notifyResize(w, h),
      setSound: (on) => host.setSound(on),
      getVolume: (key) => host.getVolume(key),
      setVolume: (key, v) => host.setVolume(key, v),
      getMenuValue: (id) => host.getMenuValue(id),
      setMenuValue: (id, v) => host.setMenuValue(id, v),
      setMenuRefresh: (fn) => host.setMenuRefresh(fn),
      // — Pixi-specific surface —
      get ticker() { return self.app.ticker; },
      get canvas() { return self.app.canvas as HTMLCanvasElement | undefined; },
      get screenW() { return self.app.screen.width; },
      get screenH() { return self.app.screen.height; },
      render: () => self.renderBar(),
      pushLayer: (node, opts) => self.pushLayer(node, opts),
      // Route component-initiated closes through the controller (not straight to self.closeLayer) so
      // it clears its OverlayHandle. Otherwise the handle goes stale: hasOpenLayer() stays true and
      // keydowns keep routing to onKey on a destroyed overlay → write to a torn-down ScrollBox.
      closeLayer: () => host.actions.closeOverlay(),
      fitModals: () => self.fitModals(),
      fmt: (n) => host.formatCurrency(n),
      fmtWin: (n) => host.formatCurrency(n, true),
    };
    return ctx;
  }
}
