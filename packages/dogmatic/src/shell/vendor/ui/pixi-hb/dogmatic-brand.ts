import { Container, Rectangle, Sprite, Texture } from 'pixi.js';

let collar: Texture | null = null;

/** Frame the generated artwork without redrawing its contours or typography. */
export function configureDogmaticArtwork(master: Texture): void {
  collar = new Texture({ source: master.source, frame: new Rectangle(197, 285, 360, 300) });
}

export function dogmaticGlyph(size: number): Container | null {
  if (!collar) return null;
  const box = new Container();
  const sprite = new Sprite(collar);
  sprite.width = size;
  sprite.height = size * 300 / 360;
  sprite.y = (size - sprite.height) / 2;
  // The generated master has a black ground. Screen preserves its drawn contours
  // against a dark shell surface without putting a black rectangle on that face.
  sprite.blendMode = 'screen';
  box.addChild(sprite);
  return box;
}
