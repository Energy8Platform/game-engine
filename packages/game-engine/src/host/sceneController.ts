/** Thin contract a slot scene implements; the host calls it on shell events. Duck-typed. */
export interface SlotSceneController {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
}
