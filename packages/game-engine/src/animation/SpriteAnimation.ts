import { AnimatedSprite, Texture, Spritesheet } from 'pixi.js';

// ─── Types ───────────────────────────────────────────────

export interface SpriteAnimationConfig {
  /** Frames per second (default: 24) */
  fps?: number;
  /** Whether to loop (default: true) */
  loop?: boolean;
  /** Start playing immediately (default: true) */
  autoPlay?: boolean;
  /** Callback when animation completes (non-looping) */
  onComplete?: () => void;
  /** Anchor point (default: 0.5 = center) */
  anchor?: number | { x: number; y: number };
}

/**
 * Helper for creating frame-based animations from spritesheets.
 *
 * Wraps PixiJS `AnimatedSprite` with a convenient API for
 * common iGaming effects: coin showers, symbol animations,
 * sparkle trails, win celebrations.
 *
 * Cheaper than Spine for simple frame sequences.
 *
 * @example
 * ```ts
 * // From an array of textures
 * const coinAnim = SpriteAnimation.create(coinTextures, {
 *   fps: 30,
 *   loop: true,
 * });
 * scene.addChild(coinAnim);
 *
 * // From a spritesheet with a naming pattern
 * const sheet = Assets.get('effects');
 * const sparkle = SpriteAnimation.fromSpritesheet(sheet, 'sparkle_');
 * sparkle.play();
 *
 * // From a numbered range
 * const explosion = SpriteAnimation.fromRange(sheet, 'explosion_{i}', 0, 24, {
 *   fps: 60,
 *   loop: false,
 *   onComplete: () => explosion.destroy(),
 * });
 * ```
 */
export class SpriteAnimation {
  /**
   * Create an animated sprite from an array of textures.
   *
   * @param textures - Array of PixiJS Textures
   * @param config - Animation options
   * @returns Configured AnimatedSprite
   */
  static create(textures: Texture[], config: SpriteAnimationConfig = {}): AnimatedSprite {
    const sprite = new AnimatedSprite(textures);

    // Configure
    sprite.animationSpeed = (config.fps ?? 24) / 60; // PixiJS uses speed relative to 60fps ticker
    sprite.loop = config.loop ?? true;

    // Anchor
    if (config.anchor !== undefined) {
      if (typeof config.anchor === 'number') {
        sprite.anchor.set(config.anchor);
      } else {
        sprite.anchor.set(config.anchor.x, config.anchor.y);
      }
    } else {
      sprite.anchor.set(0.5);
    }

    // Complete callback
    if (config.onComplete) {
      sprite.onComplete = config.onComplete;
    }

    // Auto-play
    if (config.autoPlay !== false) {
      sprite.play();
    }

    return sprite;
  }

  /**
   * Create an animated sprite from a spritesheet using a name prefix.
   *
   * Collects all textures whose keys start with `prefix`, sorted alphabetically.
   *
   * @param sheet - PixiJS Spritesheet instance
   * @param prefix - Texture name prefix (e.g., 'coin_')
   * @param config - Animation options
   * @returns Configured AnimatedSprite
   */
  static fromSpritesheet(
    sheet: Spritesheet,
    prefix: string,
    config: SpriteAnimationConfig = {},
  ): AnimatedSprite {
    const textures = SpriteAnimation.getTexturesByPrefix(sheet, prefix);

    if (textures.length === 0) {
      console.warn(`[SpriteAnimation] No textures found with prefix "${prefix}"`);
    }

    return SpriteAnimation.create(textures, config);
  }

  /**
   * Create an animated sprite from a numbered range of frames.
   *
   * The `pattern` string should contain `{i}` as a placeholder for the frame number.
   * Numbers are zero-padded to match the length of `start`.
   *
   * @param sheet - PixiJS Spritesheet instance
   * @param pattern - Frame name pattern, e.g. 'explosion_{i}'
   * @param start - Start frame index (inclusive)
   * @param end - End frame index (inclusive)
   * @param config - Animation options
   * @returns Configured AnimatedSprite
   */
  static fromRange(
    sheet: Spritesheet,
    pattern: string,
    start: number,
    end: number,
    config: SpriteAnimationConfig = {},
  ): AnimatedSprite {
    const textures: Texture[] = [];
    const padLength = String(end).length;

    for (let i = start; i <= end; i++) {
      const name = pattern.replace('{i}', String(i).padStart(padLength, '0'));
      const texture = sheet.textures[name];

      if (texture) {
        textures.push(texture);
      } else {
        console.warn(`[SpriteAnimation] Missing frame: "${name}"`);
      }
    }

    if (textures.length === 0) {
      console.warn(`[SpriteAnimation] No textures found for pattern "${pattern}" [${start}..${end}]`);
    }

    return SpriteAnimation.create(textures, config);
  }

  /**
   * Create an AnimatedSprite from texture aliases (loaded via AssetManager).
   *
   * @param aliases - Array of texture aliases
   * @param config - Animation options
   * @returns Configured AnimatedSprite
   */
  static fromAliases(aliases: string[], config: SpriteAnimationConfig = {}): AnimatedSprite {
    const textures = aliases.map((alias) => {
      const tex = Texture.from(alias);
      return tex;
    });

    return SpriteAnimation.create(textures, config);
  }

  /**
   * Play a one-shot animation and auto-destroy when complete.
   * Useful for fire-and-forget effects like coin bursts.
   *
   * @param textures - Array of textures
   * @param config - Animation options (loop will be forced to false)
   * @returns Promise that resolves when animation completes
   */
  static playOnce(
    textures: Texture[],
    config: SpriteAnimationConfig = {},
  ): { sprite: AnimatedSprite; finished: Promise<void> } {
    const finished = new Promise<void>((resolve) => {
      config = {
        ...config,
        loop: false,
        onComplete: () => {
          config.onComplete?.();
          sprite.destroy();
          resolve();
        },
      };
    });

    const sprite = SpriteAnimation.create(textures, config);
    return { sprite, finished };
  }

  // ─── Utility ───────────────────────────────────────────

  /**
   * Get all textures from a spritesheet that start with a given prefix.
   * Results are sorted alphabetically by key.
   */
  static getTexturesByPrefix(sheet: Spritesheet, prefix: string): Texture[] {
    const keys = Object.keys(sheet.textures)
      .filter((k) => k.startsWith(prefix))
      .sort();

    return keys.map((k) => sheet.textures[k]);
  }
}
