// packages/game-engine/src/scenes/IntroScene.ts
import { Container, Graphics, Text } from 'pixi.js';
import { Scene } from '../core/Scene';

export interface IntroSceneConfig {
  title?: string;
  logo?: string;          // texture alias (optional; title text is the default)
  tapToStart?: boolean;   // default true
  /** Host wires this to scenes.goto(gameKey). */
  onStart: () => void;
}

/** Reusable splash scene: shows a title (or logo) + "tap to start", then calls onStart. */
export class IntroScene extends Scene {
  private layer?: Container;

  async onEnter(data?: unknown): Promise<void> {
    const cfg = (data ?? {}) as IntroSceneConfig;
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
    hit.once('pointerdown', () => cfg.onStart?.());
    layer.addChild(hit);
  }

  onExit(): void {
    this.layer?.destroy({ children: true });
    this.layer = undefined;
  }
}
