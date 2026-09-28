import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FlowDoc } from '@energy8engine/contracts';
import { KIND_MIME } from '../src/shell/flow-graph';
import { boot, FIVE, FIVE_KINDS, harness, renderDocument, renderSidebar } from './flow-harness';

/**
 * The Flow tab's left sidebar (`shell.sidebar` `flow`), rendered through
 * the plugin's registration — moved out of `FlowDocument` (which keeps the
 * canvas; `flow-document.test.tsx` covers it, driving a click-add through
 * `ctx.flow.requestAdd` directly rather than mounting this sidebar too).
 * The click-add test below mounts BOTH the sidebar and the document: a
 * click needs the canvas' own `screenToFlowPosition`/pane box to centre the
 * new node, reached through `ctx.flow`'s `requestAdd`/`onAddRequest`
 * bridge — the one thing this sidebar cannot do standing alone.
 */
const ready = (doc: FlowDoc | null = FIVE) => boot({ doc, diagnostics: [], kinds: FIVE_KINDS });
const accept = (body: unknown) => ({ body: { doc: body, diagnostics: [], kinds: FIVE_KINDS } });

describe('FlowPalette', () => {
  it('lists one button per kind, draggable, with KIND_MIME set on drag start', async () => {
    const { ctx } = await harness({ 'GET /api/flow': ready() });
    renderSidebar(ctx);
    const palette = await screen.findByTestId('flow-palette');
    expect(palette.querySelectorAll('button')).toHaveLength(FIVE_KINDS.length);
    expect(screen.getByTestId('flow-add-wait')).toHaveTextContent('wait');

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      dropEffect: 'none',
      effectAllowed: 'all',
    };
    fireEvent.dragStart(screen.getByTestId('flow-add-wait'), { dataTransfer });
    expect(data.get(KIND_MIME)).toBe('wait');
  });

  it('no flow.yml yet: nothing renders (no canvas to add into either)', async () => {
    const { ctx } = await harness({ 'GET /api/flow': ready(null) });
    renderSidebar(ctx);
    await waitFor(() => expect(ctx.flow.kinds()).toEqual(FIVE_KINDS));
    expect(screen.queryByTestId('flow-palette')).toBeNull();
  });

  it('clicking a button PUTs the doc with a new <kind>-<n> node, centred on the pane and stepped per click', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': ready(),
      'PUT /api/flow': accept,
    });
    renderDocument(ctx);
    renderSidebar(ctx);
    await screen.findByTestId('flow-node-spin');
    // The pane's own box, mocked the way the drop test controls its
    // `clientX`/`clientY` — jsdom gives every element a zero rect, so
    // without this a click and a drop would be indistinguishable.
    vi.spyOn(screen.getByTestId('flow-canvas'), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });
    await userEvent.setup().click(screen.getByTestId('flow-add-wait'));
    await waitFor(() => expect(calls.at(-1)?.method).toBe('PUT'));
    const sent = calls.at(-1)!.body as FlowDoc;
    expect(sent.nodes).toHaveLength(6);
    // The pane's centre: 800×600 at (0,0) client, identity viewport.
    expect(sent.nodes.at(-1)).toEqual({ id: 'wait-1', kind: 'wait', ui: { x: 400, y: 300 } });
    expect(await screen.findByTestId('flow-node-wait-1')).toBeTruthy();

    // A second click in a row steps by 40 — it does not land on wait-1's
    // exact spot, and does NOT grow with the doc's own node count (six by
    // now) the way the old `80 + 40 * n` did.
    await userEvent.setup().click(screen.getByTestId('flow-add-wait'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    const sent2 = calls.at(-1)!.body as FlowDoc;
    expect(sent2.nodes.at(-1)).toEqual({ id: 'wait-2', kind: 'wait', ui: { x: 440, y: 340 } });
  });
});
