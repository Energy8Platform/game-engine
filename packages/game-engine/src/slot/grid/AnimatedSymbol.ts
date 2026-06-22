import { Container, Sprite, AnimatedSprite, type Texture } from 'pixi.js';
import { SpriteAnimation } from '../../animation';
import type { SymbolView } from './SymbolView';

export interface SymbolTextures { base: Texture; idle?: Texture[]; win?: Texture[]; }
export interface AnimatedSymbolConfig { textures: SymbolTextures; size: number; fps?: number; }

/** Built-in SymbolView: a static base sprite with optional idle/win spritesheet frames. */
export class AnimatedSymbol extends Container implements SymbolView {
  private _base: Sprite;
  private _anim: AnimatedSprite | null = null;
  private _textures: SymbolTextures;
  private _size: number;
  private _fps: number;

  constructor(config: AnimatedSymbolConfig) {
    super();
    this._textures = config.textures;
    this._size = config.size;
    this._fps = config.fps ?? 24;
    this._base = new Sprite(config.textures.base);
    this._base.anchor.set(0.5);
    this.addChild(this._base);
    this.resize(this._size);
  }

  setTextures(t: SymbolTextures): void {
    this._textures = t;
    this._base.texture = t.base;
    this.showStatic();
  }

  resize(size: number): void {
    this._size = size;
    this._base.width = size;
    this._base.height = size;
    if (this._anim) { this._anim.width = size; this._anim.height = size; }
  }

  showStatic(): void {
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._base.visible = true;
  }

  playIdle(): void {
    if (!this._textures.idle?.length) return;
    this._swap(this._textures.idle, true);
  }

  playWin(): Promise<void> {
    if (!this._textures.win?.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this._swap(this._textures.win!, false, () => { this.showStatic(); resolve(); });
    });
  }

  private _swap(frames: Texture[], loop: boolean, onComplete?: () => void): void {
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._base.visible = false;
    const a = SpriteAnimation.create(frames, { loop, autoPlay: true, onComplete });
    a.anchor.set(0.5);
    a.width = this._size;
    a.height = this._size;
    a.animationSpeed = this._fps / 60;
    this.addChild(a);
    this._anim = a;
  }
}
