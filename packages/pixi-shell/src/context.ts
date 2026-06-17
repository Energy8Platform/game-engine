import type { Container, Ticker } from 'pixi.js';
import type { ShellTokens } from './theme';
import type { EventEmitter } from './EventEmitter';
import type {
  PixiShellConfig,
  ShellState,
  ShellEvents,
  BonusOption,
  ModalOptions,
  ReplayModalOptions,
} from './types';

/** A pushed full-screen layer (overlay or centred modal). Optional hooks let the host re-fit it
 *  on resize. */
export interface ShellLayer extends Container {
  /** Re-flow to a new screen size (overlays fill it; cards re-centre + fit-scale). */
  resize?(w: number, h: number): void;
  /** Re-run the card fit-scale backstop for short popouts. */
  fit?(): void;
  /** Called right before the layer is removed, so it can detach DOM listeners etc. */
  onRemove?(): void;
}

export interface LayerHandle {
  root: ShellLayer;
  close(): void;
}

/** The contract every shell component depends on — the Pixi analogue of passing the `GameShell`
 *  instance into the DOM components. `PixiGameShell` implements it. Decoupling via this interface
 *  keeps components free of a direct import of the shell class. */
export interface ShellHost {
  readonly tokens: ShellTokens;
  readonly ticker: Ticker;
  readonly canvas?: HTMLCanvasElement;
  readonly config: PixiShellConfig;
  readonly state: ShellState;
  readonly layout: 'wide' | 'mobile';
  readonly screenW: number;
  readonly screenH: number;

  /** Resolve a built-in string (social word-swap when `isSocial`). */
  t(text: string): string;
  /** Format a money amount in the shell currency (fixed minDecimals — balance/bet/prices). */
  fmt(n: number): string;
  /** Format a win / total-win amount (variable decimals — keeps small wins' significant digits). */
  fmtWin(n: number): string;
  /** Typed event emit — same signature as the DOM shell. */
  emit: EventEmitter<ShellEvents>['emit'];
  /** Re-render the bottom bar. */
  render(): void;

  /** Push a full-screen layer (replaces any open one), returns a handle to close it. */
  pushLayer(node: ShellLayer): LayerHandle;
  /** Close the current top layer (overlay/modal), if any. */
  closeLayer(): void;
  /** Re-fit every open card modal (short-popout backstop). */
  fitModals(): void;

  openMenu(): void;
  openSettings(): void;
  openInfo(): void;
  openBuyBonus(): void;
  openBetPicker(): void;
  openAutoplayPicker(): void;
  openReplay(opts: ReplayModalOptions): void;
  openModal(opts: ModalOptions): void;

  activateFeature(bonus: BonusOption): void;
  deactivateFeature(): void;
}
