// packages/game-engine/src/scenes/IntroScene.ts
import { Container, Graphics, Text } from 'pixi.js';
import { Scene } from '../core/Scene';

export interface IntroSceneConfig {
  title?: string;
  logo?: string;          // texture alias (optional; title text is the default)
  tapToStart?: boolean;   // default true
  /** Where to navigate on tap. Defaults to the conventional 'game' key. */
  next?: string;
  /** Optional explicit start callback. Takes precedence over `goto(next)`. */
  onStart?: () => void;
}

/**
 * Reusable splash scene: shows a title (or logo) + "tap to start", then advances.
 *
 * The host no longer special-cases the intro. Navigation works like every other
 * scene: the host injects `goto(key)` into this scene's start data. On tap this
 * scene calls `onStart` if the game supplied one, otherwise `goto(next ?? 'game')`.
 * (The built-in can't know the game's scene key generically, so it falls back to
 * the conventional 'game' key — override via `next`. Scaffold-generated intros
 * skip this primitive and call `goto('game')` directly.)
 */
export class IntroScene extends Scene {
  private layer?: Container;

  async onEnter(data?: unknown): Promise<void> {
    const cfg = (data ?? {}) as IntroSceneConfig & { goto?: (key: string, data?: unknown) => void };
    const start = () =>
      cfg.onStart ? cfg.onStart() : cfg.goto?.(cfg.next ?? 'game');
    const layer = new Container();
    this.layer = layer;
    this.container.addChild(layer);

    const title = new Text({
      text: cfg.title ?? 'PLAY',
      style: { fill: 0xffffff, fontSize: 96, fontFamily: 'Inter', align: 'center' },
    });
    title.anchor.set(0.5);
    title.position.set(960, 460);
    layer.addChild(title);

    if (cfg.tapToStart !== false) {
      const hint = new Text({
        text: 'Tap to start',
        style: { fill: 0xffd24a, fontSize: 36, fontFamily: 'Inter' },
      });
      hint.anchor.set(0.5);
      hint.position.set(960, 600);
      layer.addChild(hint);
    }

    // full-screen tap target
    const hit = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0.001 });
    hit.eventMode = 'static';
    hit.cursor = 'pointer';
    hit.once('pointerdown', () => start());
    layer.addChild(hit);
  }

  onExit(): void {
    this.layer?.destroy({ children: true });
    this.layer = undefined;
  }
}
