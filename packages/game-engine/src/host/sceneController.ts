import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Host-provided, normalized play() injected into the scene via bindHost. */
export interface SlotHostApi<T extends SlotSpinResultBase = SlotSpinResultBase> {
  play(action: string, bet: number): Promise<T>;
}

/** Thin contract a slot scene implements; the host calls it on shell events. Duck-typed. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
  /** Host injects its normalized play() once, on mount. */
  bindHost?(api: SlotHostApi<T>): void;
}
