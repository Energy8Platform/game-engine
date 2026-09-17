// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Container, Graphics, Texture } from 'pixi.js';
import Schema from 'schemastery';
import type { SceneDoc } from '@energy8engine/contracts';
import { container, createNodeTypes, createScenes, image, type AssetLoader, type NodeType } from '@energy8engine/scenes';
import * as plugin from '../src/index';

const loader: AssetLoader = { load: async () => {}, unload: async () => {}, get: () => Texture.EMPTY };
/** A 40×40 filled square — `container` is empty and picks nothing. */
const box: NodeType = { type: 'box', schema: Schema.object({}), mount: () => new Graphics().rect(0, 0, 40, 40).fill(0xffffff) };

// Design 960×576 on a 480×288 screen: scale 0.5, no letterbox. `lo` covers design 100..140, `hi` 120..160.
const DOCS: SceneDoc[] = [
  { id: 'a', nodes: [{ id: 'lo', type: 'box', props: { x: 100, y: 100 } }, { id: 'hi', type: 'box', props: { x: 120, y: 120 } }] },
  { id: 'b', nodes: [{ id: 'only', type: 'box', props: {} }] },
];

type Frame = { type: string; id?: number; event?: string; payload?: unknown; ok?: boolean; result?: unknown };

function boot(scene = 'a', docs = DOCS, docsReady?: Promise<void>) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: { add: vi.fn(), remove: vi.fn() }, canvas: document.createElement('canvas'), screen: { width: 480, height: 288 } };
  ctx.provide('renderer', { app });
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, box]) nodeTypes.register(t);
  ctx.provide('nodeTypes', nodeTypes);
  const scenes = createScenes({ root: app.stage, design: { width: 960, height: 576 }, nodeTypes, loader, ctx });
  scenes.replace(docs);
  if (docsReady) scenes.ready = docsReady;
  ctx.provide('scenes', scenes);
  const posted: Frame[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  const dropTarget = document.createElement('div');
  let id = 0;
  const fiber = ctx.plugin(plugin, {
    scene, parentOrigin: 'http://ide', dropTarget,
    post: (msg: unknown) => posted.push(msg as Frame),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  const events = () => posted.filter((m) => m.type === 'e8:ide:evt').map(({ event, payload }) => ({ event, payload }));
  const call = async (method: string, params: unknown = {}) => {
    const reqId = ++id;
    listener?.({ data: { type: 'e8:ide:req', id: reqId, method, params }, origin: 'http://ide' });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'e8:ide:res' && m.id === reqId)).toBe(true));
    return posted.find((m) => m.type === 'e8:ide:res' && m.id === reqId)!;
  };
  const ready = () => vi.waitFor(() => expect(events().some((e) => e.event === 'ready')).toBe(true));
  const frame = () => (app.ticker.add.mock.calls[0][0] as () => void)();
  const gizmoLayer = () => app.stage.children.find((c) => c.label === 'gizmo');
  const gizmoShown = () => !!gizmoLayer()?.children.some((c) => c.visible);
  const key = (k: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true, ...init }));
  const edit = () => (window as unknown as { __e8edit: plugin.SceneEdit }).__e8edit;
  return { ctx, app, scenes, fiber, posted, events, call, ready, frame, gizmoLayer, gizmoShown, key, dropTarget, edit };
}

describe('scene-edit plugin', () => {
  it('shows the scene, emits ready, and answers snapshot with per-node bounds in design space', async () => {
    const { scenes, events, call, ready } = boot();
    await ready();
    expect(scenes.visible()).toEqual(['a']);
    expect(events()[0]).toEqual({ event: 'ready', payload: { scene: 'a' } });
    const res = await call('snapshot');
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ scene: 'a', selected: null, bounds: { lo: { x: 100, y: 100, w: 40, h: 40 }, hi: { x: 120, y: 120, w: 40, h: 40 } } });
  });

  it('a pointerdown over a node selects it (event selected) and the gizmo attaches; over nothing clears', async () => {
    const { edit, events, ready, gizmoShown, app } = boot();
    await ready();
    expect(app.stage.eventMode).toBe('static');
    edit().pickAndSelect(65, 65); // lo and hi overlap here: topmost wins
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'hi' } });
    expect(gizmoShown()).toBe(true);
    edit().pickAndSelect(52, 52);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
    edit().pickAndSelect(200, 200);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
    expect(gizmoShown()).toBe(false);
    expect(edit().snapshot().selected).toBe(null);
  });

  it('select over the wire moves the gizmo without re-emitting selected', async () => {
    const { edit, events, call, ready, gizmoShown, gizmoLayer } = boot();
    await ready();
    edit().pickAndSelect(65, 65);
    const n = events().length;
    expect((await call('select', { node: 'hi' })).ok).toBe(true);
    expect(events()).toHaveLength(n); // unchanged: nothing re-emitted
    await call('select', { node: 'nested' }); // no top-level view: gizmo hides, id kept, nothing echoed
    expect(events()).toHaveLength(n);
    expect(gizmoShown()).toBe(false);
    expect(edit().snapshot().selected).toBe('nested');
    await call('select', { node: 'lo' });
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
    expect(gizmoShown()).toBe(true);
    const frame = gizmoLayer()!.getChildByLabel('gizmo-frame')!;
    expect(frame.getBounds().x).toBeLessThanOrEqual(50);
    expect(edit().emitted().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
  });

  it('the gizmo re-targets the new view after a remount, and clears when the node is gone', async () => {
    const { edit, scenes, ready, frame, gizmoLayer, events } = boot();
    await ready();
    edit().pickAndSelect(52, 52);
    scenes.replace([{ id: 'a', nodes: [{ id: 'lo', type: 'box', props: { x: 600, y: 100 } }] }, DOCS[1]]);
    frame();
    expect(gizmoLayer()!.getChildByLabel('gizmo-frame')!.getBounds().x).toBeGreaterThanOrEqual(290);
    scenes.replace([{ id: 'a', nodes: [] }, DOCS[1]]);
    frame();
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
  });

  it('Delete emits remove; ] emits zorder +1; arrows emit one edit; Escape clears', async () => {
    const { edit, events, ready, key, gizmoShown } = boot();
    await ready();
    key('Delete');
    expect(events().some((e) => e.event === 'remove')).toBe(false); // nothing selected
    edit().pickAndSelect(65, 65);
    key('Delete');
    expect(events().at(-1)).toEqual({ event: 'remove', payload: { node: 'hi' } });
    key(']');
    expect(events().at(-1)).toEqual({ event: 'zorder', payload: { node: 'hi', delta: 1 } });
    key('[');
    expect(events().at(-1)).toEqual({ event: 'zorder', payload: { node: 'hi', delta: -1 } });
    key('ArrowRight');
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 120 } } });
    key('ArrowDown', { shiftKey: true });
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 130 } } });
    key('ArrowLeft', { metaKey: true }); // a browser chord, not a nudge
    key('ArrowLeft', { ctrlKey: true });
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 130 } } });
    const input = document.body.appendChild(document.createElement('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(events().at(-1)?.event).toBe('edit'); // typing in a field is not a canvas key
    key('Escape');
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
    expect(gizmoShown()).toBe(false);
  });

  it('a drop with the Explorer type emits drop with design coords; a foreign drop is ignored', async () => {
    const { events, ready, dropTarget } = boot();
    await ready();
    const drop = (dataTransfer: unknown) => {
      const e = new Event('drop', { cancelable: true });
      Object.assign(e, { clientX: 65, clientY: 65, dataTransfer });
      dropTarget.dispatchEvent(e);
      return e;
    };
    const over = new Event('dragover', { cancelable: true });
    dropTarget.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const e = drop({ getData: (t: string) => (t === 'text/x-e8-path' ? 'assets/logo.png' : ''), files: [] });
    expect(e.defaultPrevented).toBe(true);
    expect(events().at(-1)).toEqual({ event: 'drop', payload: { path: 'assets/logo.png', file: undefined, x: 130, y: 130 } });
    const file = new File(['x'], 'k.png');
    drop({ getData: () => '', files: [file] });
    expect(events().at(-1)).toEqual({ event: 'drop', payload: { path: undefined, file, x: 130, y: 130 } });
    const n = events().length;
    drop({ getData: () => '', files: [] });
    expect(events()).toHaveLength(n);
  });

  it('grid on/off redraws; an unknown scene emits error and no gizmo', async () => {
    const { scenes, call, ready } = boot();
    await ready();
    const grid = scenes.container.getChildByLabel('grid') as Graphics;
    expect(scenes.container.getChildIndex(grid)).toBe(0);
    expect(grid.getBounds().width).toBe(0);
    await call('grid', { on: true, step: 32 });
    expect(grid.getBounds().width).toBeGreaterThan(0);
    await call('grid', { on: false, step: 32 });
    expect(grid.getBounds().width).toBe(0);
    await call('grid', { on: true, step: -1 }); // a bad step falls back to 16 rather than looping forever
    expect(grid.getBounds().width).toBeGreaterThan(0);

    const bad = boot('zzz');
    await vi.waitFor(() => expect(bad.events().at(-1)?.event).toBe('error'));
    expect(bad.gizmoLayer()).toBeUndefined();
  });

  it('waits for scenes.ready before deciding; a failed boot GET is an error event', async () => {
    let settle!: () => void;
    const { scenes, events, ready } = boot('a', [], new Promise<void>((r) => { settle = r; }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events()).toEqual([]);
    scenes.replace(DOCS);
    settle();
    await ready();
    expect(scenes.visible()).toEqual(['a']);

    const failed = boot('a', [], Promise.reject(new Error('could not read the scene documents: down')));
    await vi.waitFor(() => expect(failed.events().at(-1)).toEqual({ event: 'error', payload: { message: 'could not read the scene documents: down' } }));
    expect(failed.gizmoLayer()).toBeUndefined();
  });

  it('disposing the fiber tears everything down', async () => {
    const { ctx, app, scenes, ready, fiber, key, events } = boot();
    await ready();
    await fiber.dispose();
    expect(app.stage.children.find((c) => c.label === 'gizmo')).toBeUndefined();
    expect(scenes.container.getChildByLabel('grid')).toBeNull();
    expect(app.ticker.remove).toHaveBeenCalled();
    expect((window as unknown as { __e8edit?: unknown }).__e8edit).toBeUndefined();
    const n = events().length;
    key('Escape');
    expect(events()).toHaveLength(n);
    void ctx;
  });
});
