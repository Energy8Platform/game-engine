import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes, PINS, pinPoint } from '../src/node-types';
import { container, image, scene, text, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

/** Design 480×288 — `first-slot`'s. */
function boot(docs: SceneDoc[] = []) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene, text]) nodeTypes.register(t);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 480, height: 288 },
    nodeTypes,
    loader,
    ctx,
    report,
  });
  scenes.replace(docs);
  return { report, scenes, view: (node: string) => scenes.view({ scene: 'a', node })! };
}

const BAR = { top: 0, right: 0, bottom: 100, left: 0 };

/**
 * The safe rect in design units, by hand, for the two viewports the suite
 * uses — both with a 100 px bar at the bottom and a 480×288 design under
 * `contain`. The rect is the design's height exactly (the bar only ever
 * limits the height here), so top/bottom are 0/288 and the centre is
 * (240, 144); the width overflows the design symmetrically.
 *
 * 480×288: safe 480×188 → scale 188/288 = 47/72; x = 240(1 − s) = 6000/72;
 *   left = −x/s = −6000/47, right = left + 480/s = 28560/47.
 * 1280×720: safe 1280×620 → scale 620/288 = 155/72; x = (1280 − 480s)/2;
 *   left = −x/s = 240 − 640/s = −8880/155, right = left + 1280/s = 83280/155.
 */
const RECTS = {
  small: { w: 480, h: 288, left: -6000 / 47, right: 28560 / 47 },
  big: { w: 1280, h: 720, left: -8880 / 155, right: 83280 / 155 },
};

/** Expected `(x, y)` per pin, per rect — a literal table, not a mirror of `pinPoint`. */
const EXPECTED: Record<keyof typeof RECTS, Record<string, [number, number]>> = {
  small: {
    'top-left': [-6000 / 47, 0],
    top: [240, 0],
    'top-right': [28560 / 47, 0],
    left: [-6000 / 47, 144],
    center: [240, 144],
    right: [28560 / 47, 144],
    'bottom-left': [-6000 / 47, 288],
    bottom: [240, 288],
    'bottom-right': [28560 / 47, 288],
  },
  big: {
    'top-left': [-8880 / 155, 0],
    top: [240, 0],
    'top-right': [83280 / 155, 0],
    left: [-8880 / 155, 144],
    center: [240, 144],
    right: [83280 / 155, 144],
    'bottom-left': [-8880 / 155, 288],
    bottom: [240, 288],
    'bottom-right': [83280 / 155, 288],
  },
};

describe('pinPoint', () => {
  it('names the nine points of a rect', () => {
    const r = { left: 10, top: 20, right: 110, bottom: 220 };
    expect(PINS).toHaveLength(9);
    expect(Object.fromEntries(PINS.map((p) => [p, pinPoint(p, r)]))).toEqual({
      'top-left': { x: 10, y: 20 },
      top: { x: 60, y: 20 },
      'top-right': { x: 110, y: 20 },
      left: { x: 10, y: 120 },
      center: { x: 60, y: 120 },
      right: { x: 110, y: 120 },
      'bottom-left': { x: 10, y: 220 },
      bottom: { x: 60, y: 220 },
      'bottom-right': { x: 110, y: 220 },
    });
  });
});

describe('pin', () => {
  const nine = (): SceneDoc => ({
    id: 'a',
    nodes: PINS.map((pin) => ({ id: pin, type: 'container', props: { pin } })),
  });

  it('before the first resize a pinned node sits at its bare x/y; the first resize places it', () => {
    const { scenes, view } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: { pin: 'bottom', x: 0, y: -24 } }] },
    ]);
    expect([view('n').x, view('n').y]).toEqual([0, -24]);
    expect(scenes.fit()).toBeNull();
    scenes.resize(1280, 720, BAR);
    expect(view('n').x).toBeCloseTo(240, 10);
    expect(view('n').y).toBeCloseTo(264, 10);
    expect(scenes.fit()?.viewport.bottom).toBeCloseTo(288, 10);
  });

  for (const name of ['small', 'big'] as const) {
    const r = RECTS[name];
    it(`each of the nine pins at ${r.w}×${r.h} with a 100 px bar lands on its point of the safe rect (${name})`, () => {
      const { scenes, view } = boot([nine()]);
      const fit = scenes.resize(r.w, r.h, BAR);
      expect(fit.viewport.left).toBeCloseTo(r.left, 10);
      expect(fit.viewport.right).toBeCloseTo(r.right, 10);
      for (const pin of PINS) {
        const [x, y] = EXPECTED[name][pin];
        expect(view(pin).x, `${pin}.x`).toBeCloseTo(x, 10);
        expect(view(pin).y, `${pin}.y`).toBeCloseTo(y, 10);
      }
    });
  }

  it('x/y are offsets from the point, and anchor still applies: a bottom text with anchor 0.5 centres on the bottom edge', () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [{ id: 't', type: 'text', props: { text: 'hi', pin: 'bottom', x: 0, y: -24, anchor: 0.5 } }],
      },
    ]);
    scenes.resize(1280, 720, BAR);
    const t = view('t') as Container & { anchor: { x: number; y: number } };
    expect(t.x).toBeCloseTo(240, 10);
    expect(t.y).toBeCloseTo(264, 10);
    expect([t.anchor.x, t.anchor.y]).toEqual([0.5, 0.5]);
    // top-left with an offset: the point plus the offset.
    const { scenes: s2, view: v2 } = boot([
      { id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'k.png', pin: 'top-left', x: 8, y: 8 } }] },
    ]);
    s2.resize(1280, 720, BAR);
    expect(v2('i').x).toBeCloseTo(-8880 / 155 + 8, 10);
    expect(v2('i').y).toBeCloseTo(8, 10);
  });

  it('a resize moves a pinned node and leaves an unpinned one where it was', () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'p', type: 'container', props: { pin: 'right', x: -10 } },
          { id: 'u', type: 'container', props: { x: 10, y: 20 } },
        ],
      },
    ]);
    scenes.resize(480, 288, BAR);
    expect(view('p').x).toBeCloseTo(28560 / 47 - 10, 10);
    expect([view('u').x, view('u').y]).toEqual([10, 20]);
    scenes.resize(1280, 720, BAR);
    expect(view('p').x).toBeCloseTo(83280 / 155 - 10, 10);
    expect(view('p').y).toBeCloseTo(144, 10);
    expect([view('u').x, view('u').y]).toEqual([10, 20]);
  });

  it('a pinned child is a warning once and stays absolute', () => {
    const { report, scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'wrap',
            type: 'container',
            props: {},
            children: [{ id: 'kid', type: 'container', props: { pin: 'bottom', x: 5, y: 6 } }],
          },
        ],
      },
    ]);
    scenes.resize(1280, 720, BAR);
    scenes.resize(480, 288, BAR);
    expect([view('kid').x, view('kid').y]).toEqual([5, 6]);
    const warnings = report.mock.calls.filter(([d]) => d.severity === 'warning');
    expect(warnings).toEqual([
      [
        {
          severity: 'warning',
          plugin: 'scenes',
          where: 'a/kid',
          message: 'pin on a nested node "kid" is ignored',
          fix: 'pin only top-level nodes',
        },
      ],
    ]);
    // A live patch pinning a child is the same warning; the child still does not move.
    expect(scenes.setProps({ scene: 'a', node: 'kid' }, { pin: 'top' })).toBe(true);
    expect([view('kid').x, view('kid').y]).toEqual([5, 6]);
    expect(report.mock.calls.filter(([d]) => d.severity === 'warning')).toHaveLength(2);
  });

  it('setProps({ pin }) pins a top-level node now, and setProps({ pin: "" }) makes it absolute again', () => {
    const { scenes, view } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: { pin: 'bottom', x: 0, y: -24 } }] },
    ]);
    scenes.resize(1280, 720, BAR);
    expect(view('n').y).toBeCloseTo(264, 10);
    expect(scenes.setProps({ scene: 'a', node: 'n' }, { pin: '' })).toBe(true);
    expect([view('n').x, view('n').y]).toEqual([0, -24]);
    scenes.resize(480, 288, BAR);
    expect([view('n').x, view('n').y]).toEqual([0, -24]);
    expect(scenes.setProps({ scene: 'a', node: 'n' }, { pin: 'top-right' })).toBe(true);
    expect(view('n').x).toBeCloseTo(28560 / 47, 10);
    expect(view('n').y).toBeCloseTo(-24, 10);
  });

  it('a remount after a resize places pinned nodes with the last fit', () => {
    const { scenes, view } = boot([{ id: 'a', nodes: [] }]);
    scenes.resize(1280, 720, BAR);
    scenes.replace([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: { pin: 'bottom-right' } }] }]);
    expect(view('n').x).toBeCloseTo(83280 / 155, 10);
    expect(view('n').y).toBeCloseTo(288, 10);
  });

  it('a resize moves a pinned node and touches nothing else: a shown host stays shown, a tweened alpha stays', async () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'host', type: 'scene', props: { scene: 'b', pin: 'bottom', visible: false } },
          { id: 'n', type: 'container', props: { pin: 'top' } },
        ],
      },
      { id: 'b', nodes: [] },
    ]);
    scenes.resize(1280, 720, BAR);
    await scenes.show('a');
    await scenes.show('b');
    expect(view('host').visible).toBe(true);
    view('n').alpha = 0.3;
    scenes.resize(480, 288, BAR);
    expect(view('host').visible).toBe(true);
    expect(view('host').y).toBeCloseTo(288, 10);
    expect(view('n').alpha).toBe(0.3);
    expect(view('n').x).toBeCloseTo(240, 10);
  });

  it('pins apply to a document\'s own top-level mount; an embedded copy is laid out by its host, silently', () => {
    const { report, scenes, view } = boot([
      { id: 'a', nodes: [{ id: 'host', type: 'scene', props: { scene: 'b', x: 100 } }] },
      { id: 'b', nodes: [{ id: 'n', type: 'container', props: { pin: 'bottom', x: 0, y: -24 } }] },
    ]);
    scenes.resize(1280, 720, BAR);
    const own = scenes.view({ scene: 'b', node: 'n' })!;
    expect(own.x).toBeCloseTo(240, 10);
    expect(own.y).toBeCloseTo(264, 10);
    // The host's view IS the embedded document's container.
    const copy = view('host').children[0]!;
    expect(copy.label).toBe('n');
    expect([copy.x, copy.y]).toEqual([0, -24]);
    expect(report).not.toHaveBeenCalled();
    // Patching the pin through the shared id warns for neither copy: the node IS a root of its document.
    expect(scenes.setProps({ scene: 'b', node: 'n' }, { pin: 'top' })).toBe(true);
    expect(report).not.toHaveBeenCalled();
    expect(own.y).toBeCloseTo(-24, 10);
    expect([copy.x, copy.y]).toEqual([0, -24]);
  });

  it('a pin the schema does not know fails the node, as any other bad common prop', () => {
    const { report, view } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: { pin: 'middle' } }] },
    ]);
    expect(view('n')).toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', where: 'a/n' }));
  });
});
