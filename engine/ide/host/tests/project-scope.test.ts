import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import * as files from '../src/plugins/files';
import * as projectScope from '../src/plugins/project-scope';
import { bootProjectScope } from '../src/plugins/project-scope';
import * as rpc from '../src/plugins/rpc';
import * as workspace from '../src/plugins/workspace';

const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');
const WEB_ROOT = join(__dirname, 'fixtures', 'dev-game-web');

let ctx: Context | undefined;
let dir: string | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** What `createIdeHost` puts on the root before any project: loader, server, rpc. */
async function root(): Promise<Context> {
  ctx = new Context();
  await ctx.plugin(Loader);
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(rpc);
  return ctx;
}

const url = (c: Context) => `http://${c.server.host}:${c.server.port}`;

function project(e8yml = '- name: some-nonexistent-plugin-xyz\n'): string {
  dir = mkdtempSync(join(tmpdir(), 'e8-scope-'));
  writeFileSync(join(dir, 'e8.yml'), e8yml);
  return dir;
}

const includeEntries = (c: Context) =>
  [...c.loader.entries()].filter((e) => e.options.name === '@cordisjs/plugin-include');

/** The frames a fresh `/ide` client is greeted with, once the snapshot has arrived. */
async function greeting(c: Context): Promise<ServerMessage[]> {
  const socket = new WebSocket(`${url(c).replace('http', 'ws')}/ide`);
  const frames: ServerMessage[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
  await new Promise((resolve) => socket.once('open', resolve));
  await expect.poll(() => frames.some((m) => m.type === 'snapshot')).toBe(true);
  // Retained host frames follow the snapshot in the same tick; give it one more turn.
  await new Promise((resolve) => setImmediate(resolve));
  socket.close();
  return frames;
}

describe('project-scope: one project, one scope', () => {
  it("registers the project's include entry, routes and services, and takes them ALL down on dispose", async () => {
    const c = await root();
    expect((await fetch(`${url(c)}/api/files`)).status).toBe(404);

    const handle = await bootProjectScope(c, project(), 0);
    expect(handle.previewUrl).toBeNull(); // no game/ here — nothing to preview
    const [entry] = includeEntries(c);
    expect(entry).toBeDefined();
    expect((await fetch(`${url(c)}/api/files`)).status).toBe(200);
    expect(c.get('composition')).toBeDefined();

    await handle.dispose();
    // The include entry belongs to the ROOT tree and would outlive the
    // scope on its own — the scope's effect is what removes it.
    expect(includeEntries(c).map((e) => e.id)).not.toContain(entry.id);
    expect((await fetch(`${url(c)}/api/files`)).status).toBe(404);
    expect(c.get('composition')).toBeUndefined();
  });

  it("an e8.yml that is not a composition is the scope's boot diagnostic, and the project still opens", async () => {
    const c = await root();
    await bootProjectScope(c, project('foo: bar\n'), 0);
    const snapshot = await c.get('composition')!.snapshot();
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ plugin: 'composition', where: 'e8.yml' }),
    ]);
    expect(includeEntries(c)).toEqual([]);
  });
});

describe('project-scope: the game', () => {
  it('boots dev-game off game/spec.json — the project serves its own page and spins', async () => {
    const c = await root();
    const cwd = project('[]\n');
    cpSync(GAME, join(cwd, 'game'), { recursive: true });
    cpSync(WEB_ROOT, cwd, { recursive: true });

    const handle = await bootProjectScope(c, cwd, 0);
    expect(c.get('devGameRoot')).toBeDefined();
    expect(handle.previewUrl).toBe(url(c)); // the game is on the root server until Task 4
    const page = await fetch(`${url(c)}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('dev-game fixture root');
    const spin = await fetch(`${url(c)}/api/spin`, { method: 'POST' });
    expect(spin.status).toBe(200);
  }, 15_000);

  it('a project with no game/ is open, silently, without one', async () => {
    const c = await root();
    const handle = await bootProjectScope(c, project('[]\n'), 0);
    expect(c.get('devGameRoot')).toBeUndefined();
    expect(handle.previewUrl).toBeNull();
    expect((await greeting(c)).filter((m) => m.type === 'game-diagnostics')).toEqual([]);
  });

  it('a spec.json that cannot be used is reported to the panel, and the project is open without a game', async () => {
    const c = await root();
    const cwd = project('[]\n');
    mkdirSync(join(cwd, 'game'));
    writeFileSync(join(cwd, 'game', 'spec.json'), JSON.stringify({ betLevels: [1] }));

    const handle = await bootProjectScope(c, cwd, 0);
    expect(c.get('devGameRoot')).toBeUndefined();
    expect(handle.previewUrl).toBeNull();
    expect((await fetch(`${url(c)}/api/files`)).status).toBe(200);
    const frames = await greeting(c);
    expect(frames.filter((m) => m.type === 'game-diagnostics')).toEqual([
      expect.objectContaining({
        source: 'host',
        diagnostics: [expect.objectContaining({ plugin: 'dev-game', where: 'game/spec.json' })],
      }),
    ]);
  });
});

describe('project-scope: a boot that rejects', () => {
  /**
   * Measured before this test was written (see task-2-report.md): no
   * project-shaped failure rejects `bootProjectScope` — a missing cwd, an
   * `e8.yml` that is a directory, an unparsable `spec.json`, a `game` that
   * is a file, and an `e8-server` that cannot start ALL resolve, each as a
   * diagnostic, because every cwd-bound plugin was built to degrade that
   * way. What does reject is a plugin whose `apply` throws — and the one
   * real way to make `files` throw is a `files` service the root already
   * holds (cordis refuses a second provider). Synthetic in cause, real in
   * mechanism: the same path a future plugin that throws would take.
   */
  it('through the real factory: the workspace records it, nothing is active, the half-built scope is gone', async () => {
    const c = await root();
    const cwd = project('[]\n');
    await c.plugin(files, { cwd });
    await c.plugin(workspace, { root: cwd, scope: (r, p) => bootProjectScope(r, p, 0) });

    const state = c.workspace.state();
    expect(state.active).toBeNull();
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        plugin: 'workspace',
        message: expect.stringMatching(/did not start: service "files" has been registered/),
      }),
    ]);
    // The plugins the scope managed to register before the throw went with
    // it, and so did the scope's own fiber: cordis drops a plugin from the
    // registry once its last fiber is disposed (`Fiber`'s dispose effect),
    // and a FAILED fiber nobody disposes is still counted — so this is red
    // without `bootProjectScope`'s explicit `fiber.dispose()` on rejection.
    expect(c.get('composition')).toBeUndefined();
    expect(c.get('project')).toBeUndefined();
    expect(c.registry.get(projectScope)).toBeUndefined();
  });
});
