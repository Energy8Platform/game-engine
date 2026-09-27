import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import { diagnostic, type GameCompositionRow, type ServerMessage } from '@energy8engine/contracts';
import { CompositionScreen, createIdeClient, useEditorDiagnostics } from '../src/index';

/** The `workspace` plugin's boot GET must not reach the real `fetch` (jsdom has no host to answer, and the failure would land in `connection.diagnostics`); it never answers here. */
const fetchFn: typeof fetch = () => new Promise(() => {});

const SCHEMA = JSON.parse(
  JSON.stringify(
    Schema.object({
      speed: Schema.number().min(1).max(20).default(8).description('reel speed'),
    }).toJSON(),
  ),
);

async function harness(fetchImpl: typeof fetch = fetchFn) {
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
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    fetchFn: fetchImpl,
  });
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
    fireEvent.change(screen.getByLabelText('speed'), { target: { value: '3' } });
    expect(JSON.parse(sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('renders no iframe — the game lives in the Preview document now, not here', async () => {
    const { ctx } = await harness();
    render(<CompositionScreen ctx={ctx} />);
    expect(screen.queryByTitle('game preview')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
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

/**
 * The GAME's rows, Task 3 of the hot-fork slice: a row whose package
 * declared a schema gets the SAME form the editor's rows use (badge
 * included), submitted through `ctx.gameComposition.update`; a row
 * without one stays name + layer; a cold row says so.
 */
describe('CompositionScreen — game rows', () => {
  const RENDERER_SCHEMA = JSON.parse(
    JSON.stringify(
      Schema.object({
        width: Schema.natural()
          .description('canvas width, px')
          .extra('extra', { applies: 'restart' }),
        height: Schema.natural().description('canvas height, px'),
      }).toJSON(),
    ),
  );

  function gameRow(overrides: Partial<GameCompositionRow>): GameCompositionRow {
    return {
      id: 'x1',
      name: '@energy8engine/x',
      config: {},
      from: 'patch',
      runtimeUrl: null,
      schema: null,
      hot: true,
      ...overrides,
    };
  }

  it('a row with a schema renders the form; one without stays name + layer', async () => {
    const { ctx } = await harness();
    render(
      <CompositionScreen
        ctx={ctx}
        rows={[
          gameRow({ id: 'renderer1', schema: RENDERER_SCHEMA, config: { width: 1280 } }),
          gameRow({ id: 'boot1', name: '@energy8engine/boot', from: 'bundle:e8-base' }),
        ]}
      />,
    );
    expect(screen.getByLabelText('width')).toHaveValue(1280);
    expect(screen.getByTestId('row-boot1').querySelector('input')).toBeNull();
    expect(screen.getByTestId('row-boot1')).toHaveTextContent('e8-base');
  });

  it('a restart badge sits on renderer1.width, not on height', async () => {
    const { ctx } = await harness();
    render(
      <CompositionScreen
        ctx={ctx}
        rows={[gameRow({ id: 'renderer1', schema: RENDERER_SCHEMA })]}
      />,
    );
    const badges = screen.getAllByText('restart');
    expect(badges).toHaveLength(1);
    expect(badges[0].parentElement).toContainElement(screen.getByLabelText('width'));
  });

  it('a cold row wears a cold badge; a hot one does not', async () => {
    const { ctx } = await harness();
    render(
      <CompositionScreen
        ctx={ctx}
        rows={[gameRow({ id: 'renderer1', hot: false }), gameRow({ id: 'reels1', hot: true })]}
      />,
    );
    expect(screen.getByTestId('row-renderer1-cold')).toHaveTextContent('cold');
    expect(screen.queryByTestId('row-reels1-cold')).toBeNull();
  });

  it('an edit submits the user’s object with one key replaced — no defaults filled in', async () => {
    const puts: { url: string; body: unknown }[] = [];
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ rows: [], reload: true, diagnostics: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch);
    render(
      <CompositionScreen
        ctx={ctx}
        rows={[gameRow({ id: 'renderer1', schema: RENDERER_SCHEMA, config: { width: 1280 } })]}
      />,
    );
    const width = screen.getByLabelText('width');
    // Three keystrokes, one PUT: a game row commits on blur (review ruling 2).
    for (const text of ['5', '50', '500']) fireEvent.change(width, { target: { value: text } });
    expect(puts).toHaveLength(0);
    fireEvent.blur(width);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/composition/rows/renderer1');
    // `height` has no value and gains none: the patch row is replaced by
    // exactly this object.
    expect(puts[0].body).toEqual({ config: { width: 500 } });
  });
});
