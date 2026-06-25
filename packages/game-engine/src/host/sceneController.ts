import type { Container } from 'pixi.js';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Everything a scene needs to render one segment. The host builds it per segment. */
export interface RenderContext {
  /** Bet for this round (major units). Stable for the whole round. */
  bet: number;
  /** Trigger action in the game's own vocabulary ('spin' | 'ante' | 'buy_bonus' | …). */
  action: string;
  /** Stake bet-mode of the round ('BASE' | 'ANTE' | 'BONUS' | …). */
  mode: string;
  /** Currency-aware money formatter. */
  formatAmount(value: number): string;
  /** LIVE turbo level (0 = off, 1..3 = escalating speed). Read at access. */
  readonly turbo: number;
  /** Aborted when the player skips this segment (double-tap). The scene's async pacing can race or
   *  cancel on it; on abort the scene must collapse to the segment's final visual state. */
  signal: AbortSignal;
}

/** Playback-only audio handle. Volume/mute are shell settings → host, never the scene. */
export interface SceneAudio {
  play(alias: string, opts?: { volume?: number; loop?: boolean; speed?: number }): void;
  playMusic(alias: string, fadeMs?: number): void;
  stopMusic(): void;
  duck(factor: number): void;
  unduck(): void;
}

export interface OverlayShowOptions {
  /** Draw the overlay content into `container` (sized to the canvas). */
  build(container: Container, size: { width: number; height: number }): void;
  /** Auto-close after N ms (combine with closeOn — whichever fires first). */
  autoCloseMs?: number;
  /** Dismiss on a single tap. Default 'tap'. Set false to require an explicit close(). */
  closeOn?: 'tap' | false;
  /** Optional host-drawn backdrop alpha (0..1). Default: none (game draws its own). */
  dim?: number;
}

/** Single host-owned layer above scene + shell. Eats pointer events so shell controls are
 *  unreachable while open. */
export interface SceneOverlay {
  /** Resolves when the overlay closes. Rejects if one is already open. */
  show(opts: OverlayShowOptions): Promise<void>;
  close(): void;
}

export interface SceneShell {
  /** Live insets (px). `bottom` = the shell bar height; read inside onResize. */
  readonly safeArea: { top: number; right: number; bottom: number; left: number };
}

export interface AutoplaySceneState {
  running: boolean;
  remaining: number;
}

/** Stable capabilities injected once via onCreate. */
export interface SceneApi {
  audio: SceneAudio;
  overlay: SceneOverlay;
  shell: SceneShell;
  formatAmount(value: number): string;
  readonly bet: number;
  readonly mode: string;
  readonly turbo: number;
}

/** The contract a slot scene implements. The HOST owns the play→present→ack→drain loop and the
 *  shell; the scene only renders + reacts. Only `onSpin` is required. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Injected ONCE before the first round — capabilities, subscriptions, one-time setup. */
  onCreate?(api: SceneApi): void;
  /** Fires once per round when the player presses spin (before the network result). */
  onSpinStart?(): void;
  /** Render ONE segment (a spin or one free spin). Required. Await your own pacing. */
  onSpin(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when ctx.mode changes between segments (entering a non-BASE mode/bonus). */
  onEnterMode?(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when leaving a mode (back toward BASE). */
  onExitMode?(result: T, ctx: RenderContext): Promise<void>;
  /** Fires once per round after the full drain (controls unlocked). */
  onSpinEnd?(result: T, ctx: RenderContext): void;
  /** Shell events (may fire while idle). */
  onBetChanged?(bet: number): void;
  onTurboChanged?(level: number): void;
  onAutoplayChanged?(state: AutoplaySceneState): void;
  /** Double-tap skip during an active onSpin (gated by the skipGesture setting). */
  onSkip?(): void;
  /** Tab focus lost / regained. */
  onPause?(): void;
  onResume?(): void;
}
