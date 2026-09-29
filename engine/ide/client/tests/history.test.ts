import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import * as history from '../src/plugins/history';
import { valueStep, type HistoryStep } from '../src/plugins/history';
import { createIdeClient } from '../src/index';

/**
 * The service itself: no fetch, no socket — `apply()` only registers
 * closures over an in-memory `Map`, so a bare `new Context()` is enough
 * (same shape as `asset-node-types.test.ts`'s `boot()`).
 */
async function boot(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(history);
  return ctx;
}

function makeStep(label: string): HistoryStep {
  return { label, undo: async () => null, redo: async () => null };
}

describe('history', () => {
  it("undo runs the step's undo and answers ok; redo runs redo; an empty key refuses", async () => {
    const ctx = await boot();
    const undoFn = vi.fn(async () => null);
    const redoFn = vi.fn(async () => null);
    ctx.history.record('a', { label: 'move node', undo: undoFn, redo: redoFn });

    expect(await ctx.history.undo(['a'])).toEqual({ kind: 'undo', ok: true, label: 'move node' });
    expect(undoFn).toHaveBeenCalledTimes(1);

    expect(await ctx.history.redo(['a'])).toEqual({ kind: 'redo', ok: true, label: 'move node' });
    expect(redoFn).toHaveBeenCalledTimes(1);

    expect(await ctx.history.undo(['missing'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
    expect(await ctx.history.redo(['missing'])).toEqual({
      kind: 'redo',
      ok: false,
      reason: 'nothing to redo',
    });
  });

  it("a new record on a key clears that key's redo branch, not other keys'", async () => {
    const ctx = await boot();
    ctx.history.record('a', makeStep('a-first'));
    ctx.history.record('b', makeStep('b-first'));
    await ctx.history.undo(['a']);
    await ctx.history.undo(['b']);

    ctx.history.record('a', makeStep('a-second'));

    expect(await ctx.history.redo(['a'])).toEqual({
      kind: 'redo',
      ok: false,
      reason: 'nothing to redo',
    });
    expect(await ctx.history.redo(['b'])).toEqual({ kind: 'redo', ok: true, label: 'b-first' });
  });

  it('caps at 100 steps per key — the oldest drops', async () => {
    const ctx = await boot();
    for (let i = 0; i < 101; i++) ctx.history.record('a', makeStep(`s${i}`));

    const labels: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = await ctx.history.undo(['a']);
      expect(result.ok).toBe(true);
      if (result.ok) labels.push(result.label);
    }
    // s0 was pushed out; the oldest surviving step is s1, undone last.
    expect(labels[99]).toBe('s1');
    expect(await ctx.history.undo(['a'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it("a key's steps hold at most 200 MB of `bytes` between them — the oldest go first; another key's are its own", async () => {
    const ctx = await boot();
    const MB = 1024 * 1024;
    const holding = (label: string, bytes: number): HistoryStep => ({ ...makeStep(label), bytes });
    ctx.history.record('files', holding('a', 90 * MB));
    ctx.history.record('files', holding('b', 90 * MB));
    ctx.history.record('other', holding('elsewhere', 150 * MB));
    ctx.history.record('files', holding('c', 90 * MB)); // 270 MB: 'a' goes

    expect(await ctx.history.undo(['files'])).toEqual({ kind: 'undo', ok: true, label: 'c' });
    expect(await ctx.history.undo(['files'])).toEqual({ kind: 'undo', ok: true, label: 'b' });
    expect(await ctx.history.undo(['files'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
    expect(await ctx.history.undo(['other'])).toEqual({ kind: 'undo', ok: true, label: 'elsewhere' });

    // One step over the budget on its own is not kept either.
    ctx.history.record('files', holding('huge', 201 * MB));
    expect(await ctx.history.undo(['files'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it("undo takes the latest step among a tab's keys; redo replays in the reverse order", async () => {
    const ctx = await boot();
    ctx.history.record('a', makeStep('a1'));
    ctx.history.record('b', makeStep('b1'));
    ctx.history.record('a', makeStep('a2'));

    const undone = [
      await ctx.history.undo(['a', 'b']),
      await ctx.history.undo(['a', 'b']),
      await ctx.history.undo(['a', 'b']),
    ];
    expect(undone.map((r) => (r.ok ? r.label : r.reason))).toEqual(['a2', 'b1', 'a1']);

    const redone = [
      await ctx.history.redo(['a', 'b']),
      await ctx.history.redo(['a', 'b']),
      await ctx.history.redo(['a', 'b']),
    ];
    expect(redone.map((r) => (r.ok ? r.label : r.reason))).toEqual(['a1', 'b1', 'a2']);
  });

  it('a step whose undo refuses is dropped: the next undo goes to the previous step, and redo never sees it', async () => {
    const ctx = await boot();
    ctx.history.record('a', makeStep('first'));
    ctx.history.record('a', {
      label: 'second',
      undo: async () => 'cannot undo this one',
      redo: async () => null,
    });

    expect(await ctx.history.undo(['a'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'cannot undo this one',
    });
    expect(await ctx.history.undo(['a'])).toEqual({ kind: 'undo', ok: true, label: 'first' });
    expect(await ctx.history.redo(['a'])).toEqual({ kind: 'redo', ok: true, label: 'first' });
    // The refused step is gone — nothing left to redo into it.
    expect(await ctx.history.redo(['a'])).toEqual({
      kind: 'redo',
      ok: false,
      reason: 'nothing to redo',
    });
  });

  it('a step whose undo answers BUSY is KEPT, not dropped: the same step is still there for a later undo', async () => {
    const ctx = await boot();
    ctx.history.record('a', makeStep('first'));
    let busy = true;
    const undoFn = vi.fn(async () => (busy ? history.BUSY : null));
    ctx.history.record('a', { label: 'second', undo: undoFn, redo: async () => null });

    const result = await ctx.history.undo(['a']);
    expect(result).toEqual({ kind: 'undo', ok: false, reason: history.BUSY });
    expect(ctx.history.last()?.result).toEqual(result);

    // Kept: the SAME step ('second') is still on top, not 'first'.
    busy = false;
    expect(await ctx.history.undo(['a'])).toEqual({ kind: 'undo', ok: true, label: 'second' });
    expect(undoFn).toHaveBeenCalledTimes(2);
    expect(await ctx.history.undo(['a'])).toEqual({ kind: 'undo', ok: true, label: 'first' });
    expect(await ctx.history.undo(['a'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('a step whose undo() throws is dropped like a refusal, its message becomes the reason', async () => {
    const ctx = await boot();
    ctx.history.record('a', {
      label: 'boom',
      undo: async () => {
        throw new Error('kaboom');
      },
      redo: async () => null,
    });
    const listener = vi.fn();
    ctx.history.subscribe(listener);

    const result = await ctx.history.undo(['a']);

    expect(result).toEqual({ kind: 'undo', ok: false, reason: 'kaboom' });
    expect(ctx.history.last()?.result).toEqual(result);
    expect(listener).toHaveBeenCalledTimes(1);
    // Dropped exactly like an ordinary refusal — nothing left to redo into it.
    expect(await ctx.history.redo(['a'])).toEqual({
      kind: 'redo',
      ok: false,
      reason: 'nothing to redo',
    });
  });

  it('two overlapping, unawaited undo() calls take two different steps; a refusal of the first does not disturb the second', async () => {
    const ctx = await boot();
    ctx.history.record('a', makeStep('first'));
    let resolveTop!: (reason: string | null) => void;
    const topUndo = new Promise<string | null>((resolve) => {
      resolveTop = resolve;
    });
    ctx.history.record('a', { label: 'second', undo: () => topUndo, redo: async () => null });

    // Neither call is awaited before the next starts. The second waits for
    // the first to settle before it picks: the first pops 'second' (the
    // top), its refusal drops it, and only then does the second pick,
    // finding 'first' underneath.
    const callForSecond = ctx.history.undo(['a']);
    const callForFirst = ctx.history.undo(['a']);

    resolveTop('cannot undo this one');

    await expect(callForSecond).resolves.toEqual({
      kind: 'undo',
      ok: false,
      reason: 'cannot undo this one',
    });
    await expect(callForFirst).resolves.toEqual({ kind: 'undo', ok: true, label: 'first' });
  });

  it('two undos started back to back on a slow write both apply, in order — the second waits for the first write instead of answering BUSY on it', async () => {
    const ctx = await boot();
    // A service shaped like `flow`: its own write in flight counts as
    // pending until the answer lands.
    let current = 2;
    let pending = 0;
    const write = async (value: number) => {
      pending++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      current = value;
      pending--;
      return { error: null };
    };
    const step = (before: number, after: number) =>
      valueStep({
        label: `${before} → ${after}`,
        before,
        after,
        read: () => current,
        write,
        pending: () => pending > 0,
        history: ctx.history,
      });
    ctx.history.record('a', step(0, 1));
    ctx.history.record('a', step(1, 2));

    const results = await Promise.all([ctx.history.undo(['a']), ctx.history.undo(['a'])]);

    expect(results).toEqual([
      { kind: 'undo', ok: true, label: '1 → 2' },
      { kind: 'undo', ok: true, label: '0 → 1' },
    ]);
    expect(current).toBe(0);
  });

  it("a person's own write in flight still answers BUSY", async () => {
    const ctx = await boot();
    const s = valueStep({
      label: 'x',
      before: 0,
      after: 1,
      read: () => 1,
      write: async () => ({ error: null }),
      pending: () => true,
      history: ctx.history,
    });
    ctx.history.record('a', s);
    expect(await ctx.history.undo(['a'])).toEqual({ kind: 'undo', ok: false, reason: history.BUSY });
  });

  describe('valueStep', () => {
    it("undo with read() equal to 'after' writes 'before' through history.replay", async () => {
      const ctx = await boot();
      let current = 'AFTER';
      let replaying: boolean | undefined;
      const write = vi.fn(async (value: string) => {
        replaying = ctx.history.replaying();
        current = value;
        return { error: null };
      });
      const s = valueStep({
        label: 'set title',
        before: 'BEFORE',
        after: 'AFTER',
        read: () => current,
        write,
        history: ctx.history,
      });

      expect(ctx.history.replaying()).toBe(false);
      expect(await s.undo()).toBeNull();
      expect(current).toBe('BEFORE');
      expect(write).toHaveBeenCalledWith('BEFORE');
      expect(replaying).toBe(true);
    });

    it('a diverged read refuses undo without writing', async () => {
      const ctx = await boot();
      const write = vi.fn(async () => ({ error: null }));
      const s = valueStep({
        label: 'set title',
        before: 'BEFORE',
        after: 'AFTER',
        read: () => 'SOMETHING ELSE',
        write,
        history: ctx.history,
      });

      expect(await s.undo()).toBe("changed elsewhere since — can't undo");
      expect(write).not.toHaveBeenCalled();
    });

    it('a `pending` that answers true is checked before `read()` — BUSY, not diverged, and neither read nor write runs', async () => {
      const ctx = await boot();
      const read = vi.fn(() => 'AFTER');
      const write = vi.fn(async () => ({ error: null }));
      const s = valueStep({
        label: 'set title',
        before: 'BEFORE',
        after: 'AFTER',
        read,
        write,
        pending: () => true,
        history: ctx.history,
      });

      expect(await s.undo()).toBe(history.BUSY);
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("redo is symmetric: read() equal to 'before' writes 'after'; a diverged read refuses as can't redo", async () => {
      const ctx = await boot();
      let current = 'BEFORE';
      const write = vi.fn(async (value: string) => {
        current = value;
        return { error: null };
      });
      const s = valueStep({
        label: 'x',
        before: 'BEFORE',
        after: 'AFTER',
        read: () => current,
        write,
        history: ctx.history,
      });
      expect(await s.redo()).toBeNull();
      expect(current).toBe('AFTER');

      const diverged = valueStep({
        label: 'x',
        before: 'BEFORE',
        after: 'AFTER',
        read: () => 'OTHER',
        write,
        history: ctx.history,
      });
      expect(await diverged.redo()).toBe("changed elsewhere since — can't redo");
    });

    it('a write answering { error } is the reason', async () => {
      const ctx = await boot();
      const write = vi.fn(async () => ({ error: 'host refused' }));
      const s = valueStep({
        label: 'x',
        before: 'BEFORE',
        after: 'AFTER',
        read: () => 'AFTER',
        write,
        history: ctx.history,
      });
      expect(await s.undo()).toBe('host refused');
    });

    it('compares by JSON, not by reference — a structurally-equal object still counts as unchanged', async () => {
      const ctx = await boot();
      const write = vi.fn(async () => ({ error: null }));
      const s = valueStep({
        label: 'x',
        before: { grid: 3 },
        after: { grid: 4 },
        read: () => ({ grid: 4 }),
        write,
        history: ctx.history,
      });
      expect(await s.undo()).toBeNull();
      expect(write).toHaveBeenCalledWith({ grid: 3 });
    });

    it('compares independent of object key order, nested included — an echo with shuffled keys still undoes', async () => {
      const ctx = await boot();
      const write = vi.fn(async () => ({ error: null }));
      const before = { grid: 3, meta: { rev: 1, note: 'old' } };
      const after = { grid: 4, meta: { rev: 2, note: 'new' } };
      const s = valueStep({
        label: 'x',
        before,
        after,
        // The host round-tripped this through YAML/JSON: same value as
        // `after`, top-level AND nested keys in a different order.
        read: () => ({ meta: { note: 'new', rev: 2 }, grid: 4 }),
        write,
        history: ctx.history,
      });
      expect(await s.undo()).toBeNull();
      expect(write).toHaveBeenCalledWith(before);
    });

    it('treats a reordered array as an actual change — refuses', async () => {
      const ctx = await boot();
      const write = vi.fn(async () => ({ error: null }));
      // `redo` expects `read()` to equal `before`; `read()` here has the
      // same elements as `before` but reordered, same as `after`'s elements
      // reversed would be an object key shuffle — but for an array, order
      // IS the value, so this must still refuse.
      const s = valueStep({
        label: 'x',
        before: { items: [1, 2, 3] },
        after: { items: [3, 2, 1] },
        read: () => ({ items: [3, 2, 1] }),
        write,
        history: ctx.history,
      });
      expect(await s.redo()).toBe("changed elsewhere since — can't redo");
      expect(write).not.toHaveBeenCalled();
    });
  });

  describe('replay guards recording', () => {
    it("replaying() is true only during replay()'s own synchronous call to write — not across that write's await", async () => {
      const ctx = await boot();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let seen: boolean | undefined;

      expect(ctx.history.replaying()).toBe(false);
      const p = ctx.history.replay(async () => {
        seen = ctx.history.replaying();
        await gate;
        return 'done';
      });
      // What the write's own first synchronous stretch saw — where a
      // service reads it — and what anything else running during the
      // await sees.
      expect(seen).toBe(true);
      expect(ctx.history.replaying()).toBe(false);
      release();
      expect(await p).toBe('done');
      expect(ctx.history.replaying()).toBe(false);
    });

    it('a write that throws before it awaits anything still leaves replaying() false', async () => {
      const ctx = await boot();
      await expect(
        ctx.history.replay(() => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(ctx.history.replaying()).toBe(false);
    });

    it("record() keeps every step it is handed — whether a write is a replay is its service's call, made as the write starts", async () => {
      const ctx = await boot();
      await ctx.history.replay(async () => {
        await Promise.resolve();
        ctx.history.record('a', makeStep('recorded by its service'));
      });
      expect(await ctx.history.undo(['a'])).toEqual({
        kind: 'undo',
        ok: true,
        label: 'recorded by its service',
      });
    });
  });

  describe('scope', () => {
    it('keysFor answers the first matcher that answers a key; a disposed matcher no longer answers', async () => {
      const ctx = await boot();
      const disposeScene = ctx.history.scope((tabKey) =>
        tabKey === 'scene:1' ? ['scene:1'] : undefined,
      );
      ctx.history.scope((tabKey) => (tabKey.startsWith('row:') ? [tabKey] : undefined));

      expect(ctx.history.keysFor('scene:1')).toEqual(['scene:1']);
      expect(ctx.history.keysFor('row:reels1')).toEqual(['row:reels1']);
      expect(ctx.history.keysFor('nope')).toEqual([]);

      disposeScene();
      expect(ctx.history.keysFor('scene:1')).toEqual([]);
    });

    it('keysFor(undefined) is always empty', async () => {
      const ctx = await boot();
      ctx.history.scope(() => ['x']);
      expect(ctx.history.keysFor(undefined)).toEqual([]);
    });
  });

  describe('a project switch', () => {
    /**
     * The real `createIdeClient`, so `history` sees the real `workspace`
     * the way the app composes them; the socket is shared by every plugin
     * that opens one, and `switchTo` delivers the `workspace` frame the
     * host sends when the open project changes. The fetch never answers —
     * the frames alone set the workspace state.
     */
    async function client() {
      const listeners: ((event: { data: string }) => void)[] = [];
      const socket = {
        readyState: 1,
        addEventListener(type: string, listener: (event: { data: string }) => void) {
          if (type === 'message') listeners.push(listener);
        },
        send() {},
        close() {},
      };
      const fetchFn = (() => new Promise(() => {})) as unknown as typeof fetch;
      const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
      const switchTo = (active: string | null) => {
        const workspace = { projects: [], templates: [], active, previewUrl: null, diagnostics: [] };
        const data = JSON.stringify({ type: 'workspace', workspace });
        for (const listener of listeners) listener({ data });
      };
      return { ctx, switchTo };
    }

    it('empties every key, value and files alike, and last(), and notifies', async () => {
      const { ctx, switchTo } = await client();
      switchTo('a');
      ctx.history.record('scene:base_game', makeStep('scene base_game'));
      ctx.history.record('files', makeStep('remove game/spec.json'));
      ctx.history.record('files', makeStep('upload logo.png'));
      // One step on an undone stack too, and a result on the status line.
      expect(await ctx.history.undo(['files'])).toMatchObject({ ok: true });
      const listener = vi.fn();
      ctx.history.subscribe(listener);

      switchTo('b');

      expect(listener).toHaveBeenCalled();
      expect(ctx.history.last()).toBeUndefined();
      expect(await ctx.history.undo(['scene:base_game', 'files'])).toEqual({
        kind: 'undo',
        ok: false,
        reason: 'nothing to undo',
      });
      expect(await ctx.history.redo(['files'])).toEqual({
        kind: 'redo',
        ok: false,
        reason: 'nothing to redo',
      });
    });

    it('the host\'s "no project" frame between two projects is a switch too; a frame for the same project is not', async () => {
      const { ctx, switchTo } = await client();
      switchTo('a');
      ctx.history.record('flow', makeStep('flow'));
      switchTo('a');
      expect(await ctx.history.undo(['flow'])).toEqual({ kind: 'undo', ok: true, label: 'flow' });

      ctx.history.record('flow', makeStep('flow'));
      switchTo(null);
      expect(await ctx.history.undo(['flow'])).toEqual({
        kind: 'undo',
        ok: false,
        reason: 'nothing to undo',
      });
    });

    it('clear() on its own does the same', async () => {
      const ctx = await boot();
      ctx.history.record('row:reels1', makeStep('reels1 settings'));
      await ctx.history.undo(['row:reels1']);
      ctx.history.clear();
      expect(ctx.history.last()).toBeUndefined();
      expect(await ctx.history.redo(['row:reels1'])).toEqual({
        kind: 'redo',
        ok: false,
        reason: 'nothing to redo',
      });
    });
  });

  describe('last() and subscribe', () => {
    it('last() holds the latest result with a timestamp', async () => {
      const ctx = await boot();
      expect(ctx.history.last()).toBeUndefined();

      ctx.history.record('a', makeStep('x'));
      await ctx.history.undo(['a']);

      const entry = ctx.history.last();
      expect(entry?.result).toEqual({ kind: 'undo', ok: true, label: 'x' });
      expect(typeof entry?.at).toBe('number');
    });

    it('subscribe fires on record, undo and redo', async () => {
      const ctx = await boot();
      const listener = vi.fn();
      ctx.history.subscribe(listener);

      ctx.history.record('a', makeStep('x'));
      expect(listener).toHaveBeenCalledTimes(1);

      await ctx.history.undo(['a']);
      expect(listener).toHaveBeenCalledTimes(2);

      await ctx.history.redo(['a']);
      expect(listener).toHaveBeenCalledTimes(3);

      const unsubscribe = ctx.history.subscribe(() => {});
      unsubscribe();
    });
  });
});
