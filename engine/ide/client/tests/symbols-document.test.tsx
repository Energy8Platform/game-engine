import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SymbolsDoc } from '@energy8engine/contracts';
import { addSymbol } from '../src/shell/symbols-doc';
import { CANVAS_SILENT } from '../src/shell/useCanvasSilence';
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
} from './symbols-harness';

/**
 * A frame FROM the iframe: the message event the browser would deliver to
 * the tab's window. `act()`: `ready` can now land a synchronous `setStatus`
 * too (`useCanvasSilence`'s own handler, beside `askSnapshot`'s existing
 * async ones) — outside any testing-library event helper otherwise.
 */
function frame(iframe: HTMLIFrameElement, event: string, payload: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'e8:ide:evt', event, payload },
        origin: PREVIEW_URL,
        source: iframe.contentWindow,
      }),
    );
  });
}

/**
 * The Symbols document, rendered through the plugin's `shell.document`
 * registration: the canvas, its toolbar (header/cell-size/zoom/play), the
 * help/empty-state panels, and the canvas' own status line — the list
 * (rows, chips, ghosts, drops, the add input, the row menu, and the
 * write-refusal status that goes with them) is `SymbolsList` now, the
 * tab's `shell.sidebar` entry (`symbols-list.test.tsx`). Selection is the
 * one thing both sides share, through `ctx.symbols` — driven here
 * directly (`ctx.symbols.select`) rather than through a list row/chip
 * that no longer renders in this component.
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
  it('renders the live canvas, with no status line to start', async () => {
    const { ctx } = await booted({}, { version: 1, symbols: [TWO.symbols[0]] });
    renderDocument(ctx);
    expect(await screen.findByTestId('symbols-doc')).toBeTruthy();
    const iframe = screen.getByTitle('symbol canvas') as HTMLIFrameElement;
    expect(iframe.src).toBe(`${PREVIEW_URL}/editor.html?symbol=`);
    expect(screen.queryByTestId('symbols-canvas-status')).toBeNull();
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

    it("a canvas undo/redo event runs the history with the 'symbols' key — Mod+Z typed inside the iframe never reaches this page's own listener", async () => {
      const { ctx } = await booted();
      ctx.shell.open({ key: 'symbols', title: 'Symbols', component: () => null, closable: false });
      renderDocument(ctx);
      const { iframe } = canvas();
      const undo = vi.spyOn(ctx.history, 'undo');
      const redo = vi.spyOn(ctx.history, 'redo');
      frame(iframe, 'undo', undefined);
      expect(undo).toHaveBeenCalledWith(['symbols']);
      frame(iframe, 'redo', undefined);
      expect(redo).toHaveBeenCalledWith(['symbols']);
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

    it('a selection posts symbol to the canvas', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { reqs } = canvas();
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
    });

    it('a second selection posts symbol to the SAME iframe — the selection never navigates it', async () => {
      const { ctx } = await booted();
      renderDocument(ctx);
      const { iframe, reqs } = canvas();
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
      await waitFor(() => expect(reqs('symbol').at(-1)).toEqual({ id: '1', state: 'win' }));
      act(() => ctx.symbols.select({ id: '2', state: 'static' }));
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
      await act(async () => {
        await ctx.symbols.update((d) => addSymbol(d, '2', 'lemon'));
      });
      expect(docs()).toHaveLength(1);
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
      act(() => ctx.symbols.select({ id: '1', state: 'win' }));
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
      expect(await screen.findByTestId('symbols-canvas-status')).toHaveTextContent(
        'no "symbols" service',
      );
    });

    it('no ready within 10s of mount shows the silence text', async () => {
      const { ctx } = await booted();
      vi.useFakeTimers();
      try {
        renderDocument(ctx);
        canvas();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(screen.getByTestId('symbols-canvas-status')).toHaveTextContent(CANVAS_SILENT);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a ready after the silence text clears it', async () => {
      const { ctx } = await booted();
      vi.useFakeTimers();
      try {
        renderDocument(ctx);
        const { iframe } = canvas();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(screen.getByTestId('symbols-canvas-status')).toHaveTextContent(CANVAS_SILENT);
        // `frame`'s own `act()` only flushes the synchronous `onReady`; the
        // `ready` handler's `tell()`/`askSnapshot()` calls resolve on a
        // later microtask (the canvas mock answers `snapshot`/`zoom`
        // straight away) — awaited here so that settling is flushed too,
        // same as every other `ready` assertion below.
        await act(async () => {
          frame(iframe, 'ready', {});
        });
        expect(screen.queryByTestId('symbols-canvas-status')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    // An `error` counts as the canvas answering too — its own message must
    // outlive the silence timer, not get overwritten by CANVAS_SILENT.
    it('an error with no ready after it: the error text survives past 10s', async () => {
      const { ctx } = await booted();
      vi.useFakeTimers();
      try {
        renderDocument(ctx);
        const { iframe } = canvas();
        frame(iframe, 'error', { message: 'no "symbols" service' });
        expect(screen.getByTestId('symbols-canvas-status')).toHaveTextContent(
          'no "symbols" service',
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(screen.getByTestId('symbols-canvas-status')).toHaveTextContent(
          'no "symbols" service',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('no preview address: no canvas, so no silence text after 10s', async () => {
      const { ctx } = await harness(
        { 'GET /api/symbols': boot(), 'PUT /api/symbols': accept },
        { previewUrl: null },
      );
      await waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
      vi.useFakeTimers();
      try {
        renderDocument(ctx);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(screen.queryByTestId('symbols-canvas-status')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
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

  // The symbol list and the Explorer share the left sidebar, so a file
  // from the Explorer is dropped on the canvas, which is on screen beside it.
  describe('an Explorer drop on the canvas', () => {
    it('with a symbol selected, sets its selected state to the file', async () => {
      const { ctx, docs } = await booted();
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '2', state: 'win' }));
      fireEvent.drop(screen.getByTestId('symbols-canvas'), transfer('assets/coin.json'));
      await waitFor(() => expect(docs()).toHaveLength(1));
      expect(docs()[0].symbols[1].win).toEqual({
        type: 'spritesheet',
        props: { sheet: 'assets/coin.json', loop: false },
      });
    });

    it('with nothing selected, adds a symbol named from the file', async () => {
      const { ctx, docs } = await booted();
      renderDocument(ctx);
      fireEvent.drop(screen.getByTestId('symbols-canvas'), transfer('assets/9.png'));
      await waitFor(() => expect(docs()).toHaveLength(1));
      expect(docs()[0].symbols.at(-1)).toEqual({
        id: '9',
        static: { type: 'image', props: { src: 'assets/9.png' } },
      });
    });

    it('a refusal shows in the canvas status line', async () => {
      const { ctx, docs } = await booted();
      renderDocument(ctx);
      act(() => ctx.symbols.select({ id: '1', state: 'idle' }));
      fireEvent.drop(screen.getByTestId('symbols-canvas'), transfer('assets/song.mp3'));
      await waitFor(() =>
        expect(screen.getByTestId('symbols-canvas-status')).toHaveTextContent(
          'no node type for .mp3',
        ),
      );
      expect(docs()).toHaveLength(0);
    });

    it('a drag that carries no Explorer path is left alone', async () => {
      const { ctx, docs } = await booted();
      renderDocument(ctx);
      const area = screen.getByTestId('symbols-canvas');
      const other = { dataTransfer: { types: ['Files'], getData: () => '', dropEffect: 'none' } };
      // `fireEvent` answers `false` only when the handler called `preventDefault`.
      expect(fireEvent.dragOver(area, other)).toBe(true);
      expect(fireEvent.drop(area, other)).toBe(true);
      await act(async () => {});
      expect(docs()).toHaveLength(0);
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
      expect(help).toHaveTextContent(
        'Drop a file from the Explorer onto the canvas to set the selected state, or with nothing selected to add a symbol',
      );
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
        'no win yet — drop a file here, or Create in Properties',
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

    // M2: the symbol itself is still there (unlike the "another tab removed
    // it" case above), but the NAMED state the selection points at is gone
    // — a remote Clear, say. A built-in never vanishes this way (it's
    // always at least the empty fallback), so only a named state needs the
    // check; falling back to `static` keeps the canvas showing something
    // instead of stranding the selection on a state that no longer exists.
    it('a selection on a named state the doc no longer has falls back to { id, state: static }', async () => {
      const withDeath: SymbolsDoc = {
        version: 1,
        symbols: [
          { ...TWO.symbols[0], states: { death: { type: 'image', props: { src: 'assets/d.png' } } } },
          TWO.symbols[1],
        ],
      };
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
      await waitFor(() => expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'static' }));
      expect(await screen.findByTestId('symbols-header')).toHaveTextContent('1 · cherry · static');
    });
  });
});
