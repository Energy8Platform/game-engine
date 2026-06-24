/** The boundary at which a collected multiplier resets. */
export type CarryPolicy = 'spin' | 'cascade' | 'session';

// How long each policy survives: cascade (shortest) < spin < session (longest).
const RANK: Record<CarryPolicy, number> = { cascade: 0, spin: 1, session: 2 };

/**
 * Headless sticky/collector multiplier — the unified abstraction behind
 * kitsunebi / recipe / orb / stage multipliers. reset(boundary) clears the
 * value only when the boundary is at or above the configured policy scope.
 */
export class MultiplierAccumulator {
  value: number;
  private readonly base: number;
  private readonly policy: CarryPolicy;

  constructor(cfg: { policy: CarryPolicy; base?: number }) {
    this.policy = cfg.policy;
    this.base = cfg.base ?? 1;
    this.value = this.base;
  }

  add(delta: number): void { this.value += delta; }
  set(value: number): void { this.value = value; }

  reset(boundary: CarryPolicy): void {
    if (RANK[boundary] >= RANK[this.policy]) this.value = this.base;
  }
}
