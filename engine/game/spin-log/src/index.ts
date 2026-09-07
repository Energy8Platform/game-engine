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
   * Every spin recorded so far, oldest first. A copy: mutating what comes
   * back — the array, an entry, or anything nested inside one — does not
   * reach the log.
   */
  entries(): readonly SpinLogEntry[];
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
function copyOf(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
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
function snapshot(entry: SpinLogEntry | null | undefined): SpinLogEntry {
  return {
    request: copyOf(read(entry, 'request')),
    result: copyOf(read(entry, 'result')),
    plan: copyOf(read(entry, 'plan')) as PresentationStep[],
  };
}

/** A fresh, empty log. Holds spins in memory for the life of the page — nothing here persists to disk. */
export function createSpinLog(): SpinLog {
  const records: SpinLogEntry[] = [];

  return {
    append(entry) {
      records.push(snapshot(entry));
    },
    entries() {
      return records.map(snapshot);
    },
  };
}
