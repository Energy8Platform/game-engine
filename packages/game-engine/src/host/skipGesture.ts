interface SkipDeps {
  /** The skipGesture setting is on. */
  enabled(): boolean;
  /** An onSpin is currently presenting (skippable window). */
  active(): boolean;
  onSkip(): void;
  /** Max ms between the two taps. Default 300. */
  thresholdMs?: number;
}

/** Pure double-tap recognizer. The host feeds it pointer `tap(now)` (e.g. performance.now()) and
 *  supplies the enabled/active gates + the onSkip effect. */
export function createDoubleTapSkip(deps: SkipDeps): { tap(now: number): void; destroy(): void } {
  const threshold = deps.thresholdMs ?? 300;
  let last = -Infinity;
  return {
    tap(now: number): void {
      const isDouble = now - last <= threshold;
      last = isDouble ? -Infinity : now; // consume the pair so a 3rd tap starts fresh
      if (isDouble && deps.enabled() && deps.active()) deps.onSkip();
    },
    destroy(): void { last = -Infinity; },
  };
}
