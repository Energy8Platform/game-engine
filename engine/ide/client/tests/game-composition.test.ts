import { describe, expect, it, vi } from 'vitest';
import { createIdeClient } from '../src/index';

/**
 * The feeder that puts the GAME's resolved rows on the composition screen
 * (Task 11's second gap). The screen itself is covered by
 * `composition-layers.test.tsx`; what is covered here is the half that
 * was missing — something actually asking the host.
 */
async function harness(fetchFn: typeof fetch) {
  const socket = {
    readyState: 1,
    addEventListener() {},
    send() {},
    close() {},
  };
  return createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    importModule: async () => ({}),
    fetchFn,
  });
}

const ROWS = [
  { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
  { id: 'reels1', name: '@energy8engine/reels', config: {}, from: 'patch' },
];

function answer(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async (url: string) => {
    // Throws rather than answering anything else: a test that silently
    // swallows a request to the wrong place stops being a test.
    if (!String(url).includes('/api/composition')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }) as unknown as typeof fetch;
}

describe('game composition feeder', () => {
  it('fetches the composition and exposes the rows the host resolved', async () => {
    const ctx = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    expect(ctx.gameComposition.rows?.map((row) => row.from)).toEqual(['bundle:e8-base', 'patch']);
    expect(ctx.gameComposition.diagnostics).toEqual([]);
  });

  it("carries the host's own project diagnostics through", async () => {
    const project = [
      { severity: 'error', plugin: 'e8-base', where: 'profile', message: 'bundle not found' },
    ];
    const ctx = await harness(answer({ rows: [], diagnostics: project }));
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toEqual(project));
  });

  it('notifies subscribers once the answer lands', async () => {
    // The fetch is resolved BY HAND, so the subscription is guaranteed to
    // be in place while the answer is still in flight. The previous
    // version of this test raced that and papered the race over with
    // `listener.mock.calls.length + (rows ? 1 : 0) > 0` — which, since the
    // preceding `waitFor` guarantees `rows` is an array and `[]` is
    // truthy, was `X + 1 > 0` for `X >= 0`: unconditionally true. Deleting
    // the notify loop from `game-composition.tsx` left it green.
    let deliver!: (res: Response) => void;
    const inFlight = new Promise<Response>((resolvePromise) => {
      deliver = resolvePromise;
    });
    const ctx = await harness((async (url: string) => {
      if (!String(url).includes('/api/composition')) throw new Error(`unexpected fetch: ${url}`);
      return inFlight;
    }) as unknown as typeof fetch);

    const listener = vi.fn();
    ctx.gameComposition.subscribe(listener);
    // Nothing has been answered yet, so nothing can have been notified.
    expect(ctx.gameComposition.rows).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    deliver(
      new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    // Once, not once-or-more: a service that notified on every await point
    // would re-render the screen for no reason, and `toHaveBeenCalled`
    // alone would not notice.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.gameComposition.rows).toHaveLength(2);
  });

  it('a host that is not there is a diagnostic on screen, not a throw', async () => {
    const ctx = await harness((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toHaveLength(1));
    expect(ctx.gameComposition.rows).toEqual([]);
    expect(ctx.gameComposition.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'composition',
      where: '/api/composition',
    });
    expect(ctx.gameComposition.diagnostics[0].message).toContain('Failed to fetch');
  });

  it('a non-2xx is a diagnostic naming the status', async () => {
    const ctx = await harness(answer({}, { status: 500 }));
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toHaveLength(1));
    expect(ctx.gameComposition.diagnostics[0].message).toContain('500');
  });

  it('a 200 with the wrong shape is a diagnostic, not an undefined row list', async () => {
    const ctx = await harness(answer({ rows: 5 }));
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toHaveLength(1));
    expect(ctx.gameComposition.rows).toEqual([]);
    expect(ctx.gameComposition.diagnostics[0].message).toContain('"rows"');
  });

  // The fetch failure must NOT land in the editor's diagnostics channel:
  // `EditorComposition` resolves that array's `plugin` against the
  // editor's own rows, and a game-composition failure labelled with an
  // unrelated editor row is exactly the namespace conflation Task 10
  // separated the two channels to prevent.
  it('keeps its failures out of the editor diagnostics channel', async () => {
    const ctx = await harness((async () => {
      throw new Error('nope');
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toHaveLength(1));

    // A sentinel through the editor's own channel, so this assertion can
    // actually fail. `expect(ctx.connection.diagnostics).toEqual([])` on
    // its own could not: nothing in this harness ever pushes to those
    // backing arrays, so it was green whatever `game-composition` did with
    // its failure. Reporting one editor diagnostic and asserting the array
    // holds exactly that one is the same claim, made falsifiable — route
    // the fetch failure into `connection` and this test goes red.
    const editorSide = {
      severity: 'warning' as const,
      plugin: 'editor-row',
      where: 'test',
      message: 'sentinel',
    };
    ctx.connection.report(editorSide);
    expect(ctx.connection.diagnostics).toEqual([editorSide]);
  });
});
