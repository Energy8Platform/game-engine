import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Diagnostic, FlowDoc } from '@energy8engine/contracts';
import { boot, FIVE, FIVE_KINDS, harness, renderDocument, type Answer } from './flow-harness';

/**
 * The Flow document's canvas, rendered through the document registration
 * the way `flow-service.test.tsx` renders its empty state: React Flow on
 * jsdom draws the nodes (unmeasured, so `visibility: hidden` — the DOM is
 * there, the layout is not) and routes clicks, keys and drops the way it
 * does in a browser. `tests/setup.ts` stubs the `ResizeObserver` it
 * wants. Waits go through RTL's `waitFor` (act-aware), not vitest's: the
 * writes land from promise chains and timers, outside any event.
 */
const ready = (doc: FlowDoc = FIVE) => boot({ doc, diagnostics: [], kinds: FIVE_KINDS });
const accept = (body: unknown) => ({ body: { doc: body, diagnostics: [], kinds: FIVE_KINDS } });

describe('FlowDocument canvas', () => {
  it('draws every node with its ports, and the palette from kinds()', async () => {
    const { ctx } = await harness({ 'GET /api/flow': ready() });
    renderDocument(ctx);
    for (const id of ['start', 'base', 'idle', 'spin', 'draw'])
      expect(await screen.findByTestId(`flow-node-${id}`)).toBeTruthy();
    expect(screen.getByTestId('flow-node-spin')).toHaveTextContent('spin');
    expect(screen.getByTestId('flow-port-spin-result')).toBeTruthy();
    expect(screen.getByTestId('flow-port-spin-failed')).toBeTruthy();
    // Every node has an input, a trigger too: `draw → idle` (the loop back
    // to `on`) is a doc edge, and React Flow draws none into a node
    // without a target handle — measured as error 008 for two of the five
    // fixture edges when triggers had none.
    for (const id of ['start', 'idle', 'spin'])
      expect(
        screen.getByTestId(`flow-node-${id}`).querySelector('.react-flow__handle.target'),
      ).toBeTruthy();
    const palette = screen.getByTestId('flow-palette');
    expect(palette.querySelectorAll('button')).toHaveLength(FIVE_KINDS.length);
    expect(screen.getByTestId('flow-add-wait')).toHaveTextContent('wait');
  });

  it('clicking a palette button PUTs the doc with a new <kind>-<n> node, staggered by count', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': accept,
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    await userEvent.setup().click(screen.getByTestId('flow-add-wait'));
    await waitFor(() => expect(calls.at(-1)?.method).toBe('PUT'));
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(sent.nodes).toHaveLength(6);
    expect(sent.nodes.at(-1)).toEqual({ id: 'wait-1', kind: 'wait', ui: { x: 280, y: 280 } });
    expect(await screen.findByTestId('flow-node-wait-1')).toBeTruthy();
  });

  it('a refused write shows inline as flow-error', async () => {
    const refusal: Diagnostic = {
      severity: 'error',
      plugin: 'flow',
      where: 'wait-1',
      message: "'wait' needs an 'event' or 'ms'",
    };
    const { ctx } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    expect(screen.queryByTestId('flow-error')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('flow-add-wait'));
    expect(await screen.findByTestId('flow-error')).toHaveTextContent(refusal.message);
    expect(screen.queryByTestId('flow-node-wait-1')).toBeNull();
  });

  it('a flow-trace frame paints the run onto the nodes', async () => {
    const { ctx, socket } = await harness({ 'GET /api/flow': ready() });
    renderDocument(ctx);
    const spin = await screen.findByTestId('flow-node-spin');
    expect(spin).not.toHaveClass('e8-flow-ran');
    // `act()`: a server push notifies the mounted document synchronously.
    act(() => {
      socket.receive({
        type: 'flow-trace',
        entries: [
          { run: 1, node: 'spin', out: null, at: 0 },
          { run: 1, node: 'spin', out: 'result', at: 1 },
          { run: 1, node: 'draw', out: null, at: 2 },
        ],
      });
    });
    expect(screen.getByTestId('flow-node-spin')).toHaveClass('e8-flow-ran');
    expect(screen.getByTestId('flow-node-spin')).not.toHaveClass('e8-flow-active');
    expect(screen.getByTestId('flow-node-draw')).toHaveClass('e8-flow-ran', 'e8-flow-active');
    expect(screen.getByTestId('flow-node-start')).not.toHaveClass('e8-flow-ran');

    // A later frame of the SAME run paints too (the service hands out a
    // fresh array per frame; an in-place push would leave this one unseen).
    act(() => {
      socket.receive({
        type: 'flow-trace',
        entries: [
          { run: 1, node: 'draw', out: 'next', at: 3 },
          { run: 1, node: 'idle', out: null, at: 4 },
        ],
      });
    });
    expect(screen.getByTestId('flow-node-idle')).toHaveClass('e8-flow-ran', 'e8-flow-active');
    expect(screen.getByTestId('flow-node-draw')).toHaveClass('e8-flow-ran');
    expect(screen.getByTestId('flow-node-draw')).not.toHaveClass('e8-flow-active');
  });

  it('clicking a node selects it; clicking the pane clears the selection', async () => {
    const { ctx } = await harness({ 'GET /api/flow': ready() });
    renderDocument(ctx);
    fireEvent.click(await screen.findByTestId('flow-node-spin'));
    expect(ctx.flow.selected()).toBe('spin');
    fireEvent.click(document.querySelector('.react-flow__pane')!);
    expect(ctx.flow.selected()).toBeNull();
  });

  it('Delete on a selected node PUTs the doc without it and its edges, and clears the selection', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': accept,
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    act(() => ctx.flow.select('spin'));
    expect(document.querySelector('.react-flow__node[data-id="spin"]')).toHaveClass('selected');
    // React Flow resolves what to delete in a microtask; the async act flushes it.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' });
    });
    await waitFor(() => expect(calls.at(-1)?.method).toBe('PUT'));
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(sent.nodes.map((n) => n.id)).toEqual(['start', 'base', 'idle', 'draw']);
    expect(sent.edges).toEqual([
      { from: 'start', to: 'base' },
      { from: 'base', to: 'idle' },
      { from: 'draw', to: 'idle' },
    ]);
    expect(ctx.flow.selected()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('flow-node-spin')).toBeNull());
  });

  it('a refused write re-projects from the doc: a deleted node is back, a moved node snaps back', async () => {
    const refusal: Diagnostic = { severity: 'error', plugin: 'flow', where: 'spin', message: 'no' };
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    const wrapper = () => document.querySelector<HTMLElement>('.react-flow__node[data-id="spin"]')!;
    act(() => ctx.flow.select('spin'));

    // React Flow moved the node locally before the host answered; the
    // doc did not change, so only the refusal itself can put it back.
    fireEvent.keyDown(wrapper(), { key: 'ArrowRight' });
    fireEvent.keyUp(wrapper(), { key: 'ArrowRight' });
    expect(wrapper().style.transform).toBe('translate(585px,80px)');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(await screen.findByTestId('flow-error')).toHaveTextContent('no');
    await waitFor(() => expect(wrapper().style.transform).toBe('translate(580px,80px)'));

    // Same for a delete: dropped locally first, back once refused.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' });
    });
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(await screen.findByTestId('flow-node-spin')).toBeTruthy();
    expect(ctx.flow.doc()).toEqual(FIVE);
  });

  it('a write queued behind an in-flight move reduces the moved doc — neither is lost', async () => {
    let answerMove!: (a: Answer) => void;
    let puts = 0;
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': (body) =>
        ++puts === 1
          ? new Promise<Answer>((resolve) => {
              answerMove = resolve;
            })
          : accept(body),
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    act(() => ctx.flow.select('spin'));
    fireEvent.keyDown(document.querySelector('.react-flow__node[data-id="spin"]')!, {
      key: 'ArrowRight',
    });
    // The move's PUT is out; the host has not answered.
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect((calls.at(-1)!.body as FlowDoc).nodes.find((n) => n.id === 'spin')?.ui).toEqual({
      x: 585,
      y: 80,
    });

    // Add a node now: it waits its turn behind the move.
    await userEvent.setup().click(screen.getByTestId('flow-add-wait'));
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    answerMove(accept(calls.at(-1)!.body));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(sent.nodes.find((n) => n.id === 'spin')?.ui).toEqual({ x: 585, y: 80 });
    expect(sent.nodes.at(-1)).toMatchObject({ id: 'wait-1', kind: 'wait' });
    await waitFor(() => expect(ctx.flow.doc()).toEqual(sent));
  });

  it('moves coalesce for 250 ms into one PUT carrying the final position', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': accept,
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    act(() => ctx.flow.select('spin'));
    // React Flow's keyboard nudge (5px per arrow) is the same `position`
    // change a drag emits, and jsdom can deliver it.
    const wrapper = document.querySelector('.react-flow__node[data-id="spin"]')!;
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    const before = calls.length;
    await waitFor(() => expect(calls.length).toBeGreaterThan(before), { timeout: 1000 });
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(calls.at(-1)!.method).toBe('PUT');
    expect(sent.nodes.find((n) => n.id === 'spin')?.ui).toEqual({ x: 590, y: 85 });
    expect(calls.length).toBe(before + 1);
    await waitFor(() => expect(ctx.flow.doc()).toEqual(sent));
  });

  it('dropping a palette kind onto the canvas adds it there', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': accept,
    });
    renderDocument(ctx);
    await screen.findByTestId('flow-node-spin');
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      dropEffect: 'none',
      effectAllowed: 'all',
    };
    fireEvent.dragStart(screen.getByTestId('flow-add-wait'), { dataTransfer });
    expect(data.get('application/e8-flow-kind')).toBe('wait');
    const canvas = screen.getByTestId('flow-canvas');
    fireEvent.dragOver(canvas, { dataTransfer });
    fireEvent.drop(canvas, { dataTransfer, clientX: 100, clientY: 50 });
    await waitFor(() => expect(calls.at(-1)?.method).toBe('PUT'));
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(sent.nodes.at(-1)).toMatchObject({ id: 'wait-1', kind: 'wait' });
    expect(sent.nodes.at(-1)!.ui).toBeDefined();
    expect(await screen.findByTestId('flow-node-wait-1')).toBeTruthy();
  });
});
