import { Assets } from 'pixi.js';
import type { AssetManifest, AssetBundle, AssetEntry } from '../types';

/**
 * Manages game asset loading with progress tracking, bundle support, and
 * automatic base path resolution from SDK's assetsUrl.
 *
 * Wraps PixiJS Assets API with a typed, game-oriented interface.
 *
 * @example
 * ```ts
 * const assets = new AssetManager('https://cdn.example.com/game/', manifest);
 * await assets.init();
 * await assets.loadBundle('preload', (p) => console.log(p));
 * const texture = assets.get<Texture>('hero');
 * ```
 */
export class AssetManager {
  private _initialized = false;
  private _basePath: string;
  private _manifest: AssetManifest | null;
  private _loadedBundles = new Set<string>();

  constructor(basePath: string = '', manifest?: AssetManifest) {
    this._basePath = basePath;
    this._manifest = manifest ?? null;
  }

  /** Whether the asset system has been initialized */
  get initialized(): boolean {
    return this._initialized;
  }

  /** Base path for all assets (usually from SDK's assetsUrl) */
  get basePath(): string {
    return this._basePath;
  }

  /** Set of loaded bundle names */
  get loadedBundles(): ReadonlySet<string> {
    return this._loadedBundles;
  }

  /**
   * Initialize the asset system.
   * Must be called before loading any assets.
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    await Assets.init({
      basePath: this._basePath || undefined,
      texturePreference: {
        resolution: Math.min(window.devicePixelRatio, 2),
        format: ['webp', 'png'],
      },
    });

    // Register bundles from manifest
    if (this._manifest) {
      for (const bundle of this._manifest.bundles) {
        Assets.addBundle(
          bundle.name,
          bundle.assets.map((a) => ({
            alias: a.alias,
            src: a.src,
            data: a.data,
          })),
        );
      }
    }

    this._initialized = true;
  }

  /**
   * Load a single bundle by name.
   *
   * @param name - Bundle name (must exist in the manifest)
   * @param onProgress - Progress callback (0..1)
   * @returns Loaded assets map
   */
  async loadBundle(
    name: string,
    onProgress?: (progress: number) => void,
  ): Promise<Record<string, unknown>> {
    this.ensureInitialized();

    const result = await Assets.loadBundle(name, onProgress);
    this._loadedBundles.add(name);
    return result;
  }

  /**
   * Load multiple bundles simultaneously.
   * Progress is aggregated across all bundles.
   *
   * @param names - Bundle names
   * @param onProgress - Progress callback (0..1)
   */
  async loadBundles(
    names: string[],
    onProgress?: (progress: number) => void,
  ): Promise<Record<string, unknown>> {
    this.ensureInitialized();

    const result = await Assets.loadBundle(names, onProgress);
    for (const name of names) {
      this._loadedBundles.add(name);
    }
    return result;
  }

  /**
   * Load individual assets by URL or alias.
   *
   * @param urls - Asset URLs or aliases
   * @param onProgress - Progress callback (0..1)
   */
  async load<T = unknown>(
    urls: string | string[],
    onProgress?: (progress: number) => void,
  ): Promise<T> {
    this.ensureInitialized();
    return Assets.load<T>(urls, onProgress);
  }

  /**
   * Get a loaded asset synchronously from cache.
   *
   * @param alias - Asset alias
   * @throws if not loaded
   */
  get<T = unknown>(alias: string): T {
    return Assets.get<T>(alias);
  }

  /**
   * Unload a bundle to free memory.
   */
  async unloadBundle(name: string): Promise<void> {
    await Assets.unloadBundle(name);
    this._loadedBundles.delete(name);
  }

  /**
   * Start background loading a bundle (low-priority preload).
   * Useful for loading bonus round assets while player is in base game.
   */
  async backgroundLoad(name: string): Promise<void> {
    this.ensureInitialized();
    await Assets.backgroundLoadBundle(name);
  }

  /**
   * Get all bundle names from the manifest.
   */
  getBundleNames(): string[] {
    return this._manifest?.bundles.map((b) => b.name) ?? [];
  }

  /**
   * Check if a bundle is loaded.
   */
  isBundleLoaded(name: string): boolean {
    return this._loadedBundles.has(name);
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('[AssetManager] Not initialized. Call init() first.');
    }
  }
}
