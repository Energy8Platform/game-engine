import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SymbolsDoc } from '@energy8engine/contracts';
import { EMPTY } from '../src/shell/symbols-doc';
import {
  accept,
  boot,
  canvas,
  harness,
  KNOWN,
  PREVIEW_URL,
  renderDocument,
  transfer,
  TWO,
  type Answer,
} from './symbols-harness';

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
    it('the iframe has no width/height/transform; its wrapper fills the pane', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const iframe = screen.getByTitle('symbol canvas');
      expect(iframe).not.toHaveAttribute('width');
      expect(iframe).not.toHaveAttribute('height');
      expect((iframe as HTMLElement).style.transform).toBe('');
      expect(iframe.closest('.e8-symbols-stage')).toBeTruthy();
    });

    it('on ready, sends the doc, the remembered zoom, the selection, then asks snapshot, in that order', async () => {
      localStorage.clear();
      const { ctx } = await booted();
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
      renderDocument(ctx);
      const { iframe, posted } = canvas();
      const before = posted().length;
      frame(iframe, 'ready', {});
      const added = posted().slice(before);
      expect(added.map((m) => m.method)).toEqual(['replaceSymbols', 'zoom', 'symbol', 'snapshot']);
      expect(added[0].params).toEqual({ doc: ctx.symbols.doc() });
      expect(added[1].params).toEqual({ mode: 'fit' });
      expect(added[2].params).toEqual({ id: '1', state: 'win' });
    });

    it('ready always sends zoom and asks snapshot, but skips replaceSymbols/symbol with no doc and nothing selected', async () => {
      localStorage.clear();
      const { ctx } = await booted({}, null);
      renderDocument(ctx);
      const { iframe, reqs } = canvas();
      frame(iframe, 'ready', {});
      expect(reqs('replaceSymbols')).toHaveLength(0);
      expect(reqs('symbol')).toHaveLength(0);
      expect(reqs('zoom').at(-1)).toEqual({ mode: 'fit' });
      expect(reqs('snapshot')).toHaveLength(1);
    });

    it("the canvas' snapshot answer fills the toolbar's cell size", async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { iframe } = canvas({ width: 96, height: 96 });
      frame(iframe, 'ready', {});
      await waitFor(() =>
        expect(screen.getByTestId('symbols-cell-size')).toHaveTextContent('cell 96×96'),
      );
    });

    it('a remount (reload) resets the cell size until the new canvas answers snapshot', async () => {
      const { ctx, bumpReloads } = await booted();
      renderDocument(ctx);
      const first = canvas({ width: 96, height: 96 });
      frame(first.iframe, 'ready', {});
      await waitFor(() =>
        expect(screen.getByTestId('symbols-cell-size')).toHaveTextContent('cell 96×96'),
      );
      act(() => bumpReloads());
      expect(screen.getByTestId('symbols-cell-size').textContent).toBe('');
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

    it('a symbols frame with a changed doc posts replaceSymbols to the canvas and re-asks snapshot', async () => {
      const { ctx, socket } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      const before = reqs('snapshot').length;
      const one: SymbolsDoc = { version: 1, symbols: [TWO.symbols[0]] };
      act(() => socket.receive({ type: 'symbols', doc: one, diagnostics: [] }));
      await waitFor(() => expect(reqs('replaceSymbols').at(-1)).toEqual({ doc: one }));
      expect(reqs('snapshot').length).toBeGreaterThan(before);
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

    it('the Play button (labelled ▶ Play) re-sends the current selection', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      expect(screen.getByTestId('symbol-replay')).toHaveTextContent('▶ Play');
      const { reqs } = canvas();
      fireEvent.click(screen.getByTestId('symbol-chip-1-win'));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
      const before = reqs('symbol').length;
      fireEvent.click(screen.getByTestId('symbol-replay'));
      expect(reqs('symbol')).toHaveLength(before + 1);
      expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' });
    });

    // M4: `▶ Play` had no `disabled` at all — clickable with nothing to
    // play (nothing selected, or a state the symbol hasn't got).
    it('▶ Play is disabled with nothing selected, or a state the symbol has not got; enabled once there is something to play', async () => {
      const { ctx } = await booted(); // TWO's symbol 2 has no `win`
      renderDocument(ctx);
      expect(screen.getByTestId('symbol-replay')).toBeDisabled();
      act(() => ctx.symbols.select({ id: '2', state: 'win' }));
      await waitFor(() => expect(screen.getByTestId('symbols-state-empty')).toBeTruthy());
      expect(screen.getByTestId('symbol-replay')).toBeDisabled();
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
      await waitFor(() => expect(screen.getByTestId('symbol-replay')).not.toBeDisabled());
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

  describe('zoom', () => {
    afterEach(() => {
      try {
        localStorage.clear();
      } catch {
        // nothing to clean up without storage
      }
    });

    it('clicking 2x sends zoom, marks it pressed, and remembers it', async () => {
      localStorage.clear();
      const { ctx } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      fireEvent.click(screen.getByTestId('symbols-zoom-2x'));
      expect(reqs('zoom').at(-1)).toEqual({ mode: '2x' });
      expect(screen.getByTestId('symbols-zoom-2x')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('symbols-zoom-fit')).toHaveAttribute('aria-pressed', 'false');
      expect(localStorage.getItem('e8.symbols-zoom')).toBe('2x');
    });

    it('a remount starts on the remembered zoom and sends it after ready', async () => {
      localStorage.setItem('e8.symbols-zoom', '2x');
      const { ctx } = await booted();
      renderDocument(ctx);
      expect(screen.getByTestId('symbols-zoom-2x')).toHaveAttribute('aria-pressed', 'true');
      const { iframe, reqs } = canvas();
      frame(iframe, 'ready', {});
      expect(reqs('zoom').at(-1)).toEqual({ mode: '2x' });
    });

    it('junk in storage falls back to fit', async () => {
      localStorage.setItem('e8.symbols-zoom', 'huge');
      const { ctx } = await booted();
      renderDocument(ctx);
      expect(screen.getByTestId('symbols-zoom-fit')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a throwing storage falls back to fit', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      try {
        const { ctx } = await booted();
        renderDocument(ctx);
        expect(screen.getByTestId('symbols-zoom-fit')).toHaveAttribute('aria-pressed', 'true');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('the toolbar header and help panel', () => {
    it('nothing selected: the help panel explains states and dropping; no header', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const help = await screen.findByTestId('symbols-help');
      expect(help).toHaveTextContent(/static/);
      expect(help).toHaveTextContent(/idle/);
      expect(help).toHaveTextContent(/win/);
      expect(help).toHaveTextContent(/drop a file/i);
      expect(help).not.toHaveTextContent('symbols.yml');
      expect(screen.queryByTestId('symbols-header')).toBeNull();
    });

    it('with no doc, the help panel also says the first add creates symbols.yml', async () => {
      const { ctx } = await booted({}, null);
      renderDocument(ctx);
      expect(await screen.findByTestId('symbols-help')).toHaveTextContent(
        'There is no symbols.yml yet — the first symbol you add creates it.',
      );
    });

    it('the header reads id · name · state', async () => {
      const named: SymbolsDoc = {
        version: 1,
        symbols: [{ id: '3', name: 'sym-3', static: { type: 'image', props: { src: '' } } }],
      };
      const { ctx } = await booted({}, named);
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '3', state: 'static' }));
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('3 · sym-3 · static');
      expect(screen.queryByTestId('symbols-help')).toBeNull();
      expect(screen.queryByTestId('symbols-state-empty')).toBeNull();
    });

    it('a def with no name: the header is just id · state', async () => {
      const anon: SymbolsDoc = {
        version: 1,
        symbols: [{ id: '3', static: { type: 'image', props: { src: '' } } }],
      };
      const { ctx } = await booted({}, anon);
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '3', state: 'static' }));
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('3 · static');
    });

    it('a state the def has not got shows the empty-state line instead of the help panel', async () => {
      const { ctx } = await booted(); // TWO's symbol 2 has no `win`
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '2', state: 'win' }));
      expect(await screen.findByTestId('symbols-state-empty')).toHaveTextContent(
        'no win yet — drop a file on the chip, or Create in Properties',
      );
      expect(screen.queryByTestId('symbols-help')).toBeNull();
    });

    it('a selection whose symbol another tab removed falls back to the help panel, and the stale selection is cleared', async () => {
      const named: SymbolsDoc = {
        version: 1,
        symbols: [
          { id: '3', name: 'sym-3', static: { type: 'image', props: { src: '' } } },
          TWO.symbols[0],
        ],
      };
      const { ctx, socket } = await booted({}, named);
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '3', state: 'static' }));
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('3 · sym-3 · static');
      // Another tab's remove: the `symbols` frame no longer carries id '3'.
      act(() =>
        socket.receive({
          type: 'symbols',
          doc: { version: 1, symbols: [TWO.symbols[0]] },
          diagnostics: [],
        }),
      );
      await waitFor(() => expect(screen.queryByTestId('symbols-header')).toBeNull());
      expect(screen.getByTestId('symbols-help')).toBeTruthy();
      expect(ctx.symbols.selected()).toBeNull();
    });
  });

  describe('named states in the chip row', () => {
    const withDeath: SymbolsDoc = {
      version: 1,
      symbols: [
        { ...TWO.symbols[0], states: { death: { type: 'image', props: { src: 'assets/d.png' } } } },
        TWO.symbols[1],
      ],
    };

    it('a named state chip renders after the built-ins, and selects { id, state: name } on click', async () => {
      const { ctx } = await booted({}, withDeath);
      renderDocument(ctx);
      const chip = await screen.findByTestId('symbol-chip-1-death');
      expect(chip).toHaveTextContent('image');
      fireEvent.click(chip);
      expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'death' });
      expect(chip).toHaveClass('e8-symbol-chip-selected');
    });

    it('the "+" chip prompts for a name and PUTs a new named state with an empty image', async () => {
      const { ctx, docs } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
      renderDocument(ctx);
      const prompt = vi.spyOn(window, 'prompt').mockReturnValue('death');
      fireEvent.click(await screen.findByTestId('symbol-chip-add-1'));
      expect(prompt).toHaveBeenCalled();
      await waitFor(() => expect(docs()).toHaveLength(1));
      expect(docs()[0].symbols[0].states).toEqual({
        death: { type: 'image', props: { src: '' } },
      });
      prompt.mockRestore();
    });

    it('a blank or cancelled prompt is a no-op', async () => {
      const { ctx, docs } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
      renderDocument(ctx);
      const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
      fireEvent.click(await screen.findByTestId('symbol-chip-add-1'));
      expect(docs()).toHaveLength(0);
      prompt.mockReturnValue('   ');
      fireEvent.click(screen.getByTestId('symbol-chip-add-1'));
      expect(docs()).toHaveLength(0);
      prompt.mockRestore();
    });

    it('the row menu offers Clear for a named state that is present, and it removes just that state', async () => {
      const { ctx, docs } = await booted({}, withDeath);
      renderDocument(ctx);
      fireEvent.click(await screen.findByTestId('symbol-menu-1'));
      expect(screen.getByTestId('symbol-clear-death')).toBeTruthy();
      fireEvent.click(screen.getByTestId('symbol-clear-death'));
      await waitFor(() => expect(docs()).toHaveLength(1));
      expect(docs()[0].symbols[0].states).toBeUndefined();
    });

    // M2: the symbol itself is still there (unlike the "another tab removed
    // it" case above), but the NAMED state the selection points at is gone
    // — a remote Clear, say. A built-in never vanishes this way (it's
    // always at least the empty fallback), so only a named state needs the
    // check; falling back to `static` keeps the canvas showing something
    // instead of stranding the selection on a state that no longer exists.
    it('a selection on a named state the doc no longer has falls back to { id, state: static }', async () => {
      const { ctx, socket } = await booted({}, withDeath);
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '1', state: 'death' }));
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('1 · cherry · death');
      // Another tab clears `death`: the `symbols` frame's def no longer has it.
      act(() =>
        socket.receive({
          type: 'symbols',
          doc: { version: 1, symbols: [TWO.symbols[0], TWO.symbols[1]] },
          diagnostics: [],
        }),
      );
      await waitFor(() =>
        expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'static' }),
      );
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('1 · cherry · static');
    });
  });
});
