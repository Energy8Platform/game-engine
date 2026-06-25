interface PauseDeps {
  isHidden(): boolean;
  onHidden(): void;
  onVisible(): void;
  /** Register a change listener; return an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}

/** Edge-triggers onHidden/onVisible from a visibility source. Effects (ticker/music/autoplay/scene)
 *  are supplied by the host so this stays pure + testable. */
export function createPauseController(deps: PauseDeps): { destroy(): void } {
  let paused = deps.isHidden();
  const unsub = deps.subscribe(() => {
    const hidden = deps.isHidden();
    if (hidden === paused) return;
    paused = hidden;
    if (hidden) deps.onHidden();
    else deps.onVisible();
  });
  return { destroy: () => unsub() };
}
