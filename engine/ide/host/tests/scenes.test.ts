import { cpSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Server from '@cordisjs/plugin-server';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';
import { checkScenes } from '../src/plugins/scenes';

const cfg = (over: Record<string, unknown> = {}) => ({
  layers: [{ id: 'bg' }, { id: 'reels' }],
  scenes: { base_game: { layers: ['bg', 'reels'] } },
  ...over,
});

describe('checkScenes', () => {
  it('is silent when every scene is a stage and every stage a scene, on known layers', () => {
    expect(checkScenes(cfg(), ['base_game'])).toEqual([]);
  });
  it('a scene the script has no stage for is a warning', () => {
    const d = checkScenes(cfg({ scenes: { base_game: { layers: [] }, bonus: { layers: [] } } }), [
      'base_game',
    ]);
    expect(d).toEqual([
      expect.objectContaining({ severity: 'warning', plugin: 'scenes', where: 'bonus' }),
    ]);
  });
  it('a stage with no scene is a warning', () => {
    const d = checkScenes(cfg(), ['base_game', 'free_spins']);
    expect(d).toEqual([expect.objectContaining({ severity: 'warning', where: 'free_spins' })]);
  });
  it('a scene naming a layer that is not declared is an error; a duplicate layer id is an error', () => {
    const d = checkScenes(cfg({ scenes: { base_game: { layers: ['ui'] } } }), ['base_game']);
    expect(d[0]).toMatchObject({ severity: 'error', where: 'base_game' });
    expect(d[0].message).toContain('"ui"');
    const dup = checkScenes(cfg({ layers: [{ id: 'a' }, { id: 'a' }], scenes: {} }), []);
    expect(dup).toEqual([expect.objectContaining({ severity: 'error', where: 'a' })]);
  });
  it('a malformed layers or scenes value is read as empty, never thrown on', () => {
    expect(checkScenes({ layers: 'bg', scenes: 'x' }, [])).toEqual([]);
    expect(checkScenes({ layers: [null], scenes: { a: null } }, ['a'])).toEqual([]);
  });
  it('a config with no scenes and no layers (an older stage row) says nothing', () => {
    expect(checkScenes({ design: { width: 1, height: 1 } }, ['base_game'])).toEqual([]);
  });
});

/** `project-e8-base` copied to a temp dir with the repo's packages linked in — see `runtime-assets.test.ts`'s `e8BaseWorkspace`. */
function e8BaseWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ide-host-scenes-'));
  cpSync(join(__dirname, 'fixtures', 'project-e8-base'), dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
    join(dir, 'node_modules', '@energy8engine'),
    'dir',
  );
  return dir;
}

const post = (url: string, body: unknown) =>
  fetch(`${url}/api/scenes/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

describe('POST /api/scenes/preview', () => {
  it('pushes the scene to a preview /ide socket; says so when no preview is running', async () => {
    host = await createIdeHost({ root: e8BaseWorkspace(), port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, { accept: ['game-diagnostics'] });
    const socket = new WebSocket(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);
    const frames: ServerMessage[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));

    // No `dev-game` in this project (no game/ dir): the frame still goes
    // out, and the answer says nobody is there to show it.
    const res = await post(host.url, { scene: 'base_game' });
    expect(res.status).toBe(200);
    expect((await res.json()).diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', plugin: 'scenes', where: 'base_game' }),
    ]);
    await expect.poll(() => frames).toContainEqual({ type: 'scene-preview', scene: 'base_game' });

    // With a preview up, a clean 200.
    host.ctx.provide('devGamePreview', { url: 'http://127.0.0.1:1' });
    const ok = await post(host.url, { scene: 'base_game' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).diagnostics).toEqual([]);
    socket.close();
  });

  it('400s a body that is not { scene: string }', async () => {
    host = await createIdeHost({ root: e8BaseWorkspace(), port: 0 });
    for (const body of [{}, { scene: '' }, { scene: 5 }, 'not json']) {
      const res = await post(host.url, body);
      expect(res.status).toBe(400);
      expect((await res.json()).diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', plugin: 'scenes' }),
      ]);
    }
  });
});
