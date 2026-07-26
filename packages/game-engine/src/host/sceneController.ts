import type { Container } from 'pixi.js';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { WinReportOptions } from './winReporter';

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
  /** Only meaningful in `onEnterMode`: true when RETURNING to a suspended parent bonus after a
   *  nested sub-bonus finished (e.g. back to free spins after an adventure), false on a fresh
   *  entry. Lets a scene restore vs rebuild. Undefined outside `onEnterMode`. */
  resumed?: boolean;
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
  /** Re-layout the same `container` when the canvas resizes while the overlay is open.
   *  Receives the content container from `build` and the new size. Optional — omit for
   *  overlays that self-center or don't care about resize. */
  onResize?(container: Container, size: { width: number; height: number }): void;
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
  /**
   * Grow the shell's WIN readout WHILE a segment presents — for cascade/tumble games that pay in
   * steps instead of one lump at the end.
   *
   * `amountSoFar` is ABSOLUTE: the win accumulated by this segment up to now (not the step's
   * delta), so a re-report, a skip, or an aborted step can just restate the truth. The host owns
   * the readout around it — it clears WIN to 0 when the segment starts and sets the segment's
   * final value once `onSpin` resolves (counting up from your last report, so matching numbers
   * produce no jump). In a bonus this moves WIN only; the Total Win accumulator still lands once
   * per segment.
   *
   * Only honoured while a segment is presenting (inside `onSpin`); calls from anywhere else are
   * ignored, so a scene still ticking after an abort can't overwrite the host's final number.
   *
   * `durationMs` sets this count-up's length (default 450ms) — pass your step length (or a shorter
   * one under turbo) so each count-up finishes before the next step lands. `{ animate: false }`
   * snaps, e.g. when collapsing to the final value on skip.
   */
  reportWin(amountSoFar: number, opts?: WinReportOptions): void;
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
 *  shell; the scene only renders + reacts. The core spin-lifecycle hooks are REQUIRED (implement
 *  them — empty bodies are fine where a game has nothing to do); the incidental reactions below
 *  stay optional. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Injected ONCE before the first round — capabilities, subscriptions, one-time setup. */
  onCreate(api: SceneApi): void;
  /** Fires once per round when the player presses spin (before the network result). */
  onSpinStart(): void;
  /** Render ONE segment (a spin or one free spin). Await your own pacing. */
  onSpin(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when a bonus LEVEL begins. With nested bonuses this fires once per level (free spins,
   *  then adventure, …) — check `ctx.mode` for which. `ctx.resumed` is true when returning to a
   *  suspended parent after a nested sub-bonus finished, so a scene can restore instead of rebuild.
   *  A single-bonus round fires it exactly once (as before). */
  onEnterMode(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when a bonus LEVEL ends — popping a nested sub-bonus back to its parent, or unwinding
   *  the last level back to BASE. `ctx.mode` is the level being left. Fires once per level. */
  onExitMode(result: T, ctx: RenderContext): Promise<void>;
  /** Fires once per round after the full drain (controls unlocked). */
  onSpinEnd(result: T, ctx: RenderContext): void;
  /** Shell events (may fire while idle) — optional. */
  onBetChanged?(bet: number): void;
  onTurboChanged?(level: number): void;
  onAutoplayChanged?(state: AutoplaySceneState): void;
  /** Double-tap skip during an active onSpin (gated by the skipGesture setting). */
  onSkip?(): void;
  /** Tab focus lost / regained. */
  onPause?(): void;
  onResume?(): void;
}
