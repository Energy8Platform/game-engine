/**
 * Host-side autoplay loop. The shell owns the picker + confirm (a count only commits after the
 * confirm modal); it emits `autoplayStart` with the chosen count and `autoplayStop`. This driver
 * runs N rounds back-to-back through the SAME `playRound` a manual spin uses (so a triggered bonus
 * drains fully before the next auto-spin), updating the shell's autoplay readout each spin and
 * halting on Stop, on an unaffordable spin, or on a play error.
 *
 * Two ways a run ends, and they differ in what the player is left looking at: `stop()` clears the
 * counter (the player pressed STOP, or the budget ran out — the run is over), while `halt()` keeps
 * it (a lost connection cut the run short; the spins are still owed, and the shell shows them so
 * the player can resume).
 *
 * Sequential by construction: it awaits each round (incl. its bonus drain) before the next, so
 * there is never more than one round in flight. Pure over injected deps — unit-testable.
 */
export interface AutoplayDeps {
  /** The action to auto-spin (e.g. an active ante feature, else 'spin'). Read fresh each round. */
  resolveAction(): string;
  /** Affordability gate for the action (the host's ensureAffordable — may surface a modal). */
  canAfford(action: string): boolean;
  /** Play one full round (trigger + any bonus drain). Resolves when the round + animation finish. */
  playRound(action: string): Promise<void>;
  /** Push the autoplay readout to the shell (active + remaining). */
  onState(state: { active: boolean; remaining: number }): void;
}

export interface Autoplay {
  /** Begin an autoplay run of `count` rounds (no-op if already running or count ≤ 0). Also how a
   *  halted run RESUMES: the shell sends the preserved count back (`start(remaining)`). */
  start(count: number): void;
  /** Stop the run and clear the counter — the player pressed STOP, or the budget ran out. */
  stop(): void;
  /**
   * Halt the run but KEEP the counter: the run was cut short by something that isn't the player and
   * isn't the budget — a lost connection, a failed round. The player then sees how many spins were
   * left and can resume them (`start(remaining)`), which is what a certification lab means by
   * "autoplay stops, and after reconnection the counter is displayed correctly".
   */
  halt(): void;
  readonly active: boolean;
  readonly remaining: number;
}

export function createAutoplayLoop(deps: AutoplayDeps): Autoplay {
  let active = false;
  let remaining = 0;
  let running = false; // guards against a second concurrent loop

  const stop = (): void => {
    if (!active && remaining === 0) return;
    active = false;
    remaining = 0;
    deps.onState({ active: false, remaining: 0 });
  };

  const halt = (): void => {
    if (!active) return; // nothing running — nothing to preserve
    active = false;
    deps.onState({ active: false, remaining });
  };

  async function loop(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (active && remaining > 0) {
        const action = deps.resolveAction();
        if (!deps.canAfford(action)) { stop(); return; }
        // Decrement at spin START (so the spin in flight is `total − remaining`), then play it out.
        remaining -= 1;
        deps.onState({ active: true, remaining });
        try {
          await deps.playRound(action);
        } catch {
          // The round failed (the host surfaces its own message, if any is due). Halt rather than
          // stop: a connection blip must not eat the spins the player still has coming.
          halt();
          return;
        }
      }
      if (active) stop(); // ran the budget out
    } finally {
      running = false;
    }
  }

  return {
    start(count: number): void {
      if (active || running || count <= 0) return;
      active = true;
      remaining = count;
      deps.onState({ active: true, remaining });
      void loop();
    },
    stop,
    halt,
    get active() { return active; },
    get remaining() { return remaining; },
  };
}
