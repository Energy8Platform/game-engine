import { describe, expect, it, vi } from 'vitest';
import type { CompositionRow, ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient } from '../src/index';

function row(over: Partial<CompositionRow> = {}): CompositionRow {
  return {
    id: 'a:probe1',
    name: 'probe-plugin',
    disabled: false,
    state: 2,
    config: {},
    schema: null,
    hot: true,
    clientUrl: '/plugin-client/a:probe1',
    clientInject: [],
    ...over,
  };
}

/** What a half contributes in these tests: one document on the shell, keyed so `list('shell.document')` finds it. */
type DocMeta = { name: string; key: string; title: string };
const DOC: DocMeta = { name: 'shell.document', key: 'from-a-plugin', title: 'From a plugin' };

function snapshotWith(clientUrl: string | null, clientInject: string[] = []): Snapshot {
  return { rows: [row({ clientUrl, clientInject })], diagnostics: [] };
}

// `createIdeClient` is async (Task 8, Ruling 2), so this harness must be too
// — every caller awaits the fiber reaching ACTIVE before touching
// `ctx.connection` or `ctx.modules`. `readyState: 1` (OPEN) is required by
// `WebSocketLike` (Task 8) even though these tests never exercise sending —
// shaped like the fake socket in tests/connection.test.ts, not the brief's
// (which omits it and fails to typecheck).
//
// `fetchFn` is stubbed for `game-composition`, which fetches `/api/composition`
// at boot: jsdom has no host to answer it, and a real (failing) fetch would
// leave an unrelated diagnostic in that service's own list and a pending
// promise in every test here. `composition` (a service beyond `slots`) is
// what the inject tests below actually reach for, so it has to answer.
async function harness(
  importModule: (url: string) => Promise<unknown>,
  rows: unknown[] = [{ id: 'boot1' }],
) {
  const listeners: ((event: any) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    importModule,
    fetchFn: (async () =>
      new Response(JSON.stringify({ rows, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
  const push = (message: ServerMessage) => {
    for (const listener of listeners) listener({ data: JSON.stringify(message) });
  };
  return { ctx, push };
}

describe('modules', () => {
  it('imports a client half once the snapshot mentions it and applies it', async () => {
    const apply = vi.fn();
    const importModule = vi.fn(async () => ({ apply }));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    expect(importModule).toHaveBeenCalledWith('/plugin-client/a:probe1');
    await vi.waitFor(() => expect(ctx.modules.loaded()).toEqual(['a:probe1']));
  });

  it('does not import the same half twice across snapshots', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));
  });

  it('skips rows with no client half', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith(null) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(importModule).not.toHaveBeenCalled();
  });

  // Ruling (Task 10, pre-dispatch): the brief's own version of this test
  // polls `ctx.connection.diagnostics` and would pass even if the failure
  // were recorded by assigning the field directly — which notifies no one,
  // so nothing in the UI would re-render. Asserting a subscriber actually
  // fired is what tells the two implementations apart.
  it('survives a broken client half, reports it as a diagnostic, and notifies subscribers', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('boom');
    });
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });

    // Subscribe only *after* the snapshot push, whose own notification would
    // otherwise fire the listener before the import has even rejected —
    // masking whether `report()` notifies on its own.
    const listener = vi.fn();
    ctx.connection.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(ctx.connection.diagnostics.length).toBeGreaterThan(0);
    expect(ctx.connection.diagnostics[0].message).toContain('boom');
    // An import that never happened is the one failure "check the plugin
    // client entry in its package.json" is actually about — see the
    // apply-failure test below for why the other path may not say this.
    expect(ctx.connection.diagnostics[0].fix).toContain('package.json');
  });

  // Fix round 1: a permanently-poisoned row (never releasing the claimed
  // id) was rejected — it would mean a developer who fixes a broken client
  // half never sees it load, short of a full page reload, even once the
  // host pushes a fresh snapshot. The id is released on failure instead.
  //
  // That release does let the first failure retrigger itself once, for
  // free: `ctx.connection.report()` notifies subscribers, including this
  // plugin's own sync loop, so the very first failure's notification causes
  // one immediate extra attempt. It does not cascade further — the second
  // consecutive failure produces a byte-identical `Diagnostic`, which
  // `report()`'s own identity dedupe recognises and swallows without
  // notifying, so the self-triggered retry is bounded at exactly one wasted
  // fetch. This test pins both halves of that behaviour: the bounded
  // self-retry (call #2, no snapshot needed), and the real fix — a later,
  // *explicit* snapshot still gets its own attempt instead of the row
  // being stuck.
  it('retries a failed import when a later snapshot repeats the same row', async () => {
    const importModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom')) // the push below
      .mockRejectedValueOnce(new Error('boom')) // the bounded self-retry from report()'s notify
      .mockResolvedValue({ apply() {} }); // the explicit second push, after the fix
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(2));
    expect(ctx.modules.loaded()).toEqual([]);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.modules.loaded()).toEqual(['a:probe1']));
    expect(importModule).toHaveBeenCalledTimes(3);
  });

  it('treats a client half with no apply export as loaded, not a failure', async () => {
    const importModule = vi.fn(async () => ({}));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.modules.loaded()).toEqual(['a:probe1']));

    expect(ctx.connection.diagnostics).toHaveLength(0);
  });
});

/**
 * A client half is applied through `ctx.plugin()`, not by calling
 * `half.apply(ctx)` — so it gets a cordis fiber of its own, and the
 * `e8.client.inject` its package.json declares is what decides which
 * services that fiber can see.
 *
 * The direct call gave a half exactly the services `modules` itself
 * happened to `inject`, and nothing else: a hardcoded allowlist, three
 * services wide, maintained in `modules.ts` on behalf of every plugin
 * anyone would ever write. A half reaching for anything else got cordis's
 * own `cannot get property "x" without inject` — measured, not assumed,
 * against `ctx.gameComposition` and `ctx.gameDiagnostics`, both of them
 * real, both of them composed by `createIdeClient` two lines away.
 */
describe('modules — a half declares what it needs, and gets it', () => {
  it('reaches ctx.slots when its row declares it', async () => {
    const registered: string[] = [];
    const importModule = vi.fn(async () => ({
      apply(ctx: { slots: { register: (meta: DocMeta, component: unknown) => void } }) {
        ctx.slots.register(DOC, () => null);
        registered.push('from-a-plugin');
      },
    }));
    const { ctx, push } = await harness(importModule);

    push({
      type: 'snapshot',
      snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']),
    });
    await vi.waitFor(() => expect(registered).toEqual(['from-a-plugin']));

    expect(ctx.connection.diagnostics).toHaveLength(0);
    expect(ctx.slots.list('shell.document').map((s) => s.key)).toContain('from-a-plugin');
  });

  // The claim `slots` alone cannot prove: `slots` was one of the three
  // names the old hardcoded list held, so a half reaching it would have
  // worked either way. `gameComposition` was never on that list, and this
  // is the test that fails if the inject list on the wire stops being
  // honoured.
  it('reaches a service beyond slots — one the editor never allowlisted', async () => {
    const seen: { rows: unknown[] | null }[] = [];
    const importModule = vi.fn(async () => ({
      apply(ctx: { gameComposition: { rows: unknown[] | null } }) {
        // The service itself, not a snapshot of it: the fetch behind it may
        // not have settled when this half applies, and what is under test
        // is that the half reached the LIVE service — the same object the
        // editor's own screens read — not that it got a value early.
        seen.push(ctx.gameComposition);
      },
    }));
    const { ctx, push } = await harness(importModule, [{ id: 'boot1' }, { id: 'reels1' }]);

    push({
      type: 'snapshot',
      snapshot: snapshotWith('/plugin-client/a:probe1', ['gameComposition']),
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await vi.waitFor(() => expect(seen[0].rows).toEqual([{ id: 'boot1' }, { id: 'reels1' }]));

    expect(ctx.connection.diagnostics).toHaveLength(0);
  });

  it('reports a half that reaches for a service it did not declare, and says where to declare it', async () => {
    const importModule = vi.fn(async () => ({
      apply(ctx: { gameComposition: { rows: unknown[] | null } }) {
        void ctx.gameComposition.rows;
      },
    }));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await vi.waitFor(() => expect(ctx.connection.diagnostics).toHaveLength(1));

    expect(ctx.connection.diagnostics[0].message).toContain('gameComposition');
    // The fix a person can act on. "check the plugin client entry in its
    // package.json" — the advice this path used to give — cannot help
    // here: the entry imported fine, and it is the inject list that is
    // short.
    expect(ctx.connection.diagnostics[0].fix).toContain('e8.client.inject');
    expect(ctx.modules.loaded()).toEqual([]);
  });

  // cordis holds a plugin PENDING until every service it injects exists,
  // and a fiber that never starts throws nothing and renders nothing —
  // the one failure a person cannot see from the screen. So it is said.
  it('says so when a declared service does not exist, instead of never starting in silence', async () => {
    const apply = vi.fn();
    const importModule = vi.fn(async () => ({ apply }));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['nosuchthing']) });
    await vi.waitFor(() => expect(ctx.connection.diagnostics).toHaveLength(1));

    expect(apply).not.toHaveBeenCalled();
    expect(ctx.connection.diagnostics[0].message).toContain('nosuchthing');
    expect(ctx.modules.loaded()).toEqual([]);
  });
});

describe('modules — settled() says when every client half has had its turn', () => {
  it('is false before any snapshot, false while an import is in flight, true after — and notifies', async () => {
    let resolve!: (module: unknown) => void;
    const importModule = vi.fn(() => new Promise<unknown>((r) => (resolve = r)));
    const { ctx, push } = await harness(importModule);
    const listener = vi.fn();
    ctx.modules.subscribe(listener);
    expect(ctx.modules.settled()).toBe(false); // nothing has been seen yet

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    expect(ctx.modules.settled()).toBe(false); // the import is in flight
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));

    listener.mockClear();
    resolve({ apply() {} });
    await vi.waitFor(() => expect(ctx.modules.settled()).toBe(true));
    expect(listener).toHaveBeenCalled();
  });

  it('a snapshot naming no client half at all settles at once', async () => {
    const { ctx, push } = await harness(vi.fn(async () => ({ apply() {} })));
    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    expect(ctx.modules.settled()).toBe(true);
  });

  it('a failed import still settles — a failure is an answer', async () => {
    const { ctx, push } = await harness(vi.fn(async () => { throw new Error('404'); }));
    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.modules.settled()).toBe(true));
  });
});

/**
 * The other half of applying through cordis: a fiber can be disposed, so a
 * row that leaves the composition — deleted from `e8.yml`, or switched off
 * with `disabled: true` — takes its plugin's contributions with it. The
 * direct `half.apply(ctx)` call had nothing to hand back, so a screen
 * outlived the row that put it there and the IDE went on rendering code
 * from a plugin the composition said was gone.
 *
 * A half registers through `ctx.effect` for this to work — cordis's own
 * contract, demonstrated by `first-slot`'s `screen-demo` plugin.
 */
describe('modules — a row that goes takes its screen with it', () => {
  const screenHalf = () => ({
    apply(ctx: {
      effect: (execute: () => () => void, label: string) => unknown;
      slots: { register: (meta: DocMeta, component: unknown) => () => void };
    }) {
      ctx.effect(() => ctx.slots.register(DOC, () => null), 'demo');
    },
  });

  it('removes a screen when the row leaves the snapshot', async () => {
    const { ctx, push } = await harness(vi.fn(async () => screenHalf()));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await vi.waitFor(() =>
      expect(ctx.slots.list('shell.document').map((s) => s.key)).toContain('from-a-plugin'),
    );

    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    await vi.waitFor(() =>
      expect(ctx.slots.list('shell.document').map((s) => s.key)).not.toContain('from-a-plugin'),
    );
    expect(ctx.modules.loaded()).toEqual([]);
  });

  it('removes a screen when the row is switched off, and brings it back when it returns', async () => {
    const { ctx, push } = await harness(vi.fn(async () => screenHalf()));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await vi.waitFor(() =>
      expect(ctx.slots.list('shell.document').map((s) => s.key)).toContain('from-a-plugin'),
    );

    push({
      type: 'snapshot',
      snapshot: { rows: [row({ disabled: true, clientInject: ['slots'] })], diagnostics: [] },
    });
    await vi.waitFor(() =>
      expect(ctx.slots.list('shell.document').map((s) => s.key)).not.toContain('from-a-plugin'),
    );

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await vi.waitFor(() =>
      expect(ctx.slots.list('shell.document').map((s) => s.key)).toContain('from-a-plugin'),
    );
  });

  /**
   * A half whose `apply` awaits something — a fetch, a nested import — is
   * still settling for as long as that takes, and every removal test above
   * uses a synchronous one, so none of them ever open this window. Held
   * open explicitly here: the half blocks on a gate the test controls, the
   * row leaves while it is blocked, and only then is the gate opened.
   */
  function gatedHalf(registerAfterAwait = true) {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let started!: () => void;
    const applying = new Promise<void>((resolve) => {
      started = resolve;
    });
    return {
      open,
      applying,
      module: {
        async apply(ctx: {
          effect: (execute: () => () => void, label: string) => unknown;
          slots: { register: (meta: DocMeta, component: unknown) => () => void };
        }) {
          started();
          await gate;
          // Registering AFTER the await is what a half awaiting a fetch
          // actually does — and it is what makes cordis REJECT a fiber
          // disposed underneath it in the meantime. A half that awaits and
          // then registers nothing takes the other exit: the fiber settles
          // without throwing, DISPOSED rather than ACTIVE, which is the
          // branch that used to announce a half had "never started". Both
          // are reachable and both are tested.
          if (!registerAfterAwait) return;
          ctx.effect(() => ctx.slots.register(DOC, () => null), 'demo');
        },
      },
    };
  }

  it('says nothing when the row leaves while its half is still settling', async () => {
    const gated = gatedHalf();
    const { ctx, push } = await harness(vi.fn(async () => gated.module));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await gated.applying;

    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    gated.open();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Nothing to fix and nobody to tell. The composition removed this row
    // on purpose; a diagnostic here would name a plugin and a remedy that
    // stopped applying the moment it went.
    expect(ctx.connection.diagnostics).toEqual([]);
    expect(ctx.modules.loaded()).toEqual([]);
    expect(ctx.slots.list('shell.document').map((s) => s.key)).not.toContain('from-a-plugin');
  });

  it('says nothing when the row is switched off while its half is still settling', async () => {
    const gated = gatedHalf();
    const { ctx, push } = await harness(vi.fn(async () => gated.module));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await gated.applying;

    push({
      type: 'snapshot',
      snapshot: { rows: [row({ disabled: true, clientInject: ['slots'] })], diagnostics: [] },
    });
    gated.open();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ctx.connection.diagnostics).toEqual([]);
    expect(ctx.modules.loaded()).toEqual([]);
  });

  it('says nothing when a half that registers nothing settles after its row has gone', async () => {
    // The other exit from the same window. This half awaits and returns,
    // so cordis has nothing to refuse it over: the fiber simply ends up
    // DISPOSED instead of ACTIVE, which is the shape that used to be read
    // as "held back waiting for a service" and reported as a half that
    // never started — about a row the composition had already removed.
    const gated = gatedHalf(false);
    const { ctx, push } = await harness(vi.fn(async () => gated.module));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await gated.applying;

    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    gated.open();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ctx.connection.diagnostics).toEqual([]);
    expect(ctx.modules.loaded()).toEqual([]);
  });

  it('says nothing when an import fails after its row has already left', async () => {
    // The third shape of the same window, one step earlier: the fetch is
    // still in flight when the row goes, and then 404s. "check the plugin
    // client entry in its package.json" is honest advice about a row that
    // still exists and useless about one that does not.
    let fail!: (error: Error) => void;
    const importModule = vi.fn(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1', ['slots']) });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));

    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    fail(new Error('404'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('never imports a half whose row is already switched off', async () => {
    const importModule = vi.fn(async () => screenHalf());
    const { push } = await harness(importModule);

    push({
      type: 'snapshot',
      snapshot: { rows: [row({ disabled: true, clientInject: ['slots'] })], diagnostics: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(importModule).not.toHaveBeenCalled();
  });
});
