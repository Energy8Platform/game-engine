/**
 * One destination for what a running game reports going wrong, after boot.
 *
 * Before a game starts, `createGame` collects every `Diagnostic[]` a
 * producer hands back into one array and `boot` paints it. That rule stops
 * the moment the game is up: the loader, the seam resolver, the play loop,
 * the session, the mechanics registry and the bridge all keep producing
 * `Diagnostic`s, and today they have nowhere in common to land. This
 * package is that destination — a live list a game keeps for the life of
 * the page, that anything downstream (an IDE panel, a bridge forwarding to
 * one) can read and subscribe to.
 *
 * Three properties carry the whole thing, and `tests/log.test.ts` is
 * written against them rather than against this implementation:
 *
 *  1. **Tamper-proof.** `list()` is read by a panel that renders the
 *     result; `report()` is called by code whose own bug is often the
 *     reason it's reporting. Neither should be able to rewrite the record
 *     of what happened — not the array `list()` hands back, and not a
 *     `Diagnostic` reachable through it. So every diagnostic is copied on
 *     the way in and copied again on the way out; nothing stored is a
 *     reference either side still holds.
 *  2. **`report` never throws.** A diagnostic is already bad news; losing
 *     the game over the act of reporting it would be worse. Every step
 *     `report` takes — copying, bounding, notifying — is guarded, and a
 *     subscriber's own failure is caught per-listener so it costs neither
 *     the next listener its notification nor the diagnostic its place in
 *     the list.
 *  3. **Bounded, and honest about it.** A session left running accumulates
 *     diagnostics for as long as the page is open. This keeps the most
 *     recent `DEFAULT_LIMIT` and drops the OLDEST past that — the newest
 *     failure is almost always the interesting one — and counts every
 *     drop in `dropped()`. `spin-log` shipped this bound as a follow-up fix
 *     after an unbounded list grew for as long as a session stayed open;
 *     it goes in from the start here.
 *
 * **Not the same package as `spin-log`, on purpose.** The two look alike —
 * both are a bounded, copy-in/copy-out, never-throws list with a dropped
 * count — but the shape of what they hold is different enough that sharing
 * an implementation would cost one of them something:
 *
 *  - `SpinLogEntry` holds `unknown` fields — a spin's request/result/plan,
 *    arbitrary and possibly cyclic, possibly holding a `Map`/`Set`/`Date`,
 *    possibly not cloneable at all. `spin-log` earns its `structuredClone`
 *    + cycle-safe `freezeDeep` + per-field guarded reads because a value
 *    that defeats a naive copy is exactly the kind of odd spin result it
 *    exists to survive.
 *  - `Diagnostic` is closed and flat (`@energy8engine/contracts`):
 *    `severity`/`plugin`/`where`/`message`/`fix?`, all strings. A shallow
 *    `{ ...d }` is a complete, cycle-free copy every time — there is no
 *    payload here that needs `spin-log`'s machinery, and reusing it would
 *    make every report pay for a problem this data cannot have.
 *  - This service also does something `spin-log` does not at all:
 *    `subscribe`. A durable spin record is polled; a diagnostics list
 *    pushes, because a panel showing "what's wrong right now" needs to
 *    know the moment something is. That is a second, independent reason
 *    the two are not one thing wearing two names — the fan-out-survives-a-
 *    throw logic has no analogue to share in `spin-log` at all.
 *
 * If `Diagnostic` ever grows a field that is not a plain string — should
 * that happen, this call is worth revisiting.
 */
import type { Diagnostic } from '@energy8engine/contracts';

export interface DiagnosticsService {
  /** Everything reported so far, oldest first. A copy: mutating it must not reach the service. */
  list(): readonly Diagnostic[];
  /** Adds one. Never throws. Returns nothing — a reporter is not a caller that checks. */
  report(diagnostic: Diagnostic): void;
  /** Called after every `report`. Returns a disposer. */
  subscribe(listener: () => void): () => void;
  /** How many the bound has forgotten. A panel that lies about completeness is worse than none. */
  dropped(): number;
}

/**
 * How many diagnostics the service keeps. A dev session runs to dozens or
 * low hundreds of reports, so this holds essentially all of one while
 * still capping what a game left open for a long time can reach — each
 * entry is a handful of short strings, so even a full list is small.
 */
export const DEFAULT_LIMIT = 500;

export interface DiagnosticsOptions {
  /** Maximum diagnostics kept. Anything below 1, or not a finite number, means `DEFAULT_LIMIT`. */
  limit?: number;
}

/**
 * A copy of `d` that shares nothing with it. `Diagnostic` is a closed, flat
 * shape of strings (see the module doc), so a shallow spread is already a
 * complete copy — nothing nested to walk, nothing that can hold a cycle.
 */
function copy(d: Diagnostic): Diagnostic {
  return { ...d };
}

/** A fresh, empty service. Holds diagnostics in memory for the life of the page. */
export function createDiagnostics(options: DiagnosticsOptions = {}): DiagnosticsService {
  const requested = options.limit;
  const limit =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_LIMIT;

  const records: Diagnostic[] = [];
  const listeners = new Set<() => void>();
  let dropped = 0;

  return {
    list() {
      return records.map(copy);
    },
    report(diagnostic) {
      try {
        records.push(copy(diagnostic));
        if (records.length > limit) {
          dropped += records.splice(0, records.length - limit).length;
        }
      } catch {
        // Copying should not be able to fail for a genuine `Diagnostic` —
        // see the module doc — but `report` promises never to throw
        // regardless of what a caller actually hands it, so a diagnostic
        // whose fields cannot even be read is dropped rather than taking
        // the game down.
        return;
      }
      // A snapshot, not the live set: a listener that subscribes or
      // disposes itself mid-notification must not change who else hears
      // THIS report.
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A panel blowing up while rendering is that panel's failure,
          // not this service's — the diagnostic already has its place in
          // the list (above), and the next listener still gets called.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dropped() {
      return dropped;
    },
  };
}
