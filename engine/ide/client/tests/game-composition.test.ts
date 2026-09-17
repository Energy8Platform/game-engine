import { describe, expect, it, vi } from 'vitest';
import { createIdeClient } from '../src/index';

/**
 * The feeder that puts the GAME's resolved rows on the composition screen
 * (Task 11's second gap). The screen itself is covered by
 * `composition-layers.test.tsx`; what is covered here is the half that
 * was missing — something actually asking the host.
 */
async function harness(fetchFn: typeof fetch) {
  const listeners: ((event: { data: string }) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    importModule: async () => ({}),
    fetchFn,
  });
  /** Push a raw frame to every listener the client registered on `/ide` (this plugin's included). */
  const push = (data: string) => {
    for (const listener of listeners) listener({ data });
  };
  return { ctx, push };
}

/** A frame `rpc.ts` broadcasts after a `PUT` — see `GameCompositionMessage`. */
function frame(rows: unknown[], reload: boolean, changed: string[] = []): string {
  return JSON.stringify({ type: 'game-composition', rows, reload, changed });
}

const ROWS = [
  { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
  { id: 'reels1', name: '@energy8engine/reels', config: {}, from: 'patch' },
];

function answer(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async (url: string) => {
    // The `workspace` plugin's own boot GET goes through the same seam; it
    // never answers here (its own suite covers it).
    if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
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
    const { ctx } = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    expect(ctx.gameComposition.rows?.map((row) => row.from)).toEqual(['bundle:e8-base', 'patch']);
    expect(ctx.gameComposition.diagnostics).toEqual([]);
  });

  it("carries the host's own project diagnostics through", async () => {
    const project = [
      { severity: 'error', plugin: 'e8-base', where: 'profile', message: 'bundle not found' },
    ];
    const { ctx } = await harness(answer({ rows: [], diagnostics: project }));
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
    const { ctx } = await harness((async (url: string) => {
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
    const { ctx } = await harness((async () => {
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
    const { ctx } = await harness(answer({}, { status: 500 }));
    await vi.waitFor(() => expect(ctx.gameComposition.diagnostics).toHaveLength(1));
    expect(ctx.gameComposition.diagnostics[0].message).toContain('500');
  });

  it('a 200 with the wrong shape is a diagnostic, not an undefined row list', async () => {
    const { ctx } = await harness(answer({ rows: 5 }));
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
    // Only the composition fetch fails; the `workspace` plugin's own boot
    // GET stays pending, so what lands in `connection` below is not its.
    const { ctx } = await harness((async (url: string) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
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

/**
 * The half Task 3 of the hot-fork slice adds: the feeder LISTENS on `/ide`
 * for the host's `game-composition` frame (sent to every socket after a
 * `PUT`), and it is the one that sends that `PUT`. `reloads` is the count
 * of frames that said `reload: true` — what `Preview` remounts on.
 */
describe('game composition feeder — frames and edits', () => {
  const CHANGED = [
    { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
    { id: 'reels1', name: '@energy8engine/reels', config: { grid: 4 }, from: 'patch' },
  ];

  it('a game-composition frame replaces the rows and notifies', async () => {
    const { ctx, push } = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    const listener = vi.fn();
    ctx.gameComposition.subscribe(listener);

    push(frame(CHANGED, false, ['reels1']));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.gameComposition.rows?.[1].config).toEqual({ grid: 4 });
  });

  it('a frame that lands before the boot GET answers is the newer fact — the GET does not overwrite it', async () => {
    let deliver!: (res: Response) => void;
    const inFlight = new Promise<Response>((resolvePromise) => {
      deliver = resolvePromise;
    });
    const { ctx, push } = await harness((async (url: string) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      return inFlight;
    }) as unknown as typeof fetch);

    push(frame(CHANGED, false, ['reels1']));
    expect(ctx.gameComposition.rows?.[1].config).toEqual({ grid: 4 });

    deliver(
      new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Let the GET settle; the rows must still be the frame's.
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.gameComposition.rows?.[1].config).toEqual({ grid: 4 });
  });

  it('ignores frames of other types and malformed data', async () => {
    const { ctx, push } = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    const listener = vi.fn();
    ctx.gameComposition.subscribe(listener);

    push(JSON.stringify({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } }));
    push('not json');
    push('null');
    push(JSON.stringify({ type: 'game-composition', rows: 5, reload: true, changed: [] }));

    expect(listener).not.toHaveBeenCalled();
    expect(ctx.gameComposition.rows).toHaveLength(2);
    expect(ctx.gameComposition.reloads).toBe(0);
  });

  it('counts reloads only on frames that say reload: true', async () => {
    const { ctx, push } = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    expect(ctx.gameComposition.reloads).toBe(0);

    push(frame(CHANGED, false, ['reels1']));
    expect(ctx.gameComposition.reloads).toBe(0);

    push(frame(CHANGED, true, ['renderer1']));
    expect(ctx.gameComposition.reloads).toBe(1);

    push(frame(CHANGED, true, ['renderer1']));
    expect(ctx.gameComposition.reloads).toBe(2);
  });

  it('update PUTs the config to the row’s route and takes the rows from the answer', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      if (init?.method === 'PUT') {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ rows: CHANGED, reload: false, diagnostics: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    const listener = vi.fn();
    ctx.gameComposition.subscribe(listener);

    const result = await ctx.gameComposition.update('reels1', { grid: 4 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/composition/rows/reels1');
    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ config: { grid: 4 } });
    expect(result).toEqual({ reload: false, diagnostics: [] });
    expect(ctx.gameComposition.rows?.[1].config).toEqual({ grid: 4 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('update returns the answer’s reload verdict without touching the counter — the frame does that', async () => {
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      const body =
        init?.method === 'PUT'
          ? { rows: CHANGED, reload: true, diagnostics: [] }
          : { rows: ROWS, diagnostics: [] };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));

    const result = await ctx.gameComposition.update('renderer1', { width: 500 });

    expect(result.reload).toBe(true);
    expect(ctx.gameComposition.reloads).toBe(0);
  });

  it('a refusal with diagnostics is returned AND reported to the connection', async () => {
    const refused = [
      { severity: 'error', plugin: 'reels1', where: 'e8.patch.yml', message: 'cannot write' },
    ];
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ diagnostics: refused }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));

    const result = await ctx.gameComposition.update('reels1', { grid: 4 });

    expect(result).toEqual({ reload: false, diagnostics: refused });
    expect(ctx.connection.diagnostics).toEqual(refused);
    // The rows the host last resolved stay: a refused write changed nothing.
    expect(ctx.gameComposition.rows?.[1].config).toEqual({});
  });

  it('a 400 that carries only an error string becomes one diagnostic naming it', async () => {
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'no row with id "nope"' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));

    const result = await ctx.gameComposition.update('nope', {});

    expect(result.reload).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'composition',
      where: '/api/composition/rows/nope',
    });
    expect(result.diagnostics[0].message).toContain('no row with id "nope"');
    expect(ctx.connection.diagnostics).toEqual(result.diagnostics);
  });

  it('a network failure on update is one diagnostic, not a throw', async () => {
    const { ctx } = await harness((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/workspace')) return new Promise<Response>(() => {});
      if (init?.method === 'PUT') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ rows: ROWS, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));

    const result = await ctx.gameComposition.update('reels1', { grid: 4 });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('Failed to fetch');
    expect(ctx.connection.diagnostics).toHaveLength(1);
  });
});

/**
 * The two fields the Scenes screen reads off the same GET (Task 3's
 * `GameCompositionResponse`): the `.spin` stages — the scene ids a game can
 * have — and the transition ids the running game reported. Frames carry
 * rows only, so both survive one.
 */
describe('game composition feeder — stages and transitions', () => {
  it('exposes the .spin stages and the transitions the GET carries', async () => {
    const { ctx, push } = await harness(
      answer({
        rows: ROWS,
        diagnostics: [],
        schema: { stages: { base_game: {}, free_spins: {} } },
        transitions: ['cut', 'fade'],
      }),
    );
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    expect(ctx.gameComposition.stages).toEqual(['base_game', 'free_spins']);
    expect(ctx.gameComposition.transitions).toEqual(['cut', 'fade']);

    push(frame([], false));
    expect(ctx.gameComposition.rows).toEqual([]);
    expect(ctx.gameComposition.stages).toEqual(['base_game', 'free_spins']);
    expect(ctx.gameComposition.transitions).toEqual(['cut', 'fade']);
  });

  it('a game-transitions frame replaces the list and notifies — the game booted after the GET', async () => {
    const { ctx, push } = await harness(answer({ rows: ROWS, diagnostics: [], transitions: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    const listener = vi.fn();
    ctx.gameComposition.subscribe(listener);

    push(JSON.stringify({ type: 'game-transitions', ids: ['cut', 'fade'] }));
    expect(ctx.gameComposition.transitions).toEqual(['cut', 'fade']);
    expect(listener).toHaveBeenCalledTimes(1);

    // Not a list of strings: ignored, the last list stands.
    push(JSON.stringify({ type: 'game-transitions', ids: 'cut' }));
    push(JSON.stringify({ type: 'game-transitions', ids: [1] }));
    expect(ctx.gameComposition.transitions).toEqual(['cut', 'fade']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('missing fields read as empty lists', async () => {
    const { ctx } = await harness(answer({ rows: ROWS, diagnostics: [] }));
    await vi.waitFor(() => expect(ctx.gameComposition.rows).toHaveLength(2));
    expect(ctx.gameComposition.stages).toEqual([]);
    expect(ctx.gameComposition.transitions).toEqual([]);
  });
});
