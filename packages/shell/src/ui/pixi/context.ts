import type { Container, Ticker } from 'pixi.js';
import type { ShellHost } from '@/core/renderer';

/** A pushed full-screen layer (overlay or centred modal). Optional hooks let the host re-fit it
 *  on resize. */
export interface ShellLayer extends Container {
  /** Re-flow to a new screen size (overlays fill it; cards re-centre + fit-scale). */
  resize?(w: number, h: number): void;
  /** Re-run the card fit-scale backstop for short popouts. */
  fit?(): void;
  /** Called right before the layer is removed, so it can detach DOM listeners etc. */
  onRemove?(): void;
  /** Called by the shell keyboard controller while this layer is open.
   *  Return true to consume the key (prevents bar actions + Escape close); false to pass through
   *  (Escape → closeLayer). */
  onKey?(e: KeyboardEvent): boolean;
}

export interface LayerHandle {
  root: ShellLayer;
  close(): void;
}

/** What pixi components read: the core brain (ShellHost) plus the Pixi-specific surface the
 *  PixiRenderer provides (ticker, screen size, layer stack).
 *
 *  Members already on core ShellHost (state, config, tokens, layout, soundOn, t, emit, setSound,
 *  getVolume, setVolume, menu, getMenuValue, setMenuValue, setMenuRefresh, actions, formatCurrency,
 *  notifyResize) are NOT re-declared here.
 *
 *  fmt/fmtWin decision: pixi components in pixi-shell use `host.fmt(n)` / `host.fmtWin(n)`.
 *  Rather than retargeting all components to `host.formatCurrency(n)` / `host.formatCurrency(n, true)`
 *  in Task 12, we add `fmt` and `fmtWin` as convenience shorthands here. The PixiRenderer will
 *  implement them as thin wrappers over `formatCurrency`. This avoids a wider refactor in Task 12
 *  while keeping components portable. */
export interface PixiComponentContext extends ShellHost {
  readonly ticker: Ticker;
  readonly canvas?: HTMLCanvasElement;
  readonly screenW: number;
  readonly screenH: number;
  render(): void;
  pushLayer(node: ShellLayer, opts?: { backdrop?: boolean }): LayerHandle;
  closeLayer(): void;
  fitModals(): void;
  /** Swap the active language at runtime (rebuilds resolver, re-renders bar). Optional. */
  setLanguage?(lang: string): void;
  /** Format a money amount in the shell currency (fixed minDecimals — balance/bet/prices).
   *  Convenience shorthand over formatCurrency(n). */
  fmt(n: number): string;
  /** Format a win / total-win amount (variable decimals — keeps small wins' significant digits).
   *  Convenience shorthand over formatCurrency(n, true). */
  fmtWin(n: number): string;
}
