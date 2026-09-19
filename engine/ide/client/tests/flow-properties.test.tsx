import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { FlowDoc, FlowKindInfo } from '@energy8engine/contracts';
import { boot, FIVE, FIVE_KINDS, harness } from './flow-harness';

/**
 * The flow node inspector, rendered through the plugin's OWN
 * `shell.sideRight` registration (key `flow`) — the way
 * `properties-sidebar.test.tsx` renders the scenes one. Every edit is
 * asserted as the PUT body that went out.
 */
const json = (schema: unknown) => JSON.parse(JSON.stringify(schema));
const KINDS: FlowKindInfo[] = FIVE_KINDS.map((k) => {
  if (k.kind === 'show')
    return {
      ...k,
      schema: json(
        Schema.object({
          scene: Schema.string().required().extra('pick', 'scene').description('scene id'),
          transition: Schema.string().description('transition id'),
        }),
      ),
    };
  if (k.kind === 'wait')
    return {
      ...k,
      schema: json(
        Schema.object({
          ms: Schema.number().description('milliseconds'),
          event: Schema.string().description('event name'),
        }),
      ),
    };
  return k;
});
/** A kind with an `asset` field: the IDE offers the project's files of those extensions. */
const SOUND: FlowKindInfo = {
  kind: 'sound',
  outs: ['next'],
  trigger: false,
  schema: json(
    Schema.object({ src: Schema.string().extra('asset', ['mp3']).description('sound file') }),
  ),
};
KINDS.push(SOUND);
/** A kind with a `node` pick: every `<scene>/<node>` of every scene, nested ones too. */
const TWEEN: FlowKindInfo = {
  kind: 'tween',
  outs: ['next'],
  trigger: false,
  schema: json(
    Schema.object({ target: Schema.string().extra('pick', 'node').description('target node') }),
  ),
};
KINDS.push(TWEEN);
const ready = (doc: FlowDoc = FIVE) => boot({ doc, diagnostics: [], kinds: KINDS });
const accept = (body: unknown) => ({ body: { doc: body, diagnostics: [], kinds: KINDS } });
const SCENES = ['base_game', 'bonus'];

function renderSide(ctx: Context) {
  const entry = ctx.slots.list('shell.sideRight').find((e) => e.key === 'flow');
  if (!entry) throw new Error('no shell.sideRight registration for "flow"');
  const C = entry.component as React.ComponentType<{ ctx: Context }>;
  return render(<C ctx={ctx} />);
}

async function booted(routes: Parameters<typeof harness>[0] = {}, doc: FlowDoc = FIVE) {
  const h = await harness(
    { 'GET /api/flow': ready(doc), 'PUT /api/flow': accept, ...routes },
    SCENES,
  );
  await waitFor(() => expect(h.ctx.flow.doc()).toEqual(doc));
  const puts = () => h.calls.filter((c) => c.method === 'PUT').map((c) => c.body as FlowDoc);
  return { ...h, puts };
}

describe('FlowProperties', () => {
  it('shows on select and hides on select(null); selecting a flow node takes the side over from scenes and clears their selection', async () => {
    const { ctx } = await booted();
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.flow.select('spin');
    expect(ctx.shell.sideRight()).toBe('flow');
    ctx.flow.select(null);
    expect(ctx.shell.sideRight()).toBeUndefined();

    // The scenes canvas had a node picked and its inspector up.
    ctx.scenes.select({ scene: 'base_game', node: 'logo' });
    ctx.shell.showSideRight('scenes');
    ctx.flow.select('spin');
    expect(ctx.scenes.selected()).toBeNull();
    expect(ctx.shell.sideRight()).toBe('flow');
  });

  it('selecting a scene node clears the flow selection; clearing one side never touches the other', async () => {
    const { ctx } = await booted();
    ctx.flow.select('spin');
    ctx.scenes.select({ scene: 'base_game', node: null });
    expect(ctx.flow.selected()).toBeNull();
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    // No ping-pong: the flow clearing itself did not clear scenes.
    ctx.scenes.select(null);
    expect(ctx.flow.selected()).toBeNull();
    ctx.flow.select('draw');
    ctx.flow.select(null);
    ctx.scenes.select({ scene: 'bonus', node: null });
    expect(ctx.scenes.selected()).toEqual({ scene: 'bonus', node: null });
  });

  it('a node: id, kind, the schema form; `scene` is a select of scene ids and a change PUTs', async () => {
    const { ctx, puts } = await booted();
    act(() => ctx.flow.select('base'));
    renderSide(ctx);
    expect((screen.getByTestId('prop-id') as HTMLInputElement).value).toBe('base');
    expect(screen.getByTestId('prop-kind')).toHaveTextContent('show');
    const scene = screen.getByLabelText('scene id') as HTMLSelectElement;
    expect(scene.tagName).toBe('SELECT');
    expect([...scene.options].map((o) => o.value)).toEqual(['', 'base_game', 'bonus']);
    expect(scene.value).toBe('base_game');
    expect((screen.getByLabelText('transition id') as HTMLInputElement).tagName).toBe('INPUT');
    fireEvent.change(scene, { target: { value: 'bonus' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[1]).toEqual({ ...FIVE.nodes[1], props: { scene: 'bonus' } });
    expect(puts()[0].nodes.filter((_, i) => i !== 1)).toEqual(FIVE.nodes.filter((_, i) => i !== 1));
    expect(puts()[0].edges).toEqual(FIVE.edges);
  });

  it('a wait node fresh from the palette (no props) shows its ms and event fields; blur PUTs', async () => {
    const doc: FlowDoc = { ...FIVE, nodes: [...FIVE.nodes, { id: 'wait-1', kind: 'wait' }] };
    const { ctx, puts } = await booted({}, doc);
    act(() => ctx.flow.select('wait-1'));
    renderSide(ctx);
    const ms = screen.getByLabelText('milliseconds') as HTMLInputElement;
    expect(ms.type).toBe('number');
    expect(screen.getByLabelText('event name')).toBeTruthy();
    fireEvent.change(ms, { target: { value: '500' } });
    expect(puts()).toHaveLength(0);
    fireEvent.blur(ms);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({ id: 'wait-1', kind: 'wait', props: { ms: 500 } });
  });

  it("an `asset` field is a select of the project's files with those extensions", async () => {
    const doc: FlowDoc = { ...FIVE, nodes: [...FIVE.nodes, { id: 'sound-1', kind: 'sound' }] };
    const { ctx, puts } = await booted(
      {
        'GET /api/files': () => ({
          body: {
            entries: [
              { path: 'assets/win.mp3', kind: 'file', size: 1 },
              { path: 'assets/a.png', kind: 'file', size: 1 },
            ],
            diagnostics: [],
          },
        }),
      },
      doc,
    );
    act(() => ctx.flow.select('sound-1'));
    renderSide(ctx);
    const src = screen.getByLabelText('sound file') as HTMLSelectElement;
    expect(src.tagName).toBe('SELECT');
    await waitFor(() =>
      expect([...src.options].map((o) => o.value)).toEqual(['', 'assets/win.mp3']),
    );
    fireEvent.change(src, { target: { value: 'assets/win.mp3' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({
      id: 'sound-1',
      kind: 'sound',
      props: { src: 'assets/win.mp3' },
    });
  });

  it("a `pick: 'node'` field is a select of every scene's nodes as <scene>/<node>, nested included", async () => {
    const doc: FlowDoc = { ...FIVE, nodes: [...FIVE.nodes, { id: 'tween-1', kind: 'tween' }] };
    const h = await harness({ 'GET /api/flow': ready(doc), 'PUT /api/flow': accept }, [
      {
        id: 'base_game',
        nodes: [
          {
            id: 'bg',
            type: 'container',
            props: {},
            children: [{ id: 'logo', type: 'image', props: {} }],
          },
        ],
      },
      { id: 'bonus', nodes: [{ id: 'b', type: 'image', props: {} }] },
    ]);
    await waitFor(() => expect(h.ctx.flow.doc()).toEqual(doc));
    act(() => h.ctx.flow.select('tween-1'));
    renderSide(h.ctx);
    const target = screen.getByLabelText('target node') as HTMLSelectElement;
    expect(target.tagName).toBe('SELECT');
    expect([...target.options].map((o) => o.value)).toEqual([
      '',
      'base_game/bg',
      'base_game/logo',
      'bonus/b',
    ]);
    fireEvent.change(target, { target: { value: 'base_game/logo' } });
    await waitFor(() => expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect((h.calls.at(-1)!.body as FlowDoc).nodes.at(-1)).toEqual({
      id: 'tween-1',
      kind: 'tween',
      props: { target: 'base_game/logo' },
    });
  });

  it('rename: PUTs the node under the new id with its edges rewritten, and re-selects it', async () => {
    const { ctx, puts } = await booted();
    act(() => ctx.flow.select('idle'));
    renderSide(ctx);
    const input = screen.getByTestId('prop-id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ready' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[2]).toEqual({ ...FIVE.nodes[2], id: 'ready' });
    expect(puts()[0].edges).toEqual([
      { from: 'start', to: 'base' },
      { from: 'base', to: 'ready' },
      { from: 'ready', to: 'spin' },
      { from: 'spin', to: 'draw' },
      { from: 'draw', to: 'ready' },
    ]);
    await waitFor(() => expect(ctx.flow.selected()).toBe('ready'));
    await waitFor(() =>
      expect((screen.getByTestId('prop-id') as HTMLInputElement).value).toBe('ready'),
    );
  });

  it('rename: a duplicate or empty id is refused inline, no write', async () => {
    const { ctx, puts } = await booted();
    act(() => ctx.flow.select('idle'));
    renderSide(ctx);
    const input = screen.getByTestId('prop-id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'spin' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('prop-id-error')).toHaveTextContent('spin');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('prop-id-error')).toBeTruthy();
    expect(puts()).toHaveLength(0);
    expect(ctx.flow.selected()).toBe('idle');
  });

  it("the host's refusal of a props edit shows as prop-error", async () => {
    const refusal = {
      severity: 'error',
      plugin: 'flow',
      where: 'base',
      message: "unknown scene ''",
    };
    const { ctx } = await booted({
      'PUT /api/flow': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    act(() => ctx.flow.select('base'));
    renderSide(ctx);
    fireEvent.change(screen.getByLabelText('scene id'), { target: { value: '' } });
    expect(await screen.findByTestId('prop-error')).toHaveTextContent(refusal.message);
  });

  it('an unregistered kind renders id and kind with a prop-error and no form', async () => {
    const doc: FlowDoc = { ...FIVE, nodes: [...FIVE.nodes, { id: 'x-1', kind: 'mystery' }] };
    const { ctx } = await booted({}, doc);
    act(() => ctx.flow.select('x-1'));
    renderSide(ctx);
    expect((screen.getByTestId('prop-id') as HTMLInputElement).value).toBe('x-1');
    expect(screen.getByTestId('prop-kind')).toHaveTextContent('mystery');
    expect(screen.getByTestId('prop-error')).toHaveTextContent('kind "mystery" is not registered');
    expect(document.querySelector('.e8-schema-form')).toBeNull();
  });

  it('a selected node no longer in the document renders the root and nothing else', async () => {
    const { ctx } = await booted();
    act(() => ctx.flow.select('gone'));
    renderSide(ctx);
    expect(screen.getByTestId('flow-properties')).toBeTruthy();
    expect(screen.queryByTestId('prop-id')).toBeNull();
  });
});
