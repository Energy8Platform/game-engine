/**
 * `game-spec`'s host half (Task 7): `GET /api/spec` answers `game/spec.json`
 * exactly as written — `{ spec }`, `null` when the file is absent or not
 * JSON — on the root server and, through `attachGameRoutes`, a second
 * server standing in for the game preview (the same split
 * `dev-game.test.ts`'s `bare()`/`preview` and `symbols.test.ts`'s "serves
 * … on the preview server too" both exercise).
 *
 * Composed bare — `Server` + the plugin with `{ cwd }`, not through
 * `createIdeHost` — because this plugin only injects `server` and reads
 * the file directly; a bare root is the whole fixture it needs.
 *
 * `fixtures/project-simple` has no `game/spec.json` at all: other suites
 * (`project.test.ts`, `schema.test.ts`, `runtime-assets.test.ts`) boot the
 * FULL host against it and rely on that absence to keep `readGameConfig`
 * (`project-scope.ts`) from booting `dev-game` — adding a `spec.json`
 * there to serve this file's "descriptive" case would change what those
 * suites boot. `fixtures/project-flow`'s own `spec.json` — `{ symbols,
 * actions }`, no `id`/`grid`/math — is already exactly the "descriptive,
 * not a full GameSpec" shape the brief means, and read-only here, so it
 * stands in instead.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import { afterEach, describe, expect, it } from 'vitest';
import * as gameSpecPlugin from '../src/plugins/game-spec';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

let ctx: Context | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
});

/** A bare root carrying exactly what `game-spec` injects: the IDE's own server. */
async function bare(cwd: string): Promise<Context> {
  ctx = new Context();
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(gameSpecPlugin, { cwd });
  return ctx;
}

const rootUrl = (c: Context) => `http://${c.server.host}:${c.server.port}`;
const get = async (base: string): Promise<{ spec: unknown }> =>
  (await fetch(`${base}/api/spec`)).json() as Promise<{ spec: unknown }>;

describe('GET /api/spec', () => {
  it('answers game/spec.json as written — a full GameSpec fixture', async () => {
    const c = await bare(fixture('project-spec'));
    const body = await get(rootUrl(c));
    expect(body).toEqual({
      spec: expect.objectContaining({ id: 'spec-slot', type: 'slot' }),
    });
  });

  it('answers game/spec.json as written — a descriptive, non-GameSpec fixture', async () => {
    const c = await bare(fixture('project-flow'));
    const body = await get(rootUrl(c));
    expect(body).toEqual({
      spec: { symbols: [{ id: '1', name: 'Cherry' }, { id: '2', name: 'Bell' }], actions: { spin: {} } },
    });
  });

  it('answers { spec: null } when game/spec.json is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-game-spec-absent-'));
    const c = await bare(dir);
    expect(await get(rootUrl(c))).toEqual({ spec: null });
  });

  it('answers { spec: null } when game/spec.json is not JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-game-spec-bad-'));
    mkdirSync(join(dir, 'game'), { recursive: true });
    writeFileSync(join(dir, 'game', 'spec.json'), '{ not json');
    const c = await bare(dir);
    expect(await get(rootUrl(c))).toEqual({ spec: null });
  });

  it('serves GET /api/spec on the preview server too, through attachGameRoutes', async () => {
    const c = await bare(fixture('project-spec'));
    const fiber = c.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    c.gameSpecHost.attachGameRoutes(fiber.ctx.server);
    const body = await get(`http://${fiber.ctx.server.host}:${fiber.ctx.server.port}`);
    expect(body).toEqual({ spec: expect.objectContaining({ id: 'spec-slot' }) });
  });
});
