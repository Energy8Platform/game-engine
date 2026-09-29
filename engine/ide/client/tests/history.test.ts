import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import * as history from '../src/plugins/history';
import { valueStep, type HistoryStep } from '../src/plugins/history';

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

  describe('valueStep', () => {
    it("undo with read() equal to 'after' writes 'before' through history.replay", async () => {
      const ctx = await boot();
      let current = 'AFTER';
      const write = vi.fn(async (value: string) => {
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

    it("a write answering { error } is the reason", async () => {
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
  });

  describe('replay guards recording', () => {
    it('replaying() is true while a replay(write) is pending, false once it settles', async () => {
      const ctx = await boot();
      let resolvePending!: () => void;
      const pending = new Promise<void>((r) => {
        resolvePending = r;
      });

      expect(ctx.history.replaying()).toBe(false);
      const p = ctx.history.replay(async () => {
        await pending;
        return 'done';
      });
      expect(ctx.history.replaying()).toBe(true);
      resolvePending();
      await p;
      expect(ctx.history.replaying()).toBe(false);
    });

    it('a record from inside the replayed write is ignored; one made after it settles is kept', async () => {
      const ctx = await boot();
      await ctx.history.replay(async () => {
        ctx.history.record('a', makeStep('during replay'));
      });
      expect(await ctx.history.undo(['a'])).toEqual({
        kind: 'undo',
        ok: false,
        reason: 'nothing to undo',
      });

      ctx.history.record('a', makeStep('after replay'));
      expect(await ctx.history.undo(['a'])).toEqual({
        kind: 'undo',
        ok: true,
        label: 'after replay',
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
