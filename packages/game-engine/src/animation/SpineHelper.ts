/**
 * Helper for working with Spine animations in PixiJS v8.
 *
 * Optional — only works if @esotericsoftware/spine-pixi-v8 is installed.
 * Provides convenience methods for creating and playing Spine animations.
 *
 * @example
 * ```ts
 * // Load spine assets via AssetManager first
 * const spine = SpineHelper.create('char-data', 'char-atlas');
 * app.stage.addChild(spine);
 * await SpineHelper.playAnimation(spine, 'idle', true);
 * await SpineHelper.playAnimation(spine, 'win');
 * ```
 */
export class SpineHelper {
  private static _SpineClass: any = null;
  private static _loaded = false;

  /**
   * Ensure the Spine module is loaded.
   * Called automatically by create/playAnimation.
   */
  static async ensureLoaded(): Promise<boolean> {
    if (SpineHelper._loaded) return !!SpineHelper._SpineClass;

    try {
      const spineModule = await import('@esotericsoftware/spine-pixi-v8');
      SpineHelper._SpineClass = spineModule.Spine;
      SpineHelper._loaded = true;
      return true;
    } catch {
      console.warn('[SpineHelper] @esotericsoftware/spine-pixi-v8 not available.');
      SpineHelper._loaded = true;
      return false;
    }
  }

  /**
   * Create a Spine display object.
   *
   * @param skeletonAlias - Alias of the loaded .skel/.json asset
   * @param atlasAlias - Alias of the loaded .atlas asset
   * @param options - Additional Spine options
   * @returns Spine container (or null if Spine is not available)
   */
  static async create(
    skeletonAlias: string,
    atlasAlias: string,
    options?: {
      scale?: number;
      autoUpdate?: boolean;
    },
  ): Promise<any | null> {
    const available = await SpineHelper.ensureLoaded();
    if (!available || !SpineHelper._SpineClass) return null;

    const SpineClass = SpineHelper._SpineClass;

    // Use Spine.from for v4.2, constructor for v4.3+
    if (typeof SpineClass.from === 'function') {
      return SpineClass.from({
        skeleton: skeletonAlias,
        atlas: atlasAlias,
        scale: options?.scale,
        autoUpdate: options?.autoUpdate ?? true,
      });
    }

    return new SpineClass({
      skeleton: skeletonAlias,
      atlas: atlasAlias,
      scale: options?.scale,
      autoUpdate: options?.autoUpdate ?? true,
    });
  }

  /**
   * Play a named animation on a Spine object.
   * Returns a promise that resolves when the animation completes.
   * For looping animations, the promise never resolves.
   *
   * @param spine - Spine display object
   * @param animationName - Name of the animation
   * @param loop - Whether to loop (default: false)
   * @param track - Animation track (default: 0)
   */
  static playAnimation(
    spine: any,
    animationName: string,
    loop = false,
    track = 0,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!spine?.state) {
        resolve();
        return;
      }

      const entry = spine.state.setAnimation(track, animationName, loop);

      if (loop) {
        // Looping animations never complete — resolve immediately
        // so callers can fire-and-forget
        resolve();
        return;
      }

      // Wait for the animation to complete
      spine.state.addListener({
        complete: (completedEntry: any) => {
          if (completedEntry === entry) {
            resolve();
          }
        },
      });
    });
  }

  /**
   * Queue an animation after the current one finishes.
   *
   * @param spine - Spine display object
   * @param animationName - Animation name
   * @param delay - Mix duration / delay before starting
   * @param loop - Loop the queued animation
   * @param track - Animation track
   */
  static addAnimation(
    spine: any,
    animationName: string,
    delay = 0,
    loop = false,
    track = 0,
  ): void {
    spine?.state?.addAnimation(track, animationName, loop, delay);
  }

  /**
   * Get all animation names available on a Spine skeleton.
   */
  static getAnimationNames(spine: any): string[] {
    if (!spine?.skeleton?.data?.animations) return [];
    return spine.skeleton.data.animations.map((a: any) => a.name);
  }

  /**
   * Get all skin names available on a Spine skeleton.
   */
  static getSkinNames(spine: any): string[] {
    if (!spine?.skeleton?.data?.skins) return [];
    return spine.skeleton.data.skins.map((s: any) => s.name);
  }

  /**
   * Set the active skin on a Spine skeleton.
   */
  static setSkin(spine: any, skinName: string): void {
    spine?.skeleton?.setSkinByName(skinName);
    spine?.skeleton?.setSlotsToSetupPose();
  }
}
