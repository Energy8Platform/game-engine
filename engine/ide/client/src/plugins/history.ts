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
}

export type HistoryResult =
  | { kind: 'undo' | 'redo'; ok: true; label: string }
  | { kind: 'undo' | 'redo'; ok: false; reason: string };

export interface HistoryService {
  /** Adds a step under `key` (no-op for a write the history itself is making — see `replay`). */
  record(key: string, step: HistoryStep): void;
  undo(keys: readonly string[]): Promise<HistoryResult>;
  redo(keys: readonly string[]): Promise<HistoryResult>;
  /** Registers which data keys a tab undoes; the first matcher answering wins. Returns a disposer. */
  scope(match: (tabKey: string) => readonly string[] | undefined): () => void;
  keysFor(tabKey: string | undefined): readonly string[];
  /** Runs `write` with recording off for the writes it starts — used by value steps. */
  replay<T>(write: () => Promise<T>): Promise<T>;
  /** True while a `replay` write is in flight (services check it before recording). */
  replaying(): boolean;
  /** The last undo/redo result and when (ms), for the status line. */
  last(): { result: HistoryResult; at: number } | undefined;
  subscribe(listener: () => void): () => void;
}

export const name = 'history';

const MAX_STEPS_PER_KEY = 100;

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
  // ponytail: a plain depth counter, not a token tied to one write's promise
  // chain — a `record()` from an unrelated write that happens to overlap
  // this replay's `await` window is swallowed too, not just the ones the
  // replayed write itself causes. Fine while services only ever call
  // `history.replay` around their own single write; give the guard a token
  // per `replay()` call if that overlap ever starts dropping real edits.
  let replayDepth = 0;
  let lastEntry: { result: HistoryResult; at: number } | undefined;

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
    if (replaying()) return;
    const bucket = bucketFor(key);
    bucket.done.push({ seq: ++seq, step });
    if (bucket.done.length > MAX_STEPS_PER_KEY) bucket.done.shift();
    bucket.undone = [];
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
      const reason = kind === 'undo' ? await bestEntry.step.undo() : await bestEntry.step.redo();
      if (reason === null) {
        bucket[to].push({ seq: ++seq, step: bestEntry.step });
        result = { kind, ok: true, label: bestEntry.step.label };
      } else {
        result = { kind, ok: false, reason };
      }
    }
    lastEntry = { result, at: Date.now() };
    notify();
    return result;
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

  async function replay<T>(write: () => Promise<T>): Promise<T> {
    replayDepth++;
    try {
      return await write();
    } finally {
      replayDepth--;
    }
  }

  function replaying(): boolean {
    return replayDepth > 0;
  }

  ctx.provide('history', {
    record,
    undo: (keys) => move(keys, 'undo'),
    redo: (keys) => move(keys, 'redo'),
    scope,
    keysFor,
    replay,
    replaying,
    last: () => lastEntry,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/** A step over a whole value: compares the current value (JSON) before applying; writes through `write`. */
export function valueStep<T>(opts: {
  label: string;
  before: T;
  after: T;
  read(): T | undefined;
  write(value: T): Promise<{ error: string | null }>;
  history: HistoryService;
}): HistoryStep {
  const { label, before, after, read, write, history: historyService } = opts;

  async function apply(target: T, expected: T, verb: 'undo' | 'redo'): Promise<string | null> {
    if (JSON.stringify(read()) !== JSON.stringify(expected)) {
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
