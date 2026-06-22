import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { Tween, Easing } from '../../animation';
import { pickTier, tierIndexAtValue, type WinTier } from './tiers';
import { CountUpDisplay } from './CountUpDisplay';

export interface BigWinOverlayConfig {
  tiers: WinTier[];
  formatMoney: (v: number) => string;
  countUpDuration?: (win: number) => number;
  particleCount?: number;
  width: number;
  height: number;
}

const DEFAULT_DURATION = (win: number) => Math.min(2500, Math.max(800, win * 20));

export class BigWinOverlay extends Container {
  readonly __uiComponent = true as const;

  private _cfg: BigWinOverlayConfig;
  private _dim: Graphics;
  private _banner: Sprite | null = null;
  private _title: Text;
  private _count: CountUpDisplay;

  constructor(config: BigWinOverlayConfig) {
    super();
    this._cfg = config;
    this.visible = false;

    this._dim = new Graphics();
    this.addChild(this._dim);

    this._title = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 72, fill: 0xffffff, fontWeight: '900' } });
    this._title.anchor.set(0.5);
    this.addChild(this._title);

    this._count = new CountUpDisplay({ format: config.formatMoney });
    this.addChild(this._count);

    this.resize(config.width, config.height);
  }

  /** Pure helper (testable): the tier title for a given win/bet, or null below the lowest tier. */
  tierTitleFor(win: number, bet: number): string | null {
    return pickTier(this._cfg.tiers, win, bet)?.title ?? null;
  }

  resize(width: number, height: number): void {
    this._cfg.width = width; this._cfg.height = height;
    this._dim.clear();
    this._dim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.72 });
    this._title.position.set(width / 2, height * 0.4);
    this._count.position.set(width / 2, height * 0.56);
  }

  async show(win: number, bet: number): Promise<void> {
    const tier = pickTier(this._cfg.tiers, win, bet);
    if (!tier) return;
    this.visible = true;
    this.alpha = 0;
    this._title.text = tier.title;
    this._title.style.fill = tier.accentColor;

    if (this._banner) { this._banner.destroy(); this._banner = null; }
    if (tier.bannerTexture) {
      this._banner = new Sprite(tier.bannerTexture);
      this._banner.anchor.set(0.5);
      this._banner.position.set(this._cfg.width / 2, this._cfg.height * 0.4);
      this.addChildAt(this._banner, 1);
    }

    await Tween.to(this, { alpha: 1 }, 200, Easing.easeOutQuad);
    const dur = (this._cfg.countUpDuration ?? DEFAULT_DURATION)(win);
    let lastIdx = tierIndexAtValue(this._cfg.tiers, 0, bet);
    await this._count.countTo(win, dur, undefined);
    // tier-promotion title updates as the value climbs (sampled at the end for simplicity)
    const finalIdx = tierIndexAtValue(this._cfg.tiers, win, bet);
    if (finalIdx > lastIdx && this._cfg.tiers[finalIdx]) {
      this._title.text = this._cfg.tiers[finalIdx].title;
    }
    void lastIdx;
  }

  skip(): void { Tween.killTweensOf(this); this._count.skip(); }

  hide(): void { this.visible = false; Tween.killTweensOf(this); }
}
