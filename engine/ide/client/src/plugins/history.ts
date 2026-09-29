import type { Context } from 'cordis';

/**
 * In-memory undo/redo, keyed by data key (`scene:<id>`, `flow`, `symbols`,
 * `row:<id>`, `files`, …). Each service that owns a write records one
 * `HistoryStep` per accepted write; a tab asks `keysFor` its own key(s) and
 * calls `undo`/`redo` with them — see the design doc, §2–§3.
 *
 * Steps live per key in two stacks, `done` and `undone`, each holding
 * `{ seq, step }`. `seq` comes from one counter shared by every key, bumped
 * on every record AND every successful undo/redo (not just on record) — an
 * entry's `seq` is "when this was last touched", so "the latest among
 * several keys' tops" (§3) is the same comparison for undo and redo alike:
 * whichever of the candidate keys' top entries has the highest `seq`.
 *
 * Every key empties when the open project changes (`clear`): two projects
 * made from one template share paths and keys, so a step recorded in one
 * would otherwise write into — or delete from — the other.
 */
declare module 'cordis' {
  interface Context {
    history: HistoryService;
  }
}

/** One undoable change: how to take it back and how to make it again. Each answers `null` when applied, or why not. */
export interface HistoryStep {
  label: string;
  undo(): Promise<string | null>;
  redo(): Promise<string | null>;
  /** File bytes the step holds on to (the Explorer's removes and uploads) — counted against its key's `MAX_BYTES_PER_KEY`. */
  bytes?: number;
}

export type HistoryResult =
  | { kind: 'undo' | 'redo'; ok: true; label: string }
  | { kind: 'undo' | 'redo'; ok: false; reason: string };

/**
 * The one refusal reason `move()` treats specially: the step it was about
 * to apply stays exactly where it was (same `seq`, same stack) rather than
 * being dropped, so a later undo/redo can still take it once the write it
 * collided with has settled. Every other refusal (a step genuinely
 * diverged, or refused its own way) drops the step, same as always — the
 * data really did change elsewhere and there is nothing to retry.
 */
export const BUSY = 'a save is still in flight — try again';

export interface HistoryService {
  /** Adds a step under `key`. A service skips this for its own write that `replay` started — see `replaying`. */
  record(key: string, step: HistoryStep): void;
  /** One at a time: a call made while another undo/redo is still applying waits for it to settle first. */
  undo(keys: readonly string[]): Promise<HistoryResult>;
  redo(keys: readonly string[]): Promise<HistoryResult>;
  /** Registers which data keys a tab undoes; the first matcher answering wins. Returns a disposer. */
  scope(match: (tabKey: string) => readonly string[] | undefined): () => void;
  keysFor(tabKey: string | undefined): readonly string[];
  /** Calls `write` with `replaying()` true for that one synchronous call — used by value steps. */
  replay<T>(write: () => Promise<T>): Promise<T>;
  /**
   * True only while `replay` is making its synchronous call to `write`. A
   * service reads it synchronously as its own write starts and, if it was
   * true, does not record that write — a write that starts while a
   * replayed one is merely awaited is someone else's, and is recorded.
   */
  replaying(): boolean;
  /** The last undo/redo result and when (ms), for the status line. */
  last(): { result: HistoryResult; at: number } | undefined;
  /** Empties every key's stacks and `last()`. Runs on its own whenever the open project changes. */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export const name = 'history';

const MAX_STEPS_PER_KEY = 100;
/** What one key's steps may hold between them; past it the oldest go, a step over it on its own included. */
export const MAX_BYTES_PER_KEY = 200 * 1024 * 1024;

interface Entry {
  seq: number;
  step: HistoryStep;
}

interface Bucket {
  done: Entry[];
  undone: Entry[];
}

export function apply(ctx: Context): void {
  const buckets = new Map<string, Bucket>();
  const matchers: ((tabKey: string) => readonly string[] | undefined)[] = [];
  const listeners = new Set<() => void>();
  let seq = 0;
  let replayDepth = 0;
  let lastEntry: { result: HistoryResult; at: number } | undefined;
  // The undo/redo queue: a second Mod+Z pressed while the first one's write
  // is still out would otherwise see that write as pending and answer BUSY.
  // ponytail: one write that never answers holds every later undo/redo
  // behind it; give `move` a timeout if a hung request ever shows up.
  let moves: Promise<unknown> = Promise.resolve();

  function bucketFor(key: string): Bucket {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { done: [], undone: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function record(key: string, step: HistoryStep): void {
    // A step over the whole budget on its own is not kept — and must not
    // evict every older step on its way out.
    if ((step.bytes ?? 0) > MAX_BYTES_PER_KEY) return;
    const bucket = bucketFor(key);
    bucket.done.push({ seq: ++seq, step });
    if (bucket.done.length > MAX_STEPS_PER_KEY) bucket.done.shift();
    bucket.undone = [];
    let held = bucket.done.reduce((sum, entry) => sum + (entry.step.bytes ?? 0), 0);
    while (held > MAX_BYTES_PER_KEY) held -= bucket.done.shift()!.step.bytes ?? 0;
    notify();
  }

  /** `undo` and `redo` are mirrors of each other: `from`/`to` pick which stack each reads and writes. */
  async function move(keys: readonly string[], kind: 'undo' | 'redo'): Promise<HistoryResult> {
    const from = kind === 'undo' ? 'done' : 'undone';
    const to = kind === 'undo' ? 'undone' : 'done';
    let bestKey: string | undefined;
    let bestEntry: Entry | undefined;
    for (const key of keys) {
      const top = buckets.get(key)?.[from].at(-1);
      if (top && (!bestEntry || top.seq > bestEntry.seq)) {
        bestKey = key;
        bestEntry = top;
      }
    }
    let result: HistoryResult;
    if (!bestEntry || bestKey === undefined) {
      result = { kind, ok: false, reason: `nothing to ${kind}` };
    } else {
      const bucket = buckets.get(bestKey)!;
      bucket[from].pop();
      let reason: string | null;
      try {
        reason = kind === 'undo' ? await bestEntry.step.undo() : await bestEntry.step.redo();
      } catch (error) {
        // A throw is a refusal like any other — the step is dropped the
        // same way a returned reason drops it, just with the message as
        // the reason instead of the step's own words.
        reason = error instanceof Error ? error.message : String(error);
      }
      if (reason === null) {
        bucket[to].push({ seq: ++seq, step: bestEntry.step });
        result = { kind, ok: true, label: bestEntry.step.label };
      } else if (reason === BUSY) {
        // Put it back exactly as it was — a write still in flight is not
        // "changed elsewhere", it is "ask again in a moment".
        bucket[from].push(bestEntry);
        result = { kind, ok: false, reason: BUSY };
      } else {
        result = { kind, ok: false, reason };
      }
    }
    lastEntry = { result, at: Date.now() };
    notify();
    return result;
  }

  function queued(keys: readonly string[], kind: 'undo' | 'redo'): Promise<HistoryResult> {
    const run = moves.then(() => move(keys, kind));
    // A listener that throws must not jam every undo/redo after it.
    moves = run.catch(() => {});
    return run;
  }

  function clear(): void {
    buckets.clear();
    lastEntry = undefined;
    notify();
  }

  function scope(match: (tabKey: string) => readonly string[] | undefined): () => void {
    matchers.push(match);
    return () => {
      const i = matchers.indexOf(match);
      if (i !== -1) matchers.splice(i, 1);
    };
  }

  function keysFor(tabKey: string | undefined): readonly string[] {
    if (tabKey === undefined) return [];
    for (const match of matchers) {
      const keys = match(tabKey);
      if (keys !== undefined) return keys;
    }
    return [];
  }

  // `async` so a write that throws before its first await is a rejection
  // too; the call itself still runs synchronously, inside the count.
  async function replay<T>(write: () => Promise<T>): Promise<T> {
    replayDepth++;
    let written: Promise<T>;
    try {
      written = write();
    } finally {
      replayDepth--;
    }
    return written;
  }

  function replaying(): boolean {
    return replayDepth > 0;
  }

  // Reached through `ctx.inject`, not a static `inject`: nothing else here
  // needs `workspace`, and a context without one (this plugin's own tests)
  // still gets a history — one that never clears on its own.
  ctx.inject(['workspace'], (c: Context) => {
    // `undefined` until the first answer — that one is not a switch.
    let active = c.workspace.state()?.active;
    c.effect(
      () =>
        c.workspace.subscribe(() => {
          const next = c.workspace.state()?.active;
          if (active !== undefined && next !== active) clear();
          active = next;
        }),
      'history:project-switch',
    );
  });

  ctx.provide('history', {
    record,
    undo: (keys) => queued(keys, 'undo'),
    redo: (keys) => queued(keys, 'redo'),
    scope,
    keysFor,
    replay,
    replaying,
    last: () => lastEntry,
    clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/**
 * `JSON.stringify` with every object's keys sorted before serializing, so
 * two values that differ only in key order compare equal — the host
 * round-trips documents through YAML/JSON, and an echo of the person's own
 * write is not guaranteed to come back with the same key order it went out
 * with. Arrays keep their order: position is meaning there, not the
 * incidental artifact object key order is. `undefined` object members are
 * dropped, matching `JSON.stringify`'s own behavior, so the two stay
 * interchangeable for anything already relying on that.
 */
function stableStringify(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v) ?? 'null').join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A step over a whole value: compares the current value (JSON, key order
 * ignored) before applying; writes through `write`.
 *
 * `pending`, when given, is checked BEFORE the comparison: a service whose
 * write is still in flight answers `true` from it rather than making
 * `read()` lie about the current value — `BUSY` distinguishes "ask again in
 * a moment" from "changed elsewhere", and `move()` keeps a `BUSY` step
 * instead of dropping it (see `BUSY`'s own doc comment).
 */
export function valueStep<T>(opts: {
  label: string;
  before: T;
  after: T;
  read(): T | undefined;
  write(value: T): Promise<{ error: string | null }>;
  history: HistoryService;
  pending?(): boolean;
}): HistoryStep {
  const { label, before, after, read, write, history: historyService, pending } = opts;

  async function apply(target: T, expected: T, verb: 'undo' | 'redo'): Promise<string | null> {
    if (pending?.()) return BUSY;
    if (stableStringify(read()) !== stableStringify(expected)) {
      return `changed elsewhere since — can't ${verb}`;
    }
    const { error } = await historyService.replay(() => write(target));
    return error;
  }

  return {
    label,
    undo: () => apply(before, after, 'undo'),
    redo: () => apply(after, before, 'redo'),
  };
}
