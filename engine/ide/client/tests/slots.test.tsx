import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import { createIdeClient, useSlot } from '../src/index';
import * as slotsPlugin from '../src/plugins/slots';

/** The `workspace` plugin's boot GET must not reach the real `fetch` (jsdom has no host to answer, and the failure would land in `connection.diagnostics`); it never answers here. */
const fetchFn: typeof fetch = () => new Promise(() => {});

// `createIdeClient` is async (Task 8, Ruling 2) — cordis applies a plugin
// through a Fiber that is not guaranteed ACTIVE by the time `ctx.plugin()`
// returns, so every call here awaits it. `readyState: 1` (OPEN) is required
// by `WebSocketLike` (Task 8) even though these tests never exercise the
// connection itself — shaped like the fake socket in tests/connection.test.ts.
function fakeSocket() {
  return { readyState: 1, addEventListener() {}, send() {}, close() {} };
}

function Host({ ctx }: { ctx: Context }) {
  const entries = useSlot(ctx, 'composition.card');
  return (
    <div>
      {entries.map((entry) => (
        <entry.component key={entry.key} />
      ))}
    </div>
  );
}

describe('slots', () => {
  it('renders what a plugin registered', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => <span>reel card</span>);

    render(<Host ctx={ctx} />);
    expect(await screen.findByText('reel card')).toBeTruthy();
  });

  it('is reversible — unregistering removes it', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    const dispose = ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => (
      <span>x</span>
    ));
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    dispose();
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('keeps slots apart by name', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    ctx.slots.register({ name: 'sidebar.item', key: 'b' }, () => null);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    expect(ctx.slots.list('sidebar.item')).toHaveLength(1);
  });

  it('replaces a registration with the same key instead of duplicating it', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>first</span>);
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>second</span>);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
  });

  // Task 8, Step 5: the replace above used to be entirely silent — the
  // same last-writer-wins defect this branch already found and fixed
  // twice elsewhere (spin-parser's `NamedCollection`, play-loop/
  // game-runtime's `BoardStepRegistry`/`MechanicsService`). The policy
  // here stays a replace (see the "stale disposer" test below, which
  // depends on the second registration winning) — only the silence is
  // fixed: a collision is now reported through `ctx.connection`, the same
  // outlet `CardBoundary` already uses for a crashed card.
  it('reports a collision through ctx.connection instead of swapping the key in silence', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>first</span>);
    expect(ctx.connection.diagnostics).toHaveLength(0);

    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>second</span>);

    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.diagnostics[0]).toMatchObject({
      severity: 'warning',
      plugin: 'a',
      where: 'composition.card',
    });
  });

  it('does not throw when the same disposer is called twice', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    const dispose = ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('a stale disposer from a replaced registration does not evict the replacement', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    // Two registrations under the SAME name+key — the second replaces the
    // first in the map, but both disposers close over the same `id`.
    const disposeFirst = ctx.slots.register({ name: 'composition.card', key: 'a' }, () => (
      <span>first</span>
    ));
    const disposeSecond = ctx.slots.register({ name: 'composition.card', key: 'a' }, () => (
      <span>second</span>
    ));

    render(<Host ctx={ctx} />);
    expect(await screen.findByText('second')).toBeTruthy();

    // disposeFirst is stale: its registration was already replaced. Calling
    // it must not remove the live replacement that disposeSecond owns.
    // `act()` because this call notifies the mounted Host's subscription
    // synchronously, outside any testing-library event helper.
    act(() => disposeFirst());

    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.queryByText('first')).toBeNull();

    // The real owner still works.
    act(() => disposeSecond());
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('a React consumer unmounts cleanly without act() warnings when a slot updates after unmount', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    const { unmount } = render(<Host ctx={ctx} />);
    unmount();
    // Registering after unmount must not touch unmounted React state.
    expect(() =>
      ctx.slots.register({ name: 'composition.card', key: 'late' }, () => null),
    ).not.toThrow();
  });
});

/**
 * Task 4 moved `entries` off a hand-rolled `Map` onto
 * `@energy8engine/registry`, which only ever sees a flat `(key, value)`.
 * Three things stayed this file's own job rather than the collection's:
 * building the COMPOSITE key, calling `notify()` on every actual mutation,
 * and reading `connection` leniently. Every test above already passes
 * without any of the three — each goes through `createIdeClient`, which
 * always composes `connection` alongside `slots`, and each either reads
 * state through `ctx.slots.list()` directly (no subscription involved) or
 * renders AFTER registering (so a component's INITIAL state already has
 * the answer, and `notify()` never has to fire for the test to pass).
 * Verified by mutating the adapter, one property at a time, and confirming
 * each of these three is what turns red — see task-4-report.md.
 */
describe('slots — the adapter seam, not the collection', () => {
  it('keeps two different slot NAMES apart even when they share a key', async () => {
    // `key` is only unique WITHIN a slot (see `SlotMeta.key`'s own doc) —
    // the composite id is what makes that true, and every test above uses
    // a distinct key whenever it uses a distinct name, so a composite id
    // that silently dropped the name half would still pass all of them.
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    ctx.slots.register({ name: 'composition.card', key: 'shared' }, () => <span>card</span>);
    ctx.slots.register({ name: 'sidebar.item', key: 'shared' }, () => <span>item</span>);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    expect(ctx.slots.list('sidebar.item')).toHaveLength(1);
  });

  it('a mounted subscriber sees an entry added after mount, not only what existed at mount time', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket, fetchFn });
    render(<Host ctx={ctx} />);
    expect(screen.queryByText('late card')).toBeNull();
    // `act()`, same reason as the stale-disposer test above: `notify()`
    // runs the subscription synchronously, outside any testing-library
    // event helper.
    act(() => {
      ctx.slots.register({ name: 'composition.card', key: 'late' }, () => <span>late card</span>);
    });
    expect(screen.getByText('late card')).toBeTruthy();
  });

  it('registering a collision does not throw when composed without ctx.connection', async () => {
    // Every test above goes through `createIdeClient`, which always
    // composes `connection` next to `slots` — none of them can tell a
    // lenient read (`ctx.reflect.get('connection', false)`) apart from one
    // that assumes `connection` is there. This composes `slots` alone, the
    // same way `game-runtime`'s `mechanics.test.ts` composes its own
    // registry alone to prove the same thing about `ctx.diagnostics`.
    const ctx = new Context();
    await ctx.plugin(slotsPlugin);

    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    expect(() =>
      ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null),
    ).not.toThrow();
    expect(ctx.slots.list('composition.card')).toHaveLength(1);

    await ctx.fiber.dispose();
  });
});
