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
  private _masterGain = 1.0;
  private _currentMusic: string | null = null;
  /** Duck factor (0..1) from duckMusic/unduckMusic. A presentation state, not a player setting. */
  private _musicDuck = 1;
  /** Crossfade ramp (0..1) for the track that is fading IN. 1 whenever no fade is running. */
  private _musicFade = 1;
  /** Generation counter so a superseded crossfade ramp stops writing over the new track's. */
  private _musicFadeToken = 0;
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
      if (this._globalMuted) {
        this._soundModule.sound.muteAll();
      }
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
    // The master gain lives on the GLOBAL bus (`sound.volumeAll`, see applyVolumes) and @pixi/sound
    // already multiplies it in — folding it in here as well squared it, so a master of 0.5 played
    // sfx at 0.25.
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
    const prevAlias = this._currentMusic;
    const crossfade = !!prevAlias && prevAlias !== alias && fadeDuration > 0;

    // Retire the outgoing track. Its own SOUND-level volume is the only thing still pointing at it,
    // so fading that to 0 is safe — nothing else writes it once `_currentMusic` has moved on.
    if (prevAlias) {
      if (crossfade) {
        const from = this.soundVolumeOf(prevAlias);
        this.fadeVolume(prevAlias, from, 0, fadeDuration, () => {
          try { sound.stop(prevAlias); } catch { /* ignore */ }
        });
      } else {
        try { sound.stop(prevAlias); } catch { /* ignore */ }
      }
    }

    this._currentMusic = alias;
    this._musicFadeToken++; // any ramp still running belongs to a track we just replaced

    // Deliberately started even while muted. Global mute is the @pixi/sound CONTEXT mute and a
    // muted music category is a 0 term in `musicGain()` — both already make this inaudible, and
    // both undo themselves the moment the player flips them back. Returning early here instead
    // meant a track begun while muted never existed, so unmuting restored silence until some
    // later mode change happened to switch tracks.

    // The incoming track plays at INSTANCE volume 1 and carries its whole gain on the SOUND layer
    // (`musicGain()`), which is the layer the slider, the duck and this fade all write. Splitting
    // them across layers is what silenced every crossfade: the track was started at instance volume
    // 0 and the ramp then moved the sound layer, whose product with 0 is 0 for the track's life.
    // The gain is written BEFORE play() so the first frame is never at full volume.
    this._musicFade = crossfade ? 0 : 1;
    this.applyMusicGain();
    try {
      sound.play(alias, { volume: 1, loop: true });
    } catch (e) {
      console.warn(`[AudioManager] Failed to play music "${alias}":`, e);
      return;
    }
    if (crossfade) this.rampMusicFade(fadeDuration);
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
    // Retire any running ramp and clear the fade term, so the next track does not inherit a
    // half-finished crossfade and start silent.
    this._musicFadeToken++;
    this._musicFade = 1;
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

  /** Global gain (0..1) folded into every category's effective volume. Driven by the shell's
   *  'master' settingChange. Does not affect the persisted per-category volumes. */
  setMasterVolume(volume: number): void {
    this._masterGain = Math.max(0, Math.min(1, volume));
    this.applyVolumes();
  }

  getMasterVolume(): number {
    return this._masterGain;
  }

  /**
   * Set volume for a category.
   */
  setVolume(category: AudioCategoryName, volume: number): void {
    this._categories[category].volume = Math.max(0, Math.min(1, volume));
    // applyVolumes() re-pushes the music gain, so moving the Music slider is heard on the track
    // that is ALREADY playing — it used to take effect only at the next playMusic (a mode change).
    // SFX need no push: play() reads the category volume fresh on every call.
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
    // Held as a FACTOR rather than written as a finished volume: the duck used to write
    // `category × factor` onto a track whose instance already carried the category volume, so it
    // ducked to category², and unducking restored category² instead of category. Keeping it as one
    // term of `musicGain()` also keeps the slider live while ducked.
    this._musicDuck = Math.max(0, Math.min(1, factor));
    this.applyMusicGain();
  }

  /**
   * Restore music to normal volume after ducking.
   */
  unduckMusic(): void {
    this._musicDuck = 1;
    this.applyMusicGain();
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

  /**
   * The SOUND-layer gain for the running music track.
   *
   * @pixi/sound resolves a playing instance as `instance × sound × global` (WebAudioInstance.
   * refresh). Each of those three has exactly ONE owner here, which is what keeps the mixer honest:
   *   global   — the master gain (`applyVolumes`)
   *   sound    — music: this function. sfx: untouched, left at 1.
   *   instance — sfx: the per-call volume × the sfx category. music: always 1.
   * Everything that can move music volume — the player's slider, the category mute, a big-win duck,
   * a crossfade — is a term below, so they compose instead of overwriting each other.
   */
  private musicGain(): number {
    const c = this._categories.music;
    return (c.muted ? 0 : 1) * c.volume * this._musicDuck * this._musicFade;
  }

  /** Push `musicGain()` at the current track. Safe before it starts playing and with none playing. */
  private applyMusicGain(): void {
    if (!this._soundModule || !this._currentMusic) return;
    try {
      this._soundModule.sound.volume(this._currentMusic, this.musicGain());
    } catch {
      // ignore — alias not registered yet
    }
  }

  /** Current SOUND-layer volume of `alias`, or 0 when it cannot be read. */
  private soundVolumeOf(alias: string): number {
    try {
      return Number(this._soundModule.sound.volume(alias)) || 0;
    } catch {
      return 0;
    }
  }

  /** Ramp the crossfade term 0 → 1 over `durationMs`, recomposing the gain each frame so a slider
   *  drag or a duck landing mid-fade is honoured rather than overwritten when the fade ends. */
  private rampMusicFade(durationMs: number): void {
    const token = this._musicFadeToken;
    const start = Date.now();
    const tick = (): void => {
      if (token !== this._musicFadeToken) return; // a newer track owns the music now
      const t = Math.min((Date.now() - start) / durationMs, 1);
      this._musicFade = t;
      this.applyMusicGain();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private applyVolumes(): void {
    if (!this._soundModule) return;
    const { sound } = this._soundModule;
    // Global mute is owned by sound.muteAll()/unmuteAll() (context.muted),
    // not by volumeAll — mixing both leaves mute un-undoable after reload.
    sound.volumeAll = this._masterGain; // master multiplies the global bus
    this.applyMusicGain(); // category volume/mute reach the RUNNING track
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
