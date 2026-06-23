import { Container, Graphics, Text } from 'pixi.js';
import { Scene } from '@energy8platform/game-engine/core';
import { Tween } from '@energy8platform/game-engine/animation';

/** Start data the host injects (onStart advances to the game scene). */
interface IntroData { onStart?: () => void; }

/** Full intro scene for Spec Slot. Edit this freely — background, logo, buttons, animation. */
export class IntroScene extends Scene {
  private layer?: Container;

  async onEnter(data?: unknown): Promise<void> {
    const { onStart } = (data ?? {}) as IntroData;
    const layer = new Container();
    this.layer = layer;
    this.container.addChild(layer);

    // Background — replace with a texture sprite once you have art.
    const bg = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0x0b0f1a });
    layer.addChild(bg);

    const title = new Text({ text: 'Spec Slot', style: { fill: 0xffffff, fontSize: 110, fontFamily: 'Inter', fontWeight: '700', align: 'center' } });
    title.anchor.set(0.5); title.position.set(960, 420);
    layer.addChild(title);

    const subtitle = new Text({ text: 'Press PLAY to begin', style: { fill: 0x9fb3c8, fontSize: 34, fontFamily: 'Inter' } });
    subtitle.anchor.set(0.5); subtitle.position.set(960, 520);
    layer.addChild(subtitle);

    // PLAY button (replace with the engine UI Button or your own art).
    const btn = new Container(); btn.position.set(960, 660);
    const bgBtn = new Graphics().roundRect(-150, -45, 300, 90, 16).fill({ color: 0xffd24a });
    const label = new Text({ text: 'PLAY', style: { fill: 0x0b0f1a, fontSize: 40, fontFamily: 'Inter', fontWeight: '700' } });
    label.anchor.set(0.5);
    btn.addChild(bgBtn, label);
    btn.eventMode = 'static'; btn.cursor = 'pointer';
    btn.once('pointerdown', () => onStart?.());
    layer.addChild(btn);

    layer.alpha = 0;
    await Tween.to(layer, { alpha: 1 }, 400);
  }

  onExit(): void {
    this.layer?.destroy({ children: true });
    this.layer = undefined;
  }
}
