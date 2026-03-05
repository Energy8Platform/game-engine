import type { AudioConfig } from '../types';

type AudioCategoryName = 'music' | 'sfx' | 'ui' | 'ambient';

interface CategoryState {
  volume: number;
  muted: boolean;
}

/**
 * Manages all game audio: music, SFX, UI sounds, ambient.
 *
 * Optional dependency on @pixi/sound — if not installed, AudioManager
 * operates as a silent no-op (graceful degradation).
 *
 * Features:
 * - Per-category volume control (music, sfx, ui, ambient)
 * - Music crossfade and looping
 * - Mobile audio unlock on first interaction
 * - Mute state persistence in localStorage
 * - Global mute/unmute
 *
 * @example
 * ```ts
 * const audio = new AudioManager({ music: 0.5, sfx: 0.8 });
 * await audio.init();
 * audio.playMusic('bg-music');
 * audio.play('spin-click', 'sfx');
 * ```
 */
export class AudioManager {
  private _soundModule: any = null;
  private _initialized = false;
  private _globalMuted = false;
  private _persist: boolean;
  private _storageKey: string;
  private _categories: Record<AudioCategoryName, CategoryState>;
  private _currentMusic: string | null = null;
  private _unlocked = false;
  private _unlockHandler: (() => void) | null = null;

  constructor(config?: AudioConfig) {
    this._persist = config?.persist ?? true;
    this._storageKey = config?.storageKey ?? 'ge_audio';

    this._categories = {
      music: { volume: config?.music ?? 0.7, muted: false },
      sfx: { volume: config?.sfx ?? 1.0, muted: false },
      ui: { volume: config?.ui ?? 0.8, muted: false },
      ambient: { volume: config?.ambient ?? 0.5, muted: false },
    };

    // Restore persisted state
    if (this._persist) {
      this.restoreState();
    }
  }

  /** Whether the audio system is initialized */
  get initialized(): boolean {
    return this._initialized;
  }

  /** Whether audio is globally muted */
  get muted(): boolean {
    return this._globalMuted;
  }

  /**
   * Initialize the audio system.
   * Dynamically imports @pixi/sound to keep it optional.
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    try {
      this._soundModule = await import('@pixi/sound');
      this._initialized = true;
      this.applyVolumes();
      this.setupMobileUnlock();
    } catch {
      console.warn(
        '[AudioManager] @pixi/sound not available. Audio disabled.',
      );
      this._initialized = false;
    }
  }

  /**
   * Play a sound effect.
   *
   * @param alias - Sound alias (must be loaded via AssetManager)
   * @param category - Audio category (default: 'sfx')
   * @param options - Additional play options
   */
  play(
    alias: string,
    category: AudioCategoryName = 'sfx',
    options?: { volume?: number; loop?: boolean; speed?: number },
  ): void {
    if (!this._initialized || !this._soundModule) return;
    if (this._globalMuted || this._categories[category].muted) return;

    const { sound } = this._soundModule;
    const vol = (options?.volume ?? 1) * this._categories[category].volume;

    try {
      sound.play(alias, {
        volume: vol,
        loop: options?.loop ?? false,
        speed: options?.speed ?? 1,
      });
    } catch (e) {
      console.warn(`[AudioManager] Failed to play "${alias}":`, e);
    }
  }

  /**
   * Play background music with optional crossfade.
   *
   * @param alias - Music alias
   * @param fadeDuration - Crossfade duration in ms (default: 500)
   */
  playMusic(alias: string, fadeDuration = 500): void {
    if (!this._initialized || !this._soundModule) return;

    const { sound } = this._soundModule;

    // Stop current music with fade-out, start new music with fade-in
    if (this._currentMusic && fadeDuration > 0) {
      const prevAlias = this._currentMusic;
      this._currentMusic = alias;

      if (this._globalMuted || this._categories.music.muted) return;

      // Fade out the previous track
      this.fadeVolume(prevAlias, this._categories.music.volume, 0, fadeDuration, () => {
        try { sound.stop(prevAlias); } catch { /* ignore */ }
      });

      // Start new track at zero volume, fade in
      try {
        sound.play(alias, {
          volume: 0,
          loop: true,
        });
        this.fadeVolume(alias, 0, this._categories.music.volume, fadeDuration);
      } catch (e) {
        console.warn(`[AudioManager] Failed to play music "${alias}":`, e);
      }
    } else {
      // No crossfade — instant switch
      if (this._currentMusic) {
        try { sound.stop(this._currentMusic); } catch { /* ignore */ }
      }

      this._currentMusic = alias;
      if (this._globalMuted || this._categories.music.muted) return;

      try {
        sound.play(alias, {
          volume: this._categories.music.volume,
          loop: true,
        });
      } catch (e) {
        console.warn(`[AudioManager] Failed to play music "${alias}":`, e);
      }
    }
  }

  /**
   * Stop current music.
   */
  stopMusic(): void {
    if (!this._initialized || !this._soundModule || !this._currentMusic) return;
    const { sound } = this._soundModule;
    try {
      sound.stop(this._currentMusic);
    } catch {
      // ignore
    }
    this._currentMusic = null;
  }

  /**
   * Stop all sounds.
   */
  stopAll(): void {
    if (!this._initialized || !this._soundModule) return;
    const { sound } = this._soundModule;
    sound.stopAll();
    this._currentMusic = null;
  }

  /**
   * Set volume for a category.
   */
  setVolume(category: AudioCategoryName, volume: number): void {
    this._categories[category].volume = Math.max(0, Math.min(1, volume));
    this.applyVolumes();
    this.saveState();
  }

  /**
   * Get volume for a category.
   */
  getVolume(category: AudioCategoryName): number {
    return this._categories[category].volume;
  }

  /**
   * Mute a specific category.
   */
  muteCategory(category: AudioCategoryName): void {
    this._categories[category].muted = true;
    this.applyVolumes();
    this.saveState();
  }

  /**
   * Unmute a specific category.
   */
  unmuteCategory(category: AudioCategoryName): void {
    this._categories[category].muted = false;
    this.applyVolumes();
    this.saveState();
  }

  /**
   * Toggle mute for a category.
   */
  toggleCategory(category: AudioCategoryName): boolean {
    this._categories[category].muted = !this._categories[category].muted;
    this.applyVolumes();
    this.saveState();
    return this._categories[category].muted;
  }

  /**
   * Mute all audio globally.
   */
  muteAll(): void {
    this._globalMuted = true;
    if (this._soundModule) {
      this._soundModule.sound.muteAll();
    }
    this.saveState();
  }

  /**
   * Unmute all audio globally.
   */
  unmuteAll(): void {
    this._globalMuted = false;
    if (this._soundModule) {
      this._soundModule.sound.unmuteAll();
    }
    this.saveState();
  }

  /**
   * Toggle global mute.
   */
  toggleMute(): boolean {
    if (this._globalMuted) {
      this.unmuteAll();
    } else {
      this.muteAll();
    }
    return this._globalMuted;
  }

  /**
   * Duck music volume (e.g., during big win presentation).
   *
   * @param factor - Volume multiplier (0..1), e.g. 0.3 = 30% of normal
   */
  duckMusic(factor: number): void {
    if (!this._initialized || !this._soundModule || !this._currentMusic) return;
    const { sound } = this._soundModule;
    const vol = this._categories.music.volume * factor;
    try {
      sound.volume(this._currentMusic, vol);
    } catch {
      // ignore
    }
  }

  /**
   * Restore music to normal volume after ducking.
   */
  unduckMusic(): void {
    if (!this._initialized || !this._soundModule || !this._currentMusic) return;
    const { sound } = this._soundModule;
    try {
      sound.volume(this._currentMusic, this._categories.music.volume);
    } catch {
      // ignore
    }
  }

  /**
   * Destroy the audio manager and free resources.
   */
  destroy(): void {
    this.stopAll();
    this.removeMobileUnlock();
    if (this._soundModule) {
      this._soundModule.sound.removeAll();
    }
    this._initialized = false;
  }

  // ─── Private ───────────────────────────────────────────

  /**
   * Smoothly fade a sound's volume from `fromVol` to `toVol` over `durationMs`.
   */
  private fadeVolume(
    alias: string,
    fromVol: number,
    toVol: number,
    durationMs: number,
    onComplete?: () => void,
  ): void {
    if (!this._soundModule) return;
    const { sound } = this._soundModule;
    const startTime = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const vol = fromVol + (toVol - fromVol) * t;
      try { sound.volume(alias, vol); } catch { /* ignore */ }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        onComplete?.();
      }
    };
    requestAnimationFrame(tick);
  }

  private applyVolumes(): void {
    if (!this._soundModule) return;
    const { sound } = this._soundModule;
    sound.volumeAll = this._globalMuted ? 0 : 1;
  }

  private setupMobileUnlock(): void {
    if (this._unlocked) return;

    this._unlockHandler = () => {
      if (!this._soundModule) return;
      const { sound } = this._soundModule;
      // Resume WebAudio context
      if (sound.context?.audioContext?.state === 'suspended') {
        sound.context.audioContext.resume();
      }
      this._unlocked = true;
      this.removeMobileUnlock();
    };

    const events = ['touchstart', 'mousedown', 'pointerdown', 'keydown'];
    for (const event of events) {
      document.addEventListener(event, this._unlockHandler, { once: true });
    }
  }

  private removeMobileUnlock(): void {
    if (!this._unlockHandler) return;
    const events = ['touchstart', 'mousedown', 'pointerdown', 'keydown'];
    for (const event of events) {
      document.removeEventListener(event, this._unlockHandler);
    }
    this._unlockHandler = null;
  }

  private saveState(): void {
    if (!this._persist) return;
    try {
      const state = {
        globalMuted: this._globalMuted,
        categories: this._categories,
      };
      localStorage.setItem(this._storageKey, JSON.stringify(state));
    } catch {
      // localStorage may not be available
    }
  }

  private restoreState(): void {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (typeof state.globalMuted === 'boolean') {
        this._globalMuted = state.globalMuted;
      }
      if (state.categories) {
        for (const key of ['music', 'sfx', 'ui', 'ambient'] as const) {
          if (state.categories[key]) {
            this._categories[key] = {
              volume: state.categories[key].volume ?? this._categories[key].volume,
              muted: state.categories[key].muted ?? false,
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }
}
