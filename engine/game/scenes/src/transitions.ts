/**
 * Transitions between scenes — a first-wins registry of `Transition`s
 * plus the two built-ins, `cut` and `fade`. Moved verbatim from
 * `@energy8engine/stage`; only the diagnostic's `plugin` is `'scenes'`.
 */
import type { Container } from 'pixi.js';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';

/** The slice of pixi's `Ticker` a transition drives on — a hand-driven fake in tests. */
export interface TickerLike {
  add(fn: (t: { deltaMS: number }) => void): unknown;
  remove(fn: (t: { deltaMS: number }) => void): unknown;
}

export interface TransitionRun {
  /** Views leaving — visible while `run` is pending, hidden by the runtime after it. */
  from: Container[];
  /** Views arriving — made visible by the runtime before `run`. */
  to: Container[];
  /** `null` where nothing ticks (headless); a transition then finishes at once. */
  ticker: TickerLike | null;
  ms: number;
}

export interface Transition {
  id: string;
  run(t: TransitionRun): Promise<void>;
}

export interface TransitionsService {
  /** The incumbent keeps a taken id: a collision reports an error and returns a no-op. */
  register(t: Transition): () => void;
  get(id: string): Transition | undefined;
  ids(): string[];
  /** Hears every register and retract. */
  subscribe(listener: () => void): () => void;
}

export function createTransitions(report: (d: Diagnostic) => void = () => {}): TransitionsService {
  const registry = createRegistry<Transition>({ policy: 'first-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(t) {
      if (registry.get(t.id) !== undefined) {
        report(
          diagnostic(
            'error',
            'scenes',
            t.id,
            `a second transition registered as "${t.id}" — the first keeps it`,
            'give it an id of its own',
          ),
        );
        return () => {};
      }
      const off = registry.add(t.id, t);
      notify();
      return () => {
        if (registry.get(t.id) !== t) return;
        off();
        notify();
      };
    },
    get: (id) => registry.get(id),
    ids: () => [...registry.keys()],
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Resolves at once; visibility alone does the switch. */
export const cut: Transition = { id: 'cut', run: () => Promise.resolve() };

/**
 * Cross-fades alpha over `ms` on the ticker: `to` climbs 0 → 1 while
 * `from` sinks 1 → 0, and both end at 1 (hiding `from` is the runtime's
 * job). With no ticker it behaves as `cut`.
 */
export const fade: Transition = {
  id: 'fade',
  run({ from, to, ticker, ms }) {
    if (!ticker || ms <= 0) return Promise.resolve();
    for (const c of to) c.alpha = 0;
    return new Promise((resolve) => {
      let elapsed = 0;
      const step = (t: { deltaMS: number }) => {
        elapsed += t.deltaMS;
        const k = Math.min(1, elapsed / ms);
        for (const c of to) c.alpha = k;
        for (const c of from) c.alpha = 1 - k;
        if (k >= 1) {
          ticker.remove(step);
          for (const c of from) c.alpha = 1;
          resolve();
        }
      };
      ticker.add(step);
    });
  },
};
