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
 * `hold()`/`release()` are a THIRD thing, and not an ending at all: the tab went to the background,
 * so the host freezes the ticker and no new round may start — but the player did nothing, and the
 * run must come back by itself when they return. A hold is forgotten the moment anything else ends
 * the run (`stop`, `halt`, a new `start`), so a run killed by a lost connection or a failed round
 * while the tab was hidden does not spring back to life on the way in.
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
  /** Begin an autoplay run of `count` rounds (no-op if a run is already active, or count ≤ 0).
   *  Also how a halted run RESUMES: the shell sends the preserved count back (`start(remaining)`),
   *  and how a player restarts straight after STOP, while the stopped round is still playing out. */
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
  /**
   * Hold the run for a pause the player did not ask for — the tab went to the background. Halts it
   * (counter kept) and remembers that it is owed a resume. No-op when no run is active.
   *
   * A certification lab reads "the autoplay sequence stops when the Stop button is pressed" as
   * *only* the Stop button: switching tabs must not end a run. The host still freezes everything
   * while hidden — this is what makes that freeze temporary rather than terminal.
   */
  hold(): void;
  /** Resume a run `hold()` put on ice, with the spins it still had. No-op unless a hold is
   *  outstanding — anything that ended the run in the meantime cancels it. */
  release(): void;
  readonly active: boolean;
  readonly remaining: number;
}

export function createAutoplayLoop(deps: AutoplayDeps): Autoplay {
  let active = false;
  let remaining = 0;
  let running = false; // guards against a second concurrent loop
  let held = false; // a hold() is outstanding — the tab is hidden and the run is owed a resume

  const stop = (): void => {
    held = false;
    if (!active && remaining === 0) return;
    active = false;
    remaining = 0;
    deps.onState({ active: false, remaining: 0 });
  };

  const halt = (): void => {
    held = false; // whatever is halting the run outranks a pending hold — see hold()'s doc comment
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
        if (!deps.canAfford(action)) {
          stop();
          return;
        }
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

  const start = (count: number): void => {
    if (active || count <= 0) return;
    held = false; // a run that is starting is no longer one that owes a resume
    active = true;
    remaining = count;
    deps.onState({ active: true, remaining });
    // `running` bars a SECOND loop, not a new run. After stop(), the round already in flight keeps
    // animating and the loop stays parked on `await playRound`, so `running` is still true for as
    // long as that takes — several seconds through a win. Bailing here made the restart a silent
    // no-op, and silent is what hurt: ShellController.startAutoplay has already lit the disc with
    // the chosen count, so the player saw autoplay running with a counter that never moved.
    // The parked loop re-reads `active`/`remaining` on its next turn and simply carries on with
    // the new budget — no second loop, nothing dropped.
    if (!running) void loop();
  };

  return {
    start,
    stop,
    halt,
    hold(): void {
      if (!active) return; // nothing running — nothing to hold, and nothing to bring back
      halt(); // clears `held`; we set it again below, so only a hold() ever leaves it set
      held = true;
    },
    release(): void {
      if (!held) return;
      held = false;
      start(remaining); // no-op when the remainder is gone (something retired it while hidden)
    },
    get active() {
      return active;
    },
    get remaining() {
      return remaining;
    },
  };
}
