import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { createIdeClient, useSlot } from '../src/index';

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
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => <span>reel card</span>);

    render(<Host ctx={ctx} />);
    expect(await screen.findByText('reel card')).toBeTruthy();
  });

  it('is reversible — unregistering removes it', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    const dispose = ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => (
      <span>x</span>
    ));
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    dispose();
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('keeps slots apart by name', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    ctx.slots.register({ name: 'sidebar.item', key: 'b' }, () => null);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    expect(ctx.slots.list('sidebar.item')).toHaveLength(1);
  });

  it('replaces a registration with the same key instead of duplicating it', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
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
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
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
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    const dispose = ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('a stale disposer from a replaced registration does not evict the replacement', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
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
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    const { unmount } = render(<Host ctx={ctx} />);
    unmount();
    // Registering after unmount must not touch unmounted React state.
    expect(() =>
      ctx.slots.register({ name: 'composition.card', key: 'late' }, () => null),
    ).not.toThrow();
  });
});
