import type { Container, Ticker } from 'pixi.js';
import type { ShellHost, ShellState } from '@energy8platform/shell';

/** A pushed full-screen layer (overlay / modal). */
export interface Layer extends Container {
  /** Re-flow to a new screen size. */
  resize?(w: number, h: number): void;
  /** Right before removal — detach DOM listeners etc. */
  onRemove?(): void;
  /** Keys while open: true consumes (Escape otherwise closes the layer). */
  onKey?(e: KeyboardEvent): boolean;
}

/** What BM components read: the core brain plus the Pixi surface the renderer provides. */
export interface BmCtx extends ShellHost {
  readonly ticker: Ticker;
  readonly canvas?: HTMLCanvasElement;
  readonly screenW: number;
  readonly screenH: number;
  pushLayer(node: Layer, opts?: { backdrop?: boolean }): void;
  closeLayer(): void;
  /** Rebuild the bar. */
  render(): void;
  /** Balance / bet / prices (fixed decimals). */
  fmt(n: number): string;
  /** Wins (variable decimals). */
  fmtWin(n: number): string;
}

/** Design px → screen px. The brandbook draws at 1920×1080; a portrait screen lays out at 720 wide
 *  (1080 would leave 9px labels on a phone). */
export function uiScale(w: number, h: number): number {
  const s = w >= h ? Math.min(w / 1920, h / 1080) : Math.min(w / 720, h / 1280);
  return Math.max(0.2, Math.min(1.4, s));
}

// Copies of the core lock predicates (not part of the shell's public entry).

/** A round, a run or a disabled flag locks bonus buys. */
export function bonusBuyLocked(s: ShellState): boolean {
  return s.busy || s.autoplay.active || !s.buyBonusEnabled;
}

/** The menu (and game info) is locked during a round, a run and a bonus; a replay is exempt. */
export function menuLocked(s: ShellState): boolean {
  return s.busy || s.autoplay.active || (s.mode !== 'base' && s.mode !== 'replay');
}
