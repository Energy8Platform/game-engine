/**
 * Host-side autoplay loop. The shell owns the picker + confirm (a count only commits after the
 * confirm modal); it emits `autoplayStart` with the chosen count and `autoplayStop`. This driver
 * runs N rounds back-to-back through the SAME `playRound` a manual spin uses (so a triggered bonus
 * drains fully before the next auto-spin), updating the shell's autoplay readout each spin and
 * halting on Stop, on an unaffordable spin, or on a play error.
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
  /** Begin an autoplay run of `count` rounds (no-op if already running or count ≤ 0). */
  start(count: number): void;
  /** Stop the run; the in-flight round (if any) finishes, then the loop exits. */
  stop(): void;
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
          stop(); // a play error already surfaced its own modal — just halt the run
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
    get active() { return active; },
    get remaining() { return remaining; },
  };
}
