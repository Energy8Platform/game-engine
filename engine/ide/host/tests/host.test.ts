import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fiber } from 'cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');
const MISSING_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'missing-e8yml');
const MALFORMED_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'malformed-e8yml');
const MAPPING_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'mapping-e8yml');
const NON_OBJECT_ENTRY_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'non-object-entry-e8yml');
const MISSING_NAME_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'missing-name-e8yml');
const EMPTY_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'empty-e8yml');
const NONEMPTY_WORKSPACE = join(__dirname, 'fixtures', 'nonempty-workspace');

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

/**
 * A root that is itself a project opens at boot, and its `e8.yml` problems
 * travel with the scope: they are the active composition's boot
 * diagnostics, read here the way `GET /api/composition` reads them.
 */
const bootDiagnostics = async (h: IdeHost) => (await h.ctx.composition.snapshot()).diagnostics;

/** `p`, or a rejection after `ms` — for a boot that must not sit pending on a service nobody provides. */
const within = <T>(ms: number, p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`not done in ${ms}ms`)), ms),
    ),
  ]);

/** Runs `fn`, then asserts it left no dangling unhandled promise rejection. */
async function expectNoUnhandledRejection(fn: () => Promise<void>): Promise<void> {
  const onUnhandledRejection = vi.fn();
  process.once('unhandledRejection', onUnhandledRejection);
  await fn();
  // give the event loop a turn to surface any rejection the boot sequence left dangling
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener('unhandledRejection', onUnhandledRejection);
  expect(onUnhandledRejection).not.toHaveBeenCalled();
}

describe('createIdeHost', () => {
  it('serves a health route on an ephemeral port', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('exposes the loader so composition can be read from the live graph', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    expect(typeof host.ctx.loader.entries).toBe('function');
  });

  it('serves the IDE shell at / from `ideDist`, and a 503 page when it is not built (spec §7)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'e8-host-dist-'));
    try {
      writeFileSync(join(dist, 'index.html'), '<!doctype html><title>shell</title>');
      host = await createIdeHost({ root: WORKSPACE, port: 0, ideDist: dist });
      const built = await fetch(`${host.url}/`);
      expect(built.status).toBe(200);
      expect(await built.text()).toContain('<title>shell</title>');
      await host.stop();

      host = await createIdeHost({ root: WORKSPACE, port: 0, ideDist: join(dist, 'missing') });
      const unbuilt = await fetch(`${host.url}/`);
      expect(unbuilt.status).toBe(503);
      expect(await unbuilt.text()).toContain(
        'shell not built: npm run build -w @energy8engine/ide-web',
      );
      // the API is untouched either way
      expect(await (await fetch(`${host.url}/api/health`)).json()).toEqual({ ok: true });
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('stops cleanly — the port stops answering', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    const url = host.url;
    await host.stop();
    host = undefined;
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });
});

describe('createIdeHost — boot diagnostics', () => {
  it('a root with no e8.yml is a workspace with no projects — a state, not an error — and still serves', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: MISSING_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      const state = host.ctx.workspace.state();
      expect(state).toMatchObject({
        projects: [],
        active: null,
        previewUrl: null,
        diagnostics: [],
      });
      // With no override, the templates are this repo's `engine/templates`.
      expect(state.templates.map((t) => t.id)).toContain('slot-basic');
    });
  });

  it('reports malformed YAML as a diagnostic and still serves the health route', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: MALFORMED_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      const diagnostics = await bootDiagnostics(host);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'composition' });
    });
  });

  it('reports no diagnostics when e8.yml is valid', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    expect(await bootDiagnostics(host)).toEqual([]);
    expect(host.ctx.workspace.state().diagnostics).toEqual([]);
  });

  it('reports a mapping at the top level as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: MAPPING_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      const diagnostics = await bootDiagnostics(host);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml',
      });
      expect(diagnostics[0].message).toContain('array');
    });
  });

  it('reports a non-object composition entry as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: NON_OBJECT_ENTRY_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      const diagnostics = await bootDiagnostics(host);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml[0]',
      });
    });
  });

  it('reports a composition entry with no name as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: MISSING_NAME_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      const diagnostics = await bootDiagnostics(host);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml[0]',
      });
      expect(diagnostics[0].message).toContain('name');
    });
  });

  it('treats an empty e8.yml as an empty composition, not an error', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ root: EMPTY_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);
      expect(await bootDiagnostics(host)).toEqual([]);
    });
  });

  it('gives an empty file and an explicit [] the same diagnostics and the same loader graph', async () => {
    const emptyFileHost = await createIdeHost({ root: EMPTY_E8YML_WORKSPACE, port: 0 });
    const emptyArrayHost = await createIdeHost({ root: WORKSPACE, port: 0 }); // WORKSPACE's e8.yml is `[]`
    try {
      expect(await bootDiagnostics(emptyFileHost)).toEqual([]);
      expect(await bootDiagnostics(emptyArrayHost)).toEqual([]);

      const emptyFileEntries = [...emptyFileHost.ctx.loader.entries()];
      const emptyArrayEntries = [...emptyArrayHost.ctx.loader.entries()];

      // pin the actual count on both sides — an absent `@cordisjs/plugin-include`
      // row on one and present on the other would still pass a "no error" check
      expect(emptyFileEntries).toHaveLength(0);
      expect(emptyArrayEntries).toHaveLength(0);
    } finally {
      await emptyFileHost.stop();
      await emptyArrayHost.stop();
    }
  });
});

describe('createIdeHost — a folder of projects', () => {
  let root: string;
  /** Two projects, both with a non-empty e8.yml so each open registers an include entry. */
  const twoProjects = () => {
    root = mkdtempSync(join(tmpdir(), 'e8-host-ws-'));
    for (const id of ['a-slot', 'b-slot']) {
      mkdirSync(join(root, id));
      cpSync(join(NONEMPTY_WORKSPACE, 'e8.yml'), join(root, id, 'e8.yml'));
    }
    writeFileSync(join(root, 'b-slot', 'e8.yml'), '- name: another-nonexistent-plugin\n');
    return root;
  };
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const includeEntryIds = (h: IdeHost) =>
    [...h.ctx.loader.entries()]
      .filter((e) => e.options.name === '@cordisjs/plugin-include')
      .map((e) => e.id);

  it('boots with nothing open, and does not sit pending on a service no project provides', async () => {
    host = await within(2000, createIdeHost({ root: twoProjects(), port: 0 }));
    const state = host.ctx.workspace.state();
    expect(state.active).toBeNull();
    expect(state.projects.map((p) => p.id)).toEqual(['a-slot', 'b-slot']);
    expect(await (await fetch(`${host.url}/api/workspace`)).json()).toEqual(state);
    expect(includeEntryIds(host)).toEqual([]);
  });

  it("opens a project over the wire, and the project's routes appear with it", async () => {
    host = await createIdeHost({ root: twoProjects(), port: 0 });
    expect((await fetch(`${host.url}/api/files`)).status).toBe(404);

    const res = await fetch(`${host.url}/api/workspace/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'a-slot' }),
    });
    expect(res.status).toBe(200);
    // No game in this project, so no preview — the game's URL is the scope's to give.
    expect(await res.json()).toMatchObject({ active: 'a-slot', previewUrl: null });
    expect((await fetch(`${host.url}/api/files`)).status).toBe(200);
    expect(includeEntryIds(host)).toHaveLength(1);
  });

  it("switching projects takes the first one's include entry out of the loader", async () => {
    host = await createIdeHost({ root: twoProjects(), port: 0 });
    await host.ctx.workspace.open('a-slot');
    const [first] = includeEntryIds(host);
    expect(first).toBeDefined();

    expect(await host.ctx.workspace.open('b-slot')).toEqual([]);
    const after = includeEntryIds(host);
    expect(after).toHaveLength(1);
    expect(after).not.toContain(first);
    expect(host.ctx.workspace.state().active).toBe('b-slot');
    // The old scope's routes went with it; the new scope's answer.
    expect((await fetch(`${host.url}/api/files`)).status).toBe(200);

    await host.ctx.workspace.close();
    expect(includeEntryIds(host)).toEqual([]);
    expect((await fetch(`${host.url}/api/files`)).status).toBe(404);
  });

  it('refuses an unknown id with 400 and a bad body with 400, both as diagnostics', async () => {
    host = await createIdeHost({ root: twoProjects(), port: 0 });
    const unknown = await fetch(`${host.url}/api/workspace/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'nope' }),
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      diagnostics: [{ plugin: 'workspace', where: 'nope' }],
    });

    const bad = await fetch(`${host.url}/api/workspace/open`, { method: 'POST' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ diagnostics: [{ plugin: 'workspace' }] });
    expect(host.ctx.workspace.state().active).toBeNull();
  });

  describe('POST /api/workspace/create', () => {
    let templatesDir: string;
    beforeEach(() => {
      templatesDir = mkdtempSync(join(tmpdir(), 'e8-host-tpl-'));
      mkdirSync(join(templatesDir, 'tpl', 'game'), { recursive: true });
      writeFileSync(join(templatesDir, 'tpl', 'e8.template.yml'), 'name: Tpl\n');
      cpSync(join(NONEMPTY_WORKSPACE, 'e8.yml'), join(templatesDir, 'tpl', 'e8.yml'));
      writeFileSync(join(templatesDir, 'tpl', 'game', 'spec.json'), '{ "name": "{{id}}" }');
      process.env.E8_TEMPLATES = templatesDir;
    });
    afterEach(() => {
      delete process.env.E8_TEMPLATES;
      rmSync(templatesDir, { recursive: true, force: true });
    });
    const create = (body: BodyInit | undefined) =>
      fetch(`${host!.url}/api/workspace/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

    it('creates and opens: 200 with the new project active', async () => {
      host = await createIdeHost({ root: twoProjects(), port: 0 });
      expect(host.ctx.workspace.state().templates).toEqual([
        { id: 'tpl', name: 'Tpl', description: '' },
      ]);
      const res = await create(JSON.stringify({ template: 'tpl', id: 'c-slot' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        active: 'c-slot',
        projects: [{ id: 'a-slot' }, { id: 'b-slot' }, { id: 'c-slot', name: 'c-slot' }],
      });
      expect((await fetch(`${host.url}/api/files`)).status).toBe(200);
    });

    it('refuses a bad body, an unknown template, a bad id and a taken id with 400', async () => {
      host = await createIdeHost({ root: twoProjects(), port: 0 });
      for (const body of [
        undefined,
        JSON.stringify({ template: 'tpl' }),
        JSON.stringify({ id: 1 }),
      ]) {
        const res = await create(body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ diagnostics: [{ plugin: 'workspace' }] });
      }
      for (const [body, code] of [
        [{ template: 'nope', id: 'c-slot' }, 'unknown-template'],
        [{ template: 'tpl', id: 'C' }, 'invalid'],
        [{ template: 'tpl', id: 'a-slot' }, 'exists'],
      ] as const) {
        const res = await create(JSON.stringify(body));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ diagnostics: [{ code }] });
      }
      expect(host.ctx.workspace.state().active).toBeNull();
      expect(existsSync(join(root, 'c-slot'))).toBe(false);
    });

    // Non-root only: root reads a mode-0 file, so the copy would succeed.
    it.skipIf(process.getuid?.() === 0)(
      'a copy that fails is 500, and the half-made project is gone',
      async () => {
        chmodSync(join(templatesDir, 'tpl', 'game', 'spec.json'), 0);
        host = await createIdeHost({ root: twoProjects(), port: 0 });
        const res = await create(JSON.stringify({ template: 'tpl', id: 'c-slot' }));
        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ diagnostics: [{ code: 'copy-failed' }] });
        expect(existsSync(join(root, 'c-slot'))).toBe(false);
        expect(host.ctx.workspace.state().projects.map((p) => p.id)).toEqual(['a-slot', 'b-slot']);
      },
    );
  });

  it('closes over the wire', async () => {
    host = await createIdeHost({ root: twoProjects(), port: 0 });
    await host.ctx.workspace.open('a-slot');
    const res = await fetch(`${host.url}/api/workspace/close`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: null, previewUrl: null });
  });

  it('refuses a cross-origin WRITE with 403 (spec §6.2); the IDE’s own origins and every read pass', async () => {
    host = await createIdeHost({ root: twoProjects(), port: 0 });
    const open = (origin: string) =>
      fetch(`${host!.url}/api/workspace/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ id: 'a-slot' }),
      });
    // A page on another origin — the game's preview, or anything else the
    // browser has open — cannot move the workspace.
    const evil = await open('http://evil.example');
    expect(evil.status).toBe(403);
    expect(await evil.json()).toMatchObject({
      diagnostics: [
        {
          plugin: 'server',
          where: '/api/workspace/open',
          message: 'cross-origin request from http://evil.example refused',
        },
      ],
    });
    expect(host.ctx.workspace.state().active).toBeNull();
    // Reads stay open to it.
    const read = await fetch(`${host.url}/api/workspace`, {
      headers: { origin: 'http://evil.example' },
    });
    expect(read.status).toBe(200);
    // The vite dev shell (5680) forwards `Origin` unchanged through its proxy.
    expect((await open('http://127.0.0.1:5680')).status).toBe(200);
    expect(host.ctx.workspace.state().active).toBe('a-slot');
    // The host's own origin, as a browser stamps it on a same-origin POST.
    await host.ctx.workspace.close();
    expect((await open(host.url)).status).toBe(200);
    expect(host.ctx.workspace.state().active).toBe('a-slot');
  });
});

describe('createIdeHost — boot failure cleanup', () => {
  it('disposes the partially built context when a later boot step throws', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    const takenPort = Number(new URL(host.url).port);

    // The server binds right after the loader now (a project's include
    // entry only exists once `workspace` opens one, which comes later), so
    // the failed attempt holds nothing but its root context — and a root
    // fiber's `dispose()` is `restart()` (cordis rc.8, measured), which is
    // what this spy sees. `host` above is still up: its own dispose runs in
    // `afterEach`, after the spy is gone.
    const disposeSpy = vi.spyOn(Fiber.prototype, 'restart');
    await expect(createIdeHost({ root: NONEMPTY_WORKSPACE, port: takenPort })).rejects.toThrow(
      'No open ports available',
    );

    // the failed attempt's own root context must have been torn down
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
});
