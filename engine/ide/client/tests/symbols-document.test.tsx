import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SymbolsDoc } from '@energy8engine/contracts';
import { EMPTY } from '../src/shell/symbols-doc';
import {
  accept,
  boot,
  harness,
  KNOWN,
  PREVIEW_URL,
  renderDocument,
  transfer,
  TWO,
  type Answer,
} from './symbols-harness';

/**
 * The canvas iframe, with `contentWindow.postMessage` stubbed so requests
 * can be read back — same trick as `scene-document.test.tsx`'s `canvas()`:
 * the tab attaches the RPC from the iframe's ref callback, so by the time
 * `renderDocument` returns it is already attached.
 */
function canvas() {
  const iframe = screen.getByTitle('symbol canvas') as HTMLIFrameElement;
  const win = iframe.contentWindow as Window & { postMessage: ReturnType<typeof vi.fn> };
  win.postMessage = vi.fn();
  const posted = () => win.postMessage.mock.calls.map((c) => c[0]);
  const reqs = (method: string) =>
    posted()
      .filter((m) => m.type === 'e8:ide:req' && m.method === method)
      .map((m) => m.params);
  return { iframe, posted, reqs };
}

/** A frame FROM the iframe: the message event the browser would deliver to the tab's window. */
function frame(iframe: HTMLIFrameElement, event: string, payload: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'e8:ide:evt', event, payload },
      origin: PREVIEW_URL,
      source: iframe.contentWindow,
    }),
  );
}

/**
 * The Symbols document, rendered through the plugin's `shell.document`
 * registration: the list (rows, chips, ghosts, the add input, the row
 * menu), drops from the Explorer, and the status line. Every edit is
 * asserted as the `{ doc }` PUT body that went out.
 */
async function booted(routes: Parameters<typeof harness>[0] = {}, doc: SymbolsDoc | null = TWO) {
  const h = await harness({
    'GET /api/symbols': boot({ doc, known: KNOWN, diagnostics: [] }),
    'PUT /api/symbols': accept,
    ...routes,
  });
  await waitFor(() => expect(h.ctx.symbols.known()).toEqual(KNOWN));
  const docs = () => h.puts().map((b) => (b as { doc: SymbolsDoc }).doc);
  return { ...h, docs };
}

describe('SymbolsDocument', () => {
  it('draws a row per symbol with its name and state chips, ghosts for known ids not in the doc, and the live canvas', async () => {
    const { ctx } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
    renderDocument(ctx);
    expect(await screen.findByTestId('symbols-doc')).toBeTruthy();
    expect(screen.getByTestId('symbol-row-1')).toBeTruthy();
    expect(screen.getByTestId('symbol-name-1')).toHaveTextContent('cherry');
    expect(screen.getByTestId('symbol-chip-1-static')).toHaveTextContent('image');
    expect(screen.getByTestId('symbol-chip-1-idle')).toHaveTextContent('+');
    expect(screen.getByTestId('symbol-chip-1-win')).toHaveTextContent('spritesheet');
    expect(screen.queryByTestId('symbol-row-2')).toBeNull();
    expect(screen.getByTestId('symbol-ghost-2')).toHaveTextContent('lemon');
    expect(screen.queryByTestId('symbol-ghost-1')).toBeNull();
    const iframe = screen.getByTitle('symbol canvas') as HTMLIFrameElement;
    expect(iframe.src).toBe(`${PREVIEW_URL}/editor.html?symbol=`);
    expect(screen.queryByTestId('symbols-status')).toBeNull();
  });

  it('clicking a chip selects { id, state }; a row click selects its static; the picked chip is marked', async () => {
    const { ctx } = await booted();
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('symbol-chip-1-win'));
    expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'win' });
    expect(screen.getByTestId('symbol-chip-1-win')).toHaveClass('e8-symbol-chip-selected');
    expect(screen.getByTestId('symbol-row-1')).toHaveClass('e8-explorer-selected');
    fireEvent.click(screen.getByTestId('symbol-name-2'));
    expect(ctx.symbols.selected()).toEqual({ id: '2', state: 'static' });
    expect(screen.getByTestId('symbol-chip-1-win')).not.toHaveClass('e8-symbol-chip-selected');
  });

  it("a ghost's Add PUTs the doc with that symbol (name from `known`, empty-image static)", async () => {
    const { ctx, docs } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('symbol-add-2'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols.at(-1)).toEqual({
      id: '2',
      name: 'lemon',
      static: { type: 'image', props: { src: '' } },
    });
    await waitFor(() => expect(screen.queryByTestId('symbol-ghost-2')).toBeNull());
    expect(screen.getByTestId('symbol-row-2')).toBeTruthy();
  });

  it('the add input: Enter PUTs a free id and clears; an id already there is refused in the status line', async () => {
    const { ctx, docs } = await booted();
    renderDocument(ctx);
    const input = (await screen.findByTestId('symbol-add-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(docs()).toHaveLength(0);
    fireEvent.change(input, { target: { value: ' 7 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols.map((s) => s.id)).toEqual(['1', '2', '7']);
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('symbols-status')).toHaveTextContent('"1" is already a symbol');
    expect(docs()).toHaveLength(1);
    expect(input.value).toBe('1'); // kept, to be edited into a free id
  });

  it('a PUT answered 200 with error diagnostics applies the doc AND shows the first one in the status, the row marked', async () => {
    const noSrc: Diagnostic = {
      severity: 'error',
      plugin: 'symbols',
      where: 'symbols/2/static',
      message: 'image has no src',
    };
    const { ctx, docs } = await booted(
      {
        'PUT /api/symbols': (body) => ({
          body: { doc: (body as { doc: SymbolsDoc }).doc, known: KNOWN, diagnostics: [noSrc] },
        }),
      },
      { version: 1, symbols: [TWO.symbols[0]] },
    );
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('symbol-add-2'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    // The Add landed: the host wrote the `src: ''` static and said what is missing.
    expect(await screen.findByTestId('symbol-row-2')).toHaveAttribute('data-diagnostic', 'error');
    expect(screen.getByTestId('symbol-chip-2-static')).toHaveAttribute('data-diagnostic', 'error');
    expect(screen.getByTestId('symbols-status')).toHaveTextContent(
      'symbols/2/static — image has no src',
    );
    expect(ctx.symbols.doc()?.symbols.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('with no symbols.yml yet, the list is empty, every known id is a ghost, and the first add writes from EMPTY', async () => {
    const { ctx, docs } = await booted({}, null);
    renderDocument(ctx);
    expect(await screen.findByTestId('symbol-ghost-1')).toBeTruthy();
    expect(screen.getByTestId('symbol-ghost-2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('symbol-add-1'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0]).toEqual({
      ...EMPTY,
      symbols: [{ id: '1', name: 'cherry', static: { type: 'image', props: { src: '' } } }],
    });
  });

  it('a drop onto a chip sets that state through pick: a win of a looping type gets loop: false; a row is its static', async () => {
    const { ctx, docs } = await booted();
    renderDocument(ctx);
    fireEvent.drop(await screen.findByTestId('symbol-chip-2-win'), transfer('assets/coin.json'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[1].win).toEqual({
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json', loop: false },
    });
    fireEvent.drop(screen.getByTestId('symbol-chip-2-idle'), transfer('assets/coin.json'));
    await waitFor(() => expect(docs()).toHaveLength(2));
    expect(docs()[1].symbols[1].idle).toEqual({
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json' },
    });
    fireEvent.drop(screen.getByTestId('symbol-row-2'), transfer('assets/1.png'));
    await waitFor(() => expect(docs()).toHaveLength(3));
    expect(docs()[2].symbols[1].static).toEqual({ type: 'image', props: { src: 'assets/1.png' } });
    // The three writes each reduced the one before: nothing was lost.
    expect(docs()[2].symbols[1].win?.props.sheet).toBe('assets/coin.json');
    expect(docs()[2].symbols[1].idle?.props.sheet).toBe('assets/coin.json');
    expect(screen.queryByTestId('symbols-status')).toBeNull();
  });

  it('a drop onto the empty area adds a symbol from the file stem — known, numeric or any other name', async () => {
    const { ctx, docs } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
    renderDocument(ctx);
    const area = await screen.findByTestId('symbols-drop-new');
    fireEvent.drop(area, transfer('assets/symbols/2.png'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols.at(-1)).toEqual({
      id: '2',
      name: 'lemon',
      static: { type: 'image', props: { src: 'assets/symbols/2.png' } },
    });
    fireEvent.drop(area, transfer('assets/9.png'));
    await waitFor(() => expect(docs()).toHaveLength(2));
    expect(docs()[1].symbols.at(-1)).toEqual({
      id: '9',
      static: { type: 'image', props: { src: 'assets/9.png' } },
    });
    // A stem that is neither `known` nor numeric is now a legal new id too
    // — a real game's math emits symbol NAMES, and the drop-new rule
    // stopped requiring the id to already exist somewhere.
    fireEvent.drop(area, transfer('assets/ROCK.png'));
    await waitFor(() => expect(docs()).toHaveLength(3));
    expect(docs()[2].symbols.at(-1)).toEqual({
      id: 'ROCK',
      static: { type: 'image', props: { src: 'assets/ROCK.png' } },
    });
    // An id the doc already has: nothing to add, the drop lands on nothing.
    fireEvent.drop(area, transfer('assets/1.png'));
    await waitFor(() =>
      expect(screen.getByTestId('symbols-status')).toHaveTextContent('"1" is already a symbol'),
    );
    expect(docs()).toHaveLength(3);
  });

  it('a drop of a file with no node type is refused in the status line and reported', async () => {
    const { ctx, docs } = await booted();
    renderDocument(ctx);
    fireEvent.drop(await screen.findByTestId('symbol-chip-1-idle'), transfer('assets/song.mp3'));
    await waitFor(() =>
      expect(screen.getByTestId('symbols-status')).toHaveTextContent('no node type for .mp3'),
    );
    expect(docs()).toHaveLength(0);
    expect(ctx.connection.diagnostics).toEqual([
      expect.objectContaining({ plugin: 'symbols', where: 'assets/song.mp3', severity: 'warning' }),
    ]);
  });

  it('the row menu: Remove PUTs the doc without the symbol and clears its selection; Clear win drops the state', async () => {
    const { ctx, docs } = await booted();
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('symbol-chip-1-win'));
    fireEvent.click(screen.getByTestId('symbol-menu-1'));
    expect(screen.getByTestId('symbol-clear-static')).toBeTruthy();
    expect(screen.getByTestId('symbol-clear-win')).toBeTruthy();
    expect(screen.queryByTestId('symbol-clear-idle')).toBeNull(); // not there to clear
    fireEvent.click(screen.getByTestId('symbol-clear-win'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[0]).toEqual({
      id: '1',
      name: 'cherry',
      static: TWO.symbols[0].static,
    });
    expect(screen.queryByTestId('symbol-clear-win')).toBeNull(); // the menu closed
    await waitFor(() => expect(screen.getByTestId('symbol-chip-1-win')).toHaveTextContent('+'));

    fireEvent.click(screen.getByTestId('symbol-menu-1'));
    fireEvent.click(screen.getByTestId('symbol-remove'));
    await waitFor(() => expect(docs()).toHaveLength(2));
    expect(docs()[1].symbols.map((s) => s.id)).toEqual(['2']);
    expect(ctx.symbols.selected()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('symbol-row-1')).toBeNull());
    expect(screen.getByTestId('symbol-ghost-1')).toBeTruthy();
  });

  it('a refused write shows in the status line; diagnostics for symbols/<id> mark the row and the chip', async () => {
    const refusal: Diagnostic = {
      severity: 'error',
      plugin: 'symbols',
      where: 'symbols/1/win',
      message: 'props: expected string',
    };
    const warn: Diagnostic = {
      severity: 'warning',
      plugin: 'symbols',
      where: 'symbols/2',
      message: 'symbol 2 is not in game/spec.json',
    };
    const { ctx, socket } = await booted({
      'PUT /api/symbols': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    renderDocument(ctx);
    await screen.findByTestId('symbols-doc');
    act(() => socket.receive({ type: 'symbols', doc: TWO, diagnostics: [refusal, warn] }));
    expect(screen.getByTestId('symbol-row-1')).toHaveAttribute('data-diagnostic', 'error');
    expect(screen.getByTestId('symbol-chip-1-win')).toHaveAttribute('data-diagnostic', 'error');
    expect(screen.getByTestId('symbol-chip-1-static')).not.toHaveAttribute('data-diagnostic');
    expect(screen.getByTestId('symbol-row-2')).toHaveAttribute('data-diagnostic', 'warning');
    // symbols/1 must not mark symbols/10.
    act(() =>
      socket.receive({
        type: 'symbols',
        doc: { ...TWO, symbols: [...TWO.symbols, { id: '10', static: TWO.symbols[0].static }] },
        diagnostics: [refusal],
      }),
    );
    expect(screen.getByTestId('symbol-row-10')).not.toHaveAttribute('data-diagnostic');
    expect(screen.getByTestId('symbols-status')).toHaveTextContent(
      'symbols/1/win — props: expected string',
    );

    const input = screen.getByTestId('symbol-add-input');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('symbols-status')).toHaveTextContent('props: expected string'),
    );
    expect(screen.queryByTestId('symbol-row-7')).toBeNull();
  });

  it('two writes in a row each reduce the doc as it stands when their turn comes', async () => {
    let release!: (answer: Answer) => void;
    const first = new Promise<Answer>((resolve) => {
      release = resolve;
    });
    let n = 0;
    const { ctx, docs } = await booted(
      {
        'PUT /api/symbols': (body) => (++n === 1 ? first : accept(body)),
      },
      { version: 1, symbols: [TWO.symbols[0]] },
    );
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('symbol-add-2'));
    const input = screen.getByTestId('symbol-add-input');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(docs()).toHaveLength(1));
    const withTwo: SymbolsDoc = { version: 1, symbols: [TWO.symbols[0], TWO.symbols[1]] };
    release({ body: { doc: withTwo, known: KNOWN, diagnostics: [] } });
    await waitFor(() => expect(docs()).toHaveLength(2));
    expect(docs()[1].symbols.map((s) => s.id)).toEqual(['1', '2', '7']);
  });

  describe('the live canvas', () => {
    it('on ready, resends the current doc then the current selection, in that order', async () => {
      const { ctx } = await booted();
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
      renderDocument(ctx);
      const { iframe, posted } = canvas();
      const before = posted().length;
      frame(iframe, 'ready', {});
      const added = posted().slice(before);
      expect(added.map((m) => m.method)).toEqual(['replaceSymbols', 'symbol']);
      expect(added[0].params).toEqual({ doc: ctx.symbols.doc() });
      expect(added[1].params).toEqual({ id: '1', state: 'win' });
    });

    it('ready sends neither call when there is no doc and nothing selected', async () => {
      const { ctx } = await booted({}, null);
      renderDocument(ctx);
      const { iframe, reqs } = canvas();
      frame(iframe, 'ready', {});
      expect(reqs('replaceSymbols')).toHaveLength(0);
      expect(reqs('symbol')).toHaveLength(0);
    });

    it('a chip click posts symbol to the canvas', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      fireEvent.click(screen.getByTestId('symbol-chip-1-win'));
      expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'win' });
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
    });

    it('a second chip click posts symbol to the SAME iframe — the selection never navigates it', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { iframe, reqs } = canvas();
      fireEvent.click(screen.getByTestId('symbol-chip-1-win'));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
      fireEvent.click(screen.getByTestId('symbol-chip-2-static'));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '2', state: 'static' }));
      expect(screen.getByTitle('symbol canvas')).toBe(iframe);
      expect(iframe.src).toBe(`${PREVIEW_URL}/editor.html?symbol=`);
    });

    it('a symbols frame with a changed doc posts replaceSymbols to the canvas', async () => {
      const { ctx, socket } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      const one: SymbolsDoc = { version: 1, symbols: [TWO.symbols[0]] };
      act(() => socket.receive({ type: 'symbols', doc: one, diagnostics: [] }));
      await waitFor(() => expect(reqs('replaceSymbols').at(-1)).toEqual({ doc: one }));
    });

    it('one write is one replaceSymbols: the frame carrying the doc the PUT already answered posts nothing more', async () => {
      const { ctx, socket, docs } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
      renderDocument(ctx);
      const { reqs } = canvas();
      const before = reqs('replaceSymbols').length;
      fireEvent.click(await screen.findByTestId('symbol-add-2'));
      await waitFor(() => expect(docs()).toHaveLength(1));
      await waitFor(() => expect(reqs('replaceSymbols')).toHaveLength(before + 1));
      const written = ctx.symbols.doc()!;
      act(() =>
        socket.receive({
          type: 'symbols',
          doc: JSON.parse(JSON.stringify(written)),
          diagnostics: [],
        }),
      );
      expect(ctx.symbols.doc()).not.toBe(written); // a distinct object, same shape
      await new Promise((r) => setTimeout(r, 10));
      expect(reqs('replaceSymbols')).toHaveLength(before + 1);
    });

    it('the Replay button re-sends the current selection', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      fireEvent.click(screen.getByTestId('symbol-chip-1-win'));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
      const before = reqs('symbol').length;
      fireEvent.click(screen.getByTestId('symbol-replay'));
      expect(reqs('symbol')).toHaveLength(before + 1);
      expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' });
    });

    it("the canvas' own error event shows in the status line", async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { iframe } = canvas();
      frame(iframe, 'error', { message: 'no "symbols" service' });
      expect(await screen.findByTestId('symbols-status')).toHaveTextContent('no "symbols" service');
    });

    it('shows "canvas unavailable" when there is no project open, and renders no iframe', async () => {
      const { ctx } = await harness(
        { 'GET /api/symbols': boot(), 'PUT /api/symbols': accept },
        { previewUrl: null },
      );
      await waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
      renderDocument(ctx);
      expect(await screen.findByTestId('canvas-unavailable')).toHaveTextContent(
        'canvas unavailable: no project open',
      );
      expect(screen.queryByTitle('symbol canvas')).toBeNull();
    });
  });
});
