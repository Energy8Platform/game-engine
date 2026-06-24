import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Everything a scene needs to render one result. The host builds it once per round. */
export interface RenderContext {
  /** Bet for this round (major units). Stable for the whole round (a bonus is one round). */
  bet: number;
  /** Trigger action in the game's own vocabulary (gameSpec.actions keys): 'spin' | 'ante' |
   *  'buy_bonus' | … Stable for the whole round. */
  action: string;
  /** Stake bet-mode of the round (model.spec.modeMap[action]): 'BASE' | 'ANTE' | 'BONUS' | …
   *  Canonical per-round identifier of WHICH bonus/feature this is. Stable for the whole round. */
  mode: string;
  /** Currency-aware money formatter. win/totalWin get variable decimals (0.0041 stays 0.0041). */
  formatAmount(value: number): string;
  /** LIVE turbo level (0 = off, 1..3 = escalating speed), matching the shell's state.turbo. Read at
   *  the moment of access (getter) so a mid-round toggle is reflected. */
  readonly turbo: number;
}

/** The contract a slot scene implements. The HOST owns the play→present→ack→drain loop and calls
 *  these; the scene only renders. The game never sees play/ack/roundId. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Render ONE segment (a spin, or one free spin). All pacing/pauses/overlays live here
   *  (await your own animations). The host calls this once per segment. */
  present(result: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires EXACTLY before the first free spin of a bonus (intro; spin counts in
   *  trigger.freeSpins). */
  onBonusEnter?(trigger: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires after the last free spin of a bonus (summary; last.totalWin = bonus total). */
  onBonusExit?(last: T, ctx: RenderContext): Promise<void>;
}
