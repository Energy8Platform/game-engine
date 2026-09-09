import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import { diagnostic, type ServerMessage } from '@energy8engine/contracts';
import { CompositionScreen, createIdeClient, useEditorDiagnostics } from '../src/index';

const SCHEMA = JSON.parse(
  JSON.stringify(
    Schema.object({
      speed: Schema.number().min(1).max(20).default(8).description('reel speed'),
    }).toJSON(),
  ),
);

async function harness() {
  const listeners: ((event: any) => void)[] = [];
  const sent: string[] = [];
  const socket = {
    // OPEN, matching a real WebSocket whose handshake already completed —
    // these tests exercise the screen, not the connection's own
    // not-yet-open handling (that's connection.test.ts's job).
    readyState: 1,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send(data: string) {
      sent.push(data);
    },
    close() {},
  };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
  // `act()`: a server push notifies the mounted screen's connection
  // subscription synchronously, outside any testing-library event helper —
  // the same reason the analogous notification in slots.test.tsx's "stale
  // disposer" case is wrapped, and for the same consequence if it isn't:
  // React defers a same-tick, non-`act`-wrapped update, so the assertion
  // right after `push()` would still see the pre-push render.
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
  return { ctx, push, sent };
}

describe('CompositionScreen', () => {
  it('lists the composition with each plugin as a row', async () => {
    const { ctx, push } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [
          {
            id: 'a:probe1',
            name: 'probe-plugin',
            disabled: false,
            state: 2,
            config: { speed: 8 },
            schema: SCHEMA,
            hot: true,
            clientUrl: null,
            clientInject: [],
          },
        ],
        diagnostics: [],
      },
    });
    expect(screen.getByText('probe-plugin')).toBeTruthy();
  });

  it('sends the edited config to the host', async () => {
    const { ctx, push, sent } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [
          {
            id: 'a:probe1',
            name: 'probe-plugin',
            disabled: false,
            state: 2,
            config: { speed: 8 },
            schema: SCHEMA,
            hot: true,
            clientUrl: null,
            clientInject: [],
          },
        ],
        diagnostics: [],
      },
    });
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(JSON.parse(sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('renders cards plugins contributed to composition.card', async () => {
    const { ctx, push } = await harness();
    ctx.slots.register({ name: 'composition.card', key: 'extra' }, () => <span>extra card</span>);
    render(<CompositionScreen ctx={ctx} />);
    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    expect(screen.getByText('extra card')).toBeTruthy();
  });

  it('reports a card that throws while rendering instead of taking down the screen', async () => {
    // React logs the caught error to console.error as part of its normal
    // error-boundary contract (twice, in dev builds) — expected noise from
    // deliberately throwing here, not a real failure. Silenced so the test
    // output stays readable; restored after the assertions.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { ctx, push } = await harness();
      ctx.slots.register({ name: 'composition.card', key: 'boom' }, () => {
        throw new Error('nope');
      });
      ctx.slots.register({ name: 'composition.card', key: 'ok' }, () => <span>ok card</span>);
      render(<CompositionScreen ctx={ctx} />);
      push({
        type: 'snapshot',
        snapshot: {
          rows: [
            {
              id: 'a:probe1',
              name: 'probe-plugin',
              disabled: false,
              state: 2,
              config: { speed: 8 },
              schema: SCHEMA,
              hot: true,
              clientUrl: null,
              clientInject: [],
            },
          ],
          diagnostics: [],
        },
      });

      // The rest of the screen survives: the row list, and a sibling card
      // registered under a different slot key.
      expect(screen.getByText('probe-plugin')).toBeTruthy();
      expect(screen.getByText('ok card')).toBeTruthy();

      // The crash itself is not swallowed — it reaches `ctx.connection`
      // through the same `report()` every other client-authored failure
      // uses, naming the card's slot key. It no longer renders inside this
      // screen (the editor's own diagnostics moved to `DiagnosticsPanel`'s
      // `editor` prop — see `EditorComposition`'s own comment), so this
      // checks the report reached its actual destination rather than a
      // since-removed rendering of it.
      expect(ctx.connection.diagnostics).toContainEqual(
        expect.objectContaining({ plugin: 'boom', message: expect.stringContaining('nope') }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

/**
 * `useEditorDiagnostics` used to be exercised only indirectly, through
 * `EditorComposition`'s own rendering of this same list — removing that
 * rendering (the editor's diagnostics now reach `DiagnosticsPanel` through
 * `App.tsx` instead) removed the hook's only coverage along with it, since
 * `App.tsx` has no unit tests of its own and the e2e suite never provokes
 * an editor-namespace diagnostic. These exercise the hook directly against
 * a real `createIdeClient()` and `ctx.connection.report()`, not a
 * hand-built stub: the property that matters is the whole reactive chain
 * — `report()` → `useSyncExternalStore` → a new render — not just that the
 * hook returns whatever `ctx.connection` happens to hold at call time.
 */
describe('useEditorDiagnostics', () => {
  it('reflects a report() through the real connection', async () => {
    const { ctx } = await harness();
    const { result } = renderHook(() => useEditorDiagnostics(ctx));
    expect(result.current).toEqual([]);

    act(() => {
      ctx.connection.report(diagnostic('error', 'x', 'w', 'm'));
    });

    expect(result.current.map((d) => d.message)).toEqual(['m']);
  });

  it('returns a referentially stable array across a render nothing changed', async () => {
    // `ctx.connection.diagnostics` is a getter that builds a fresh array on
    // every read (see connection.ts) — the hook's own cache exists so
    // `useSyncExternalStore`'s snapshot stays referentially stable across a
    // render that didn't follow a real change. A cache that always decided
    // "changed" would still return the right VALUES (the test above would
    // stay green) while defeating the one thing this test checks, and
    // risking the infinite-render loop `useSyncExternalStore` exists to
    // guard against.
    const { ctx } = await harness();
    const { result, rerender } = renderHook(() => useEditorDiagnostics(ctx));
    act(() => {
      ctx.connection.report(diagnostic('error', 'x', 'w', 'm'));
    });
    const settled = result.current;
    rerender();
    expect(result.current).toBe(settled);
  });
});
