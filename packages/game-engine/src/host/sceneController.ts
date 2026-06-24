import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Host-provided, normalized play() injected into the scene via bindHost. */
export interface SlotHostApi<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Play an action. Pass `roundId` (from a previous result) to drain the next segment of an
   *  in-flight round — e.g. each free spin of a bonus — instead of starting a new round. */
  play(action: string, bet: number, roundId?: string): Promise<T>;
  /** Acknowledge the most recent result — call AFTER the scene has finished animating it. On
   *  Stake this is what settles the round (`/wallet/end-round`, only when the win paid out), so
   *  forgetting to call it leaves the round open and blocks the next spin. */
  ack(): void;
}

/** Thin contract a slot scene implements; the host calls it on shell events. Duck-typed. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
  /** Present an in-flight round recovered on reload (host calls this on "Continue"). Animate the
   *  snapshot WITHOUT calling host.ack() — the host settles the resumed round itself. Optional;
   *  scenes that don't implement it simply can't visually replay a resumed round. */
  resume?(result: T): Promise<void>;
  /** Host injects its normalized play() once, on mount. */
  bindHost?(api: SlotHostApi<T>): void;
}
