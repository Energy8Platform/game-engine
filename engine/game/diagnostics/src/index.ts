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
 *     **A byte-identical repeat is not a second entry.** The bound alone
 *     was not enough, because the thing that fills a list is rarely a
 *     hundred different failures — it is one COMPOSITION FACT re-reported
 *     on every spin. Measured: two plugins claiming one step kind, then
 *     ten clean successful spins, gave ten identical entries and one
 *     distinct message; at the bound the list would have been nothing but
 *     that message, every real failure evicted, and every spin would have
 *     forwarded the whole growing list to the IDE. This list carries no
 *     time and no count, so a second identical row says nothing the first
 *     does not — see `sameIdentity` below, and note that the editor's own
 *     half of the same panel (`connection.ts`) already collapses repeats
 *     by exactly these three fields. Producers may still dedupe at source
 *     when they have a better reason to (`ide-bridge` suppresses a repeat
 *     to avoid rebinding work, not just to avoid a row); this is the
 *     backstop that means none of them HAS to.
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
 *
 * **A fourth property, added after the first three were measured against a
 * real IDE: the list knows which entries this game produced.** `report`
 * puts one in; `seed` puts one in that this game was merely HANDED (today,
 * exactly one thing: the host's project diagnostics, which `createGame`
 * mirrors here so `boot` and the game's page can paint one list). `list()`
 * returns both, because a reader showing the GAME needs the whole picture;
 * `own()` returns only the reported ones, because a reader FORWARDING to
 * somewhere that already has the seeded ones must not send them twice.
 * Without the distinction the IDE rendered one project failure twice —
 * once as the project's and once, wrongly, as the game's — which is this
 * slice's own disease in a new form.
 */
import type { Diagnostic } from '@energy8engine/contracts';

export interface DiagnosticsService {
  /**
   * Everything in this game's list, oldest first — reported AND seeded (see
   * `seed`). A copy: mutating it must not reach the service.
   *
   * This is what a reader that is showing THE GAME shows: the failure
   * screen `boot` paints, the game page's own log. Both need the whole
   * picture, whoever first noticed each part of it.
   */
  list(): readonly Diagnostic[];
  /**
   * The subset of `list()` this game itself produced — everything that
   * arrived through `report`, and nothing that arrived through `seed`.
   *
   * This is what a reader that is FORWARDING somewhere else sends
   * (`@energy8engine/ide-bridge`). The distinction is not cosmetic: a
   * seeded diagnostic already has a reader of its own at the other end, and
   * forwarding it made the IDE render one project failure twice — once as
   * the project's, and once, wrongly, as the game's.
   */
  own(): readonly Diagnostic[];
  /**
   * Adds one this game produced. Never throws. Returns nothing — a
   * reporter is not a caller that checks.
   *
   * A byte-identical repeat (same `plugin`/`where`/`message`/`fix`) is
   * stored once and notifies once, however many times it is reported — see
   * the module doc's point 3. A producer re-stating one composition fact
   * on every spin is the normal case, not an abuse.
   */
  report(diagnostic: Diagnostic): void;
  /**
   * Adds one this game did NOT produce — a diagnostic it was handed by
   * something that already has its own way of telling the world.
   *
   * There is exactly one such source today: the HOST's project diagnostics,
   * which `createGame` collects off `GET /api/composition` and mirrors here
   * so `boot` and the page can paint one list. The editor already has those
   * from the same response over its own channel, so anything forwarding
   * from this service must not send them again — hence `own()` above.
   *
   * Otherwise identical to `report`: copied in, bounded the same way,
   * notifies subscribers, never throws.
   */
  seed(diagnostic: Diagnostic): void;
  /** Called after every `report` or `seed`. Returns a disposer. */
  subscribe(listener: () => void): () => void;
  /**
   * How many the bound has forgotten. A panel that lies about completeness
   * is worse than none.
   *
   * Counts drops of BOTH kinds — a seeded entry falling off the front is
   * still something this list no longer holds. A forwarder sending `own()`
   * alongside this number therefore never understates what was forgotten,
   * which is the direction that matters: overstating costs a reader a
   * sentence, understating lets it believe it has everything.
   */
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

/**
 * Whether two diagnostics are the same complaint: `plugin` + `where` +
 * `message`. The same three fields `ide/client/src/plugins/connection.ts`'s
 * own `report` keys on, and deliberately so — those two lists now sit on
 * one screen (`DiagnosticsPanel`), and two halves of one panel collapsing
 * repeats by different rules would be worse than either rule alone.
 *
 * `fix` is not part of the identity: it is advice about the complaint, not
 * part of what happened, so a producer that improves its wording should
 * update the entry rather than add a second one.
 */
function sameIdentity(a: Diagnostic, b: Diagnostic): boolean {
  return a.plugin === b.plugin && a.where === b.where && a.message === b.message;
}

/** A fresh, empty service. Holds diagnostics in memory for the life of the page. */
export function createDiagnostics(options: DiagnosticsOptions = {}): DiagnosticsService {
  const requested = options.limit;
  const limit =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_LIMIT;

  /**
   * `own` marks a record this game produced itself, as opposed to one it
   * was handed (see `DiagnosticsService.seed`). Kept beside the diagnostic
   * rather than on it: `Diagnostic` is a closed shape shared by the game,
   * the IDE and the wire, and "who put this in MY list" is a fact about
   * this service's bookkeeping, not about the failure.
   */
  const records: { diagnostic: Diagnostic; own: boolean }[] = [];
  const listeners = new Set<() => void>();
  let dropped = 0;

  const add = (diagnostic: Diagnostic, own: boolean): void => {
    try {
      const incoming = copy(diagnostic);
      // A byte-identical repeat is not a second event this list can
      // express — see `sameIdentity` above. Nothing is stored and nobody is
      // notified, so a producer that re-reports one composition fact on
      // every spin costs one entry and one notification, not N of each.
      const existing = records.find((record) => sameIdentity(record.diagnostic, incoming));
      if (existing && existing.diagnostic.fix === incoming.fix) return;
      records.push({ diagnostic: incoming, own });
      // Same identity, different `fix` — the newer wording stands, at the
      // newer position, and the older is dropped rather than left to read
      // as a second failure. Removed AFTER the push so the record just
      // added is never the one removed.
      if (existing) records.splice(records.indexOf(existing), 1);
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
  };

  return {
    list() {
      return records.map((record) => copy(record.diagnostic));
    },
    own() {
      return records.filter((record) => record.own).map((record) => copy(record.diagnostic));
    },
    report(diagnostic) {
      add(diagnostic, true);
    },
    seed(diagnostic) {
      add(diagnostic, false);
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

/**
 * Forwards every diagnostic in `list`, in order, to `service.report()`.
 *
 * The shape every post-composition producer's WRITER repeats: "I already
 * hold the `Diagnostic[]` a producer returned to me, and a service that
 * might not be composed." `service` is optional so a call site never needs
 * its own `if (service)` guard first — the same reason `report` itself
 * never throws.
 *
 * This is a convenience, not a second implementation: it does nothing
 * `records.forEach(d => service.report(d))` wouldn't, and it exists so that
 * repeating it at every writer (a plan's runner, a mechanic's post-spin
 * check, a session's per-call failure, a bridge's live rebind) is one
 * import rather than one hand-rolled loop each. See this module's own doc,
 * point 1: whoever writes here does so exactly once per diagnostic — this
 * function does not itself decide who that is.
 */
export function reportAll(
  service: Pick<DiagnosticsService, 'report'> | undefined,
  list: readonly Diagnostic[],
): void {
  if (!service) return;
  for (const d of list) service.report(d);
}
