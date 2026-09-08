/**
 * A durable record of what happened, kept apart from the live events of
 * what is shown.
 *
 * §7 of the spec draws that line and says why it is drawn early: the
 * server's result is a FACT, the animation is an INTERPRETATION of it, and
 * a step-through debugger or a flow editor needs the first without the
 * second. "Заводим сразу; задним числом такое не вставляется" — a log
 * added later is a log of everything after it was added.
 *
 * So this package holds exactly one thing per spin — what was asked, what
 * came back, and the plan it was presented with — and does nothing else
 * with it. It decides nothing, renders nothing, emits no events, and never
 * throws. Whatever wants to READ the log (an IDE panel, a replay) reads
 * `entries()`; nothing here is going to tell it something happened.
 *
 * Two properties carry the whole thing, and `tests/log.test.ts` is written
 * against them rather than against this implementation:
 *
 *  1. **Append-only, in the sense that matters.** There is no `remove`, but
 *     that is not the promise — the promise is that nobody can EDIT what
 *     was recorded. A caller holds the object it appended, and any reader
 *     holds whatever `entries()` handed back; if either of those reached
 *     the stored record, the log would be of whatever those objects later
 *     became. So a spin is copied on the way in and copied again on the way
 *     out, and neither copy shares anything mutable with the record.
 *  2. **It never throws.** A log that throws while recording a spin turns a
 *     bad result into a broken game — the log is the thing you most want
 *     working when a result is strange. Every read and every copy below is
 *     guarded, and an entry whose fields cannot even be read is still one
 *     line in the log: the spin happened, and that is the fact being
 *     recorded.
 *
 * **No timestamps.** A caller that needs one puts it on the entry it
 * appends. Stamping the clock here would make every test of this file need
 * a fake clock to say anything, and the record itself does not depend on
 * the time it was taken.
 *
 * **It is bounded, and it says how much it dropped.** The log lives in
 * memory for the life of the page and had no cap at all: a session left
 * spinning grew it until the tab did. It now keeps the most recent
 * `DEFAULT_LIMIT` spins and drops the OLDEST past that — the only sensible
 * end to drop from, since the interesting spin is almost always the one
 * that just happened. Dropping is counted and readable (`dropped()`), for
 * the same reason every other loss in this repo is named rather than
 * absorbed: a panel showing "the log" while the log has quietly forgotten
 * the first hour is a panel that lies.
 *
 * **Reading is cheap on purpose.** `entries()` used to `structuredClone`
 * every field of every entry on every call, so a panel polling an N-entry
 * log N times did N² clones. The copy that keeps a reader out of the
 * record is now made ONCE, on the way in, and then frozen — so a normal
 * read is a shallow array copy and nothing else. An entry holding
 * something freezing cannot make immutable (a `Map`, a `Set`, a `Date`, a
 * typed array, or a value that could not be cloned at all) keeps the old
 * copy-on-read path instead, so the promise below is exactly as strong as
 * it was; see `freezeDeep`.
 */
import type { PresentationStep } from '@energy8engine/contracts';

/**
 * One spin, as the log keeps it.
 *
 * `request` and `result` are `unknown` on purpose. This package has no
 * opinion about the math's envelope — `SpinResult` is contracts' business
 * — and a log that only accepted today's shape would refuse to record the
 * one spin whose shape was the problem.
 *
 * `plan` is `PresentationStep[]`, NOT `PresentationPlan`. The two are
 * different types for a real reason (see `KnownPresentationStep`'s doc in
 * `@energy8engine/contracts`), and the wider one is the right one here:
 * the step vocabulary is open, so the plan a spin was actually presented
 * with can carry a kind the engine has no name for — `reel-step`'s
 * `reelStep`, shipped from `first-slot`'s own `plugins/`. Typed against
 * the closed `PresentationPlan`, this log could not hold the plan that
 * game actually runs without a cast at every call site.
 */
export interface SpinLogEntry {
  /** What was asked of the math — a bet level, a stage, whatever the caller sent. */
  request: unknown;
  /** What came back, whole. The fact. */
  result: unknown;
  /** How it was presented. The interpretation. */
  plan: PresentationStep[];
}

export interface SpinLog {
  /**
   * Records one spin. Never throws — not on a value that cannot be copied,
   * not on an entry whose own fields throw when read, not on `null`.
   */
  append(entry: SpinLogEntry): void;
  /**
   * Every spin still held, oldest first — at most `limit` of them. What
   * comes back cannot be edited into the log: the array is this call's
   * own, and each entry is either frozen or a fresh copy (see the module
   * doc). Mutating an entry or anything nested in one therefore either
   * fails outright or reaches nothing; either way the record stands.
   */
  entries(): readonly SpinLogEntry[];
  /**
   * How many spins have been dropped off the OLD end to stay inside the
   * bound — 0 until the log is full. Cumulative; reading does not reset
   * it. A reader that shows the log needs this to say "the last 500 of
   * 900" rather than "900" or, worse, "500".
   */
  dropped(): number;
}

/**
 * How many spins the log keeps. A development session is dozens to low
 * hundreds of spins, so this holds essentially all of one, while capping
 * the memory a left-running tab can reach: `first-slot`'s own spin payload
 * (grid, lines, cascade history, reel steps, plus the plan) is a few
 * kilobytes, so a full log is single-digit megabytes rather than
 * unbounded.
 *
 * It is a bound, not a tuning knob: the `spinlog1` row takes the default
 * and exposes no config for it. `createSpinLog` accepts one so a test can
 * fill a log without writing five hundred spins.
 */
export const DEFAULT_LIMIT = 500;

export interface SpinLogOptions {
  /** Maximum spins kept. Anything below 1, or not a finite number, means `DEFAULT_LIMIT`. */
  limit?: number;
}

/**
 * A copy of `value` that shares nothing mutable with it, or `value` itself
 * when no copy can be made.
 *
 * `structuredClone`, not `JSON.parse(JSON.stringify(...))`: a spin result
 * that refers to itself is exactly the kind of odd input a log exists to
 * capture, and the JSON round-trip throws on it. `structuredClone` handles
 * cycles and does not silently drop `undefined` or reorder anything.
 *
 * It does throw on values it cannot clone at all — a function, a class
 * instance with methods, a DOM node — and the fallback there is to keep
 * the original reference. That is a deliberate trade in favour of the
 * second property above: an uncopyable field stays in the record (a log
 * that dropped it would be lying about the spin) but is NOT insulated from
 * later mutation, because there is nothing to insulate it with. Everything
 * a spin result and a presentation plan are actually made of — numbers,
 * strings, arrays, plain objects — clones.
 */
function copyOf(value: unknown): { value: unknown; cloned: boolean } {
  try {
    return { value: structuredClone(value), cloned: true };
  } catch {
    return { value, cloned: false };
  }
}

/**
 * Values `Object.freeze` cannot actually make immutable. A frozen `Map`
 * still takes `set`, a frozen `Set` still takes `add`, a frozen `Date`
 * still takes `setTime`, and a frozen typed array still takes an index
 * write — freezing seals the OBJECT's properties, not the internal state
 * these keep beside them.
 *
 * They are listed rather than assumed away because `structuredClone`
 * produces every one of them, so an entry can genuinely hold one. Nothing
 * in this repo does — a spin result arrives through `res.json()` and a
 * plan is built by a mechanic, both plain data — but "nothing does today"
 * is not a promise, and the promise this log makes has to hold for the odd
 * input it exists to capture.
 */
function isUnfreezable(value: object): boolean {
  return (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

/**
 * Freezes everything reachable from `value`, and answers whether that was
 * ENOUGH — `true` only when nothing in the subtree can still be changed.
 *
 * Called on the log's own clone, never on a caller's object: the caller's
 * is only ever reached when `copyOf` could not clone it, and `append`
 * below skips freezing entirely in that case. Freezing something the
 * caller still holds would be this log reaching back out and changing the
 * program it is recording.
 *
 * `seen` is not an optimisation. A spin result that refers to itself is
 * exactly the sort of input this log promises to survive, `structuredClone`
 * preserves the cycle, and walking one without a guard does not return.
 */
function freezeDeep(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (isUnfreezable(value)) return false;
  Object.freeze(value);
  let complete = true;
  // `structuredClone`'s output carries data properties only — no getters,
  // no proxies — so reading each one back is safe here in a way it is not
  // on a caller's object (see `read`).
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!freezeDeep((value as Record<string, unknown>)[key], seen)) complete = false;
  }
  return complete;
}

/**
 * Reads one field off an entry, guarded.
 *
 * Reading a property is not obviously a thing that can fail, which is why
 * it is worth being explicit: a getter can throw, and so can a proxy. That
 * is a different failure from "the value cannot be copied" — `copyOf`'s
 * guard is around the copy and never sees this one. `executePlan` draws
 * the same distinction between a board whose method throws and one whose
 * property lookup does, and for the same reason.
 */
function read(entry: SpinLogEntry | null | undefined, field: keyof SpinLogEntry): unknown {
  try {
    return entry?.[field];
  } catch {
    return undefined;
  }
}

/**
 * The snapshot both ends of the log go through: a fresh entry object whose
 * three fields are copies. Used on the way in (so the caller's own object
 * cannot be edited into the record) and again on the way out (so a reader's
 * cannot either).
 *
 * `plan`'s cast is the one place this file takes the caller's word. Nothing
 * here validates the plan — a log that rejected a malformed one would be
 * refusing to record the spin worth looking at most.
 */
function snapshot(entry: SpinLogEntry | null | undefined): {
  entry: SpinLogEntry;
  cloned: boolean;
} {
  const request = copyOf(read(entry, 'request'));
  const result = copyOf(read(entry, 'result'));
  const plan = copyOf(read(entry, 'plan'));
  return {
    entry: { request: request.value, result: result.value, plan: plan.value as PresentationStep[] },
    cloned: request.cloned && result.cloned && plan.cloned,
  };
}

/**
 * One stored spin: the log's own copy, plus whether that copy is now
 * genuinely immutable.
 *
 * `sealed` is what makes reading cheap. A sealed record is handed straight
 * to a reader — nothing it can do reaches the log — while an unsealed one
 * is copied again on the way out, exactly as every record used to be.
 */
interface StoredEntry {
  entry: SpinLogEntry;
  sealed: boolean;
}

/** A fresh, empty log. Holds spins in memory for the life of the page — nothing here persists to disk. */
export function createSpinLog(options: SpinLogOptions = {}): SpinLog {
  const requested = options.limit;
  const limit =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_LIMIT;

  const records: StoredEntry[] = [];
  let dropped = 0;

  return {
    append(entry) {
      const taken = snapshot(entry);
      let sealed = false;
      if (taken.cloned) {
        // Guarded like everything else here: `freezeDeep` walks a graph
        // this log did not choose the shape of, and a stack overflow on a
        // pathologically deep result must cost the seal, not the spin.
        try {
          sealed = freezeDeep(taken.entry, new WeakSet());
        } catch {
          sealed = false;
        }
      }
      records.push({ entry: taken.entry, sealed });
      // Oldest first out. `splice` rather than `shift` so a limit lowered
      // between calls cannot leave the log over its bound.
      if (records.length > limit) {
        dropped += records.splice(0, records.length - limit).length;
      }
    },
    entries() {
      return records.map((record) => (record.sealed ? record.entry : snapshot(record.entry).entry));
    },
    dropped() {
      return dropped;
    },
  };
}
