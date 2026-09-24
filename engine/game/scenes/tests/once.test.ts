/**
 * `scenes.once(ref)` — a scene node's own `once` (a strip's one-shot), awaited
 * by whoever asked, on every mounted copy of the node.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

/** A `once` that settles only when the test says, one release per call. */
function gatedType() {
  const releases: (() => void)[] = [];
  const played: Container[] = [];
  let throwOn = -1;
  const t = {
    type: 'clip',
    schema: Schema.object({}),
    mount: () => new Container(),
    once: vi.fn((view: Container) => {
      played.push(view);
      if (played.length - 1 === throwOn) return Promise.reject(new Error('broke'));
      return new Promise<void>((r) => releases.push(r));
    }),
  };
  return { t, releases, played, throwNth: (n: number) => (throwOn = n) };
}

function boot(docs: SceneDoc[], extra: ReturnType<typeof gatedType>['t']) {
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  nodeTypes.register(extra);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes,
    loader,
    ctx: new Context(),
    report,
  });
  scenes.replace(docs);
  return { scenes, report };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const stage: SceneDoc = { id: 'stage', nodes: [{ id: 'attack', type: 'clip', props: {} }] };

describe('scenes.once', () => {
  it('plays the node through its type’s once and settles only when that does — true', async () => {
    const g = gatedType();
    const { scenes } = boot([stage], g.t);
    let done: boolean | undefined;
    void scenes.once({ scene: 'stage', node: 'attack' }).then((v) => (done = v));
    await tick();
    expect(g.played).toEqual([scenes.view({ scene: 'stage', node: 'attack' })]);
    expect(done).toBeUndefined();
    g.releases.forEach((r) => r());
    await tick();
    expect(done).toBe(true);
  });

  it('plays a node of a document that is not shown — the caller owns visible', async () => {
    const g = gatedType();
    const { scenes } = boot([stage], g.t);
    expect(scenes.visible()).toEqual([]);
    const p = scenes.once({ scene: 'stage', node: 'attack' });
    await tick();
    g.releases.forEach((r) => r());
    await expect(p).resolves.toBe(true);
  });

  it('plays every mounted copy of a nested document, and waits for all of them', async () => {
    const g = gatedType();
    const host: SceneDoc = { id: 'host', nodes: [{ id: 'inner', type: 'scene', props: { scene: 'stage' } }] };
    const { scenes } = boot([stage, host], g.t);
    let done = false;
    void scenes.once({ scene: 'stage', node: 'attack' }).then(() => (done = true));
    await tick();
    expect(g.played.length).toBe(2);
    g.releases[0]();
    await tick();
    expect(done).toBe(false);
    g.releases[1]();
    await tick();
    expect(done).toBe(true);
  });

  it('a copy whose once throws is reported, and the others still play — true', async () => {
    const g = gatedType();
    g.throwNth(0);
    const host: SceneDoc = { id: 'host', nodes: [{ id: 'inner', type: 'scene', props: { scene: 'stage' } }] };
    const { scenes, report } = boot([stage, host], g.t);
    const p = scenes.once({ scene: 'stage', node: 'attack' });
    await tick();
    expect(g.played.length).toBe(2);
    g.releases.forEach((r) => r());
    await expect(p).resolves.toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('failed to play: broke') }),
    );
  });

  it('a type without once answers false and reports nothing', async () => {
    const g = gatedType();
    const doc: SceneDoc = { id: 'stage', nodes: [{ id: 'bg', type: 'container', props: {} }] };
    const { scenes, report } = boot([doc], g.t);
    await expect(scenes.once({ scene: 'stage', node: 'bg' })).resolves.toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it('a node nothing mounted answers false with an error at <scene>/<node>', async () => {
    const g = gatedType();
    const { scenes, report } = boot([stage], g.t);
    await expect(scenes.once({ scene: 'stage', node: 'nope' })).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'stage/nope',
        message: 'node "nope" is not mounted in scene "stage" — nothing to play',
      }),
    );
  });
});
