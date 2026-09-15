import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Context } from 'cordis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as workspace from '../src/plugins/workspace';
import type { ProjectScopeHandle } from '../src/plugins/workspace';

let root: string;
/** Empty unless a test fills it with `templates()`. */
let templatesDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'e8-ws-'));
  templatesDir = mkdtempSync(join(tmpdir(), 'e8-tpl-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(templatesDir, { recursive: true, force: true });
});

function project(id: string, spec?: unknown) {
  mkdirSync(join(root, id, 'game'), { recursive: true });
  writeFileSync(join(root, id, 'e8.yml'), '[]\n');
  if (spec !== undefined) writeFileSync(join(root, id, 'game', 'spec.json'), JSON.stringify(spec));
}

/** A scope that records its life; `fail` makes boot reject. */
function fakeScope(
  log: string[],
  opts: {
    fail?: boolean;
    failClose?: boolean;
    slowClose?: boolean;
    previewUrl?: string | null;
  } = {},
) {
  return async (_ctx: Context, cwd: string): Promise<ProjectScopeHandle> => {
    log.push(`open ${cwd}`);
    if (opts.fail) throw new Error('boot failed');
    return {
      previewUrl: opts.previewUrl ?? 'http://127.0.0.1:5681',
      dispose: async () => {
        if (opts.slowClose) await new Promise((r) => setTimeout(r, 20));
        if (opts.failClose) throw new Error('teardown failed');
        log.push(`close ${cwd}`);
      },
    };
  };
}

/** `existsSync` follows links; this sees a dangling or a live symlink alike. */
function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

async function boot(log: string[] = [], opts?: Parameters<typeof fakeScope>[1]) {
  const ctx = new Context();
  await ctx.plugin(workspace, { root, templatesDir, scope: fakeScope(log, opts) });
  return ctx;
}

/**
 * `good/` — a real template: manifest, `{{id}}` where a project id belongs,
 * a `src/x.ts` whose `{{id}}` is code and must survive, a `node_modules`
 * that must not travel, and two symlinks (a file, a directory) that must
 * not either. `nomanifest/`, `noname/`, `noe8yml/` and `malformed/` are
 * the four ways a directory fails to be a template — the first silently,
 * the other three with a diagnostic each.
 */
const EXCLUDED_TEMPLATES = ['noname', 'noe8yml', 'malformed'];
function templates() {
  const good = join(templatesDir, 'good');
  mkdirSync(join(good, 'game'), { recursive: true });
  mkdirSync(join(good, 'src'));
  mkdirSync(join(good, 'node_modules'));
  writeFileSync(join(good, 'e8.template.yml'), 'name: Good\ndescription: A good one\n');
  writeFileSync(join(good, 'e8.yml'), '[]\n');
  writeFileSync(
    join(good, 'package.json'),
    '{\n  "name": "e8-template-good",\n  "private": true\n}\n',
  );
  writeFileSync(join(good, 'game', 'spec.json'), '{ "id": "{{id}}", "name": "{{id}}" }\n');
  writeFileSync(join(good, 'index.html'), '<title>{{id}} — e8 dev</title>\n');
  writeFileSync(join(good, 'src', 'x.ts'), 'export const placeholder = "{{id}}";\n');
  writeFileSync(join(good, 'node_modules', 'junk'), 'junk');
  symlinkSync(join(good, 'src', 'x.ts'), join(good, 'link.ts'));
  symlinkSync(join(good, 'src'), join(good, 'linkdir'));
  mkdirSync(join(templatesDir, 'nomanifest'));
  for (const id of EXCLUDED_TEMPLATES) mkdirSync(join(templatesDir, id));
  writeFileSync(join(templatesDir, 'noname', 'e8.template.yml'), 'description: nameless\n');
  writeFileSync(join(templatesDir, 'noname', 'e8.yml'), '[]\n');
  writeFileSync(join(templatesDir, 'noe8yml', 'e8.template.yml'), 'name: No composition\n');
  writeFileSync(join(templatesDir, 'malformed', 'e8.template.yml'), 'name: [unclosed\n');
  writeFileSync(join(templatesDir, 'malformed', 'e8.yml'), '[]\n');
}

/** Non-root only: root writes through any mode, so a 0/0o444 file stages nothing. */
const notRoot = process.getuid?.() !== 0;

describe('workspace: what is a project', () => {
  it('lists directories with e8.yml, by id, sorted; nothing else', async () => {
    project('b-slot');
    project('a-slot');
    mkdirSync(join(root, 'not-a-project'));
    writeFileSync(join(root, 'e8.yml.txt'), '');
    mkdirSync(join(root, 'file-named-e8'));
    writeFileSync(join(root, 'file-named-e8', 'e8.yml'), '[]');
    mkdirSync(join(root, 'dir-e8yml', 'e8.yml'), { recursive: true }); // e8.yml is a DIRECTORY here
    const ctx = await boot();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual([
      'a-slot',
      'b-slot',
      'file-named-e8',
    ]);
    ctx.workspace.state().projects.length = 0; // a caller's copy, not the service's list
    expect(ctx.workspace.state().projects).toHaveLength(3);
  });

  it('does not follow a symlinked directory', async () => {
    project('real');
    symlinkSync(join(root, 'real'), join(root, 'link'));
    const ctx = await boot();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['real']);
  });

  it('names a project from game/spec.json, and by id without one', async () => {
    project('named', { id: 'x', name: 'First Slot' });
    project('unnamed');
    project('bad-name', { name: 42 });
    project('bad-json');
    writeFileSync(join(root, 'bad-json', 'game', 'spec.json'), '{');
    const ctx = await boot();
    const byId = Object.fromEntries(ctx.workspace.state().projects.map((p) => [p.id, p.name]));
    expect(byId).toEqual({
      named: 'First Slot',
      unnamed: 'unnamed',
      'bad-name': 'bad-name',
      'bad-json': 'bad-json',
    });
    expect(ctx.workspace.state().diagnostics).toEqual([]);
  });

  it('a root that is itself a project is the one project, opened at boot', async () => {
    writeFileSync(join(root, 'e8.yml'), '[]');
    mkdirSync(join(root, 'game'));
    writeFileSync(join(root, 'game', 'spec.json'), JSON.stringify({ name: 'Solo' }));
    project('child-ignored');
    const log: string[] = [];
    const ctx = await boot(log);
    const state = ctx.workspace.state();
    expect(state.projects.map((p) => [p.id, p.name])).toEqual([[basename(root), 'Solo']]);
    expect(state.active).toBe(state.projects[0].id);
    expect(log).toEqual([`open ${root}`]);
  });

  it('an unreadable root is a diagnostic, not a throw', async () => {
    rmSync(root, { recursive: true, force: true });
    const ctx = await boot();
    expect(ctx.workspace.state().projects).toEqual([]);
    expect(ctx.workspace.state().diagnostics).toHaveLength(1);
    expect(ctx.workspace.state().diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'workspace',
    });
  });
});

describe('workspace: open, close, switch', () => {
  it('open boots the scope with the project path and publishes previewUrl', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    const changes: string[] = [];
    ctx.on('workspace/changed', (s) => changes.push(String(s.active)));
    expect(await ctx.workspace.open('one')).toEqual([]);
    expect(ctx.workspace.state()).toMatchObject({
      active: 'one',
      previewUrl: 'http://127.0.0.1:5681',
    });
    expect(log).toEqual([`open ${join(root, 'one')}`]);
    expect(changes).toEqual(['one']);
  });

  it('open of an unknown id refuses with a diagnostic and changes nothing', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    const refusal = await ctx.workspace.open('nope');
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toMatchObject({ severity: 'error', plugin: 'workspace' });
    expect(refusal[0].message).toContain('nope');
    expect(ctx.workspace.state().active).toBeNull();
    expect(log).toEqual([]);
  });

  it('open of the active id is a no-op: no second boot, no event', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.open('one');
    let events = 0;
    ctx.on('workspace/changed', () => events++);
    expect(await ctx.workspace.open('one')).toEqual([]);
    expect(log).toHaveLength(1);
    expect(events).toBe(0);
  });

  it('switching disposes the first scope BEFORE booting the second', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log);
    const seen: (string | null)[] = [];
    ctx.on('workspace/changed', (state) => seen.push(state.active));
    await ctx.workspace.open('one');
    await ctx.workspace.open('two');
    expect(log).toEqual([
      `open ${join(root, 'one')}`,
      `close ${join(root, 'one')}`,
      `open ${join(root, 'two')}`,
    ]);
    expect(ctx.workspace.state().active).toBe('two');
    // An `active: null` frame goes out BETWEEN the two, before `two` boots:
    // listeners that reset per-project state on a departure (rpc) do it
    // there, not on top of what `two`'s boot has just reported.
    expect(seen).toEqual(['one', null, 'two']);
  });

  it('two opens in flight run one after the other, not interleaved', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log);
    await Promise.all([ctx.workspace.open('one'), ctx.workspace.open('two')]);
    expect(log).toEqual([
      `open ${join(root, 'one')}`,
      `close ${join(root, 'one')}`,
      `open ${join(root, 'two')}`,
    ]);
  });

  it('a scope that fails to boot leaves active null, previewUrl null, and says why', async () => {
    project('one');
    const ctx = await boot([], { fail: true });
    const refusal = await ctx.workspace.open('one');
    expect(refusal).toHaveLength(1);
    expect(refusal[0].message).toContain('boot failed');
    expect(ctx.workspace.state()).toMatchObject({ active: null, previewUrl: null });
    expect(ctx.workspace.state().diagnostics).toEqual(refusal);
  });

  it('close disposes and clears; close with nothing open is a no-op', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.close();
    await ctx.workspace.open('one');
    await ctx.workspace.close();
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`]);
    expect(ctx.workspace.state()).toMatchObject({ active: null, previewUrl: null });
  });

  it('a scope that fails to stop is a diagnostic; active clears and the next open still boots', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log, { failClose: true });
    await ctx.workspace.open('one');
    await ctx.workspace.close();
    expect(ctx.workspace.state().active).toBeNull();
    expect(ctx.workspace.state().diagnostics).toHaveLength(1);
    expect(ctx.workspace.state().diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'workspace',
      where: 'one',
    });
    expect(ctx.workspace.state().diagnostics[0].message).toContain('teardown failed');
    expect(await ctx.workspace.open('two')).toEqual([]);
    expect(ctx.workspace.state().active).toBe('two');
    expect(log).toEqual([`open ${join(root, 'one')}`, `open ${join(root, 'two')}`]);
  });

  it('disposing the host waits for the open scope to close', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log, { slowClose: true });
    await ctx.workspace.open('one');
    await ctx.fiber.dispose();
    expect(log.at(-1)).toBe(`close ${join(root, 'one')}`);
  });

  it('rescan picks up a project created after boot and drops a removed one, keeping active', async () => {
    project('one');
    const ctx = await boot();
    await ctx.workspace.open('one');
    project('two');
    await ctx.workspace.rescan();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['one', 'two']);
    expect(ctx.workspace.state().active).toBe('one');
  });
});

describe('workspace: templates and create', () => {
  it('lists projects holding e8.template.yml with a name; nameless, no-e8.yml and malformed are one diagnostic each', async () => {
    templates();
    const ctx = await boot();
    const state = ctx.workspace.state();
    expect(state.templates).toEqual([{ id: 'good', name: 'Good', description: 'A good one' }]);
    expect(state.diagnostics).toHaveLength(3);
    for (const diag of state.diagnostics) {
      expect(diag).toMatchObject({ severity: 'error', plugin: 'workspace' });
    }
    const byWhere = Object.fromEntries(state.diagnostics.map((d) => [d.where, d.message]));
    expect(Object.keys(byWhere).sort()).toEqual([...EXCLUDED_TEMPLATES].sort());
    expect(byWhere.noname).toContain('has no name');
    expect(byWhere.noe8yml).toContain(
      `template "noe8yml" (${join(templatesDir, 'noe8yml')}) has no e8.yml`,
    );
    expect(byWhere.malformed).toContain(join(templatesDir, 'malformed'));
    expect(byWhere.malformed).toContain('unexpected end of the stream'); // js-yaml's own words
  });

  it('an unreadable templates dir is an empty list and one diagnostic', async () => {
    rmSync(templatesDir, { recursive: true, force: true });
    const ctx = await boot();
    expect(ctx.workspace.state().templates).toEqual([]);
    expect(ctx.workspace.state().diagnostics).toHaveLength(1);
    expect(ctx.workspace.state().diagnostics[0].message).toContain(templatesDir);
  });

  it('rescan picks up a template added after boot', async () => {
    const ctx = await boot();
    expect(ctx.workspace.state().templates).toEqual([]);
    templates();
    await ctx.workspace.rescan();
    expect(ctx.workspace.state().templates.map((t) => t.id)).toEqual(['good']);
  });

  it('create copies the template, substitutes the id, skips node_modules, the manifest and symlinks, and opens the project', async () => {
    templates();
    project('old');
    const log: string[] = [];
    const ctx = await boot(log);
    expect(await ctx.workspace.create({ template: 'good', id: 'new-one' })).toEqual([]);
    const dest = join(root, 'new-one');
    const read = (rel: string) => readFileSync(join(dest, rel), 'utf8');
    expect(JSON.parse(read('package.json'))).toEqual({ name: 'new-one', private: true });
    expect(read('package.json')).toBe('{\n  "name": "new-one",\n  "private": true\n}\n');
    expect(JSON.parse(read('game/spec.json'))).toEqual({ id: 'new-one', name: 'new-one' });
    expect(read('index.html')).toBe('<title>new-one — e8 dev</title>\n');
    expect(read('src/x.ts')).toContain('{{id}}');
    expect(existsSync(join(dest, 'node_modules'))).toBe(false);
    expect(existsSync(join(dest, 'e8.template.yml'))).toBe(false);
    expect(lstatSafe(join(dest, 'link.ts'))).toBeNull();
    expect(lstatSafe(join(dest, 'linkdir'))).toBeNull();
    expect(existsSync(join(dest, 'e8.yml'))).toBe(true);
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['new-one', 'old']);
    expect(ctx.workspace.state().active).toBe('new-one');
    expect(log).toEqual([`open ${dest}`]);
  });

  it('a created project whose scope fails to boot exists but is not active; the refusal is the boot one', async () => {
    templates();
    const ctx = await boot([], { fail: true });
    const refusal = await ctx.workspace.create({ template: 'good', id: 'new-one' });
    expect(refusal).toHaveLength(1);
    expect(refusal[0].message).toContain('boot failed');
    expect(refusal[0].code).toBeUndefined();
    expect(existsSync(join(root, 'new-one', 'e8.yml'))).toBe(true);
    expect(ctx.workspace.state().active).toBeNull();
  });

  it.each(['', 'A', '-x', 'a b', 'a'.repeat(65)])(
    'refuses the id %j and creates nothing',
    async (id) => {
      templates();
      const ctx = await boot();
      const refusal = await ctx.workspace.create({ template: 'good', id });
      expect(refusal).toHaveLength(1);
      expect(refusal[0]).toMatchObject({ plugin: 'workspace', code: 'invalid' });
      expect(ctx.workspace.state().projects).toEqual([]);
      expect(ctx.workspace.state().active).toBeNull();
      if (id) expect(existsSync(join(root, id))).toBe(false);
    },
  );

  it('accepts a 64-character id', async () => {
    templates();
    const ctx = await boot();
    const id = 'a'.repeat(64);
    expect(await ctx.workspace.create({ template: 'good', id })).toEqual([]);
    expect(ctx.workspace.state().active).toBe(id);
  });

  it('refuses an id that is already a project, or already a file or folder under root', async () => {
    templates();
    project('taken');
    mkdirSync(join(root, 'plain-dir'));
    writeFileSync(join(root, 'plain-file'), '');
    const ctx = await boot();
    for (const id of ['taken', 'plain-dir', 'plain-file']) {
      const refusal = await ctx.workspace.create({ template: 'good', id });
      expect(refusal).toHaveLength(1);
      expect(refusal[0]).toMatchObject({ code: 'exists' });
      expect(refusal[0].message).toContain('already exists');
    }
    expect(existsSync(join(root, 'plain-dir', 'e8.yml'))).toBe(false);
    expect(ctx.workspace.state().active).toBeNull();
  });

  it('refuses an unknown template, including one listed as a directory but excluded', async () => {
    templates();
    const ctx = await boot();
    for (const template of ['nope', 'nomanifest', ...EXCLUDED_TEMPLATES]) {
      const refusal = await ctx.workspace.create({ template, id: 'new-one' });
      expect(refusal).toHaveLength(1);
      expect(refusal[0]).toMatchObject({ code: 'unknown-template' });
    }
    expect(existsSync(join(root, 'new-one'))).toBe(false);
  });

  it('a root that is itself a project lists no templates and refuses to create', async () => {
    templates();
    writeFileSync(join(root, 'e8.yml'), '[]');
    const ctx = await boot();
    expect(ctx.workspace.state().templates).toEqual([]);
    expect(ctx.workspace.state().diagnostics).toEqual([]);
    const refusal = await ctx.workspace.create({ template: 'good', id: 'new-one' });
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toMatchObject({ code: 'single-project' });
    expect(existsSync(join(root, 'new-one'))).toBe(false);
  });

  it('a refusal is returned, not published: state().diagnostics and the change stream stay as they were', async () => {
    templates();
    project('taken');
    const ctx = await boot();
    let events = 0;
    ctx.on('workspace/changed', () => events++);
    const before = ctx.workspace.state().diagnostics;
    for (const input of [
      { template: 'good', id: 'taken' },
      { template: 'good', id: 'Bad' },
      { template: 'nope', id: 'new-one' },
    ]) {
      expect(await ctx.workspace.create(input)).toHaveLength(1);
    }
    expect(ctx.workspace.state().diagnostics).toEqual(before);
    expect(events).toBe(0);
  });

  it.skipIf(!notRoot)('a copy that fails leaves no half-made project and says why', async () => {
    templates();
    chmodSync(join(templatesDir, 'good', 'src', 'x.ts'), 0);
    const log: string[] = [];
    const ctx = await boot(log);
    const before = ctx.workspace.state().diagnostics;
    const refusal = await ctx.workspace.create({ template: 'good', id: 'new-one' });
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toMatchObject({ code: 'copy-failed' });
    expect(refusal[0].message).toContain('EACCES');
    expect(existsSync(join(root, 'new-one'))).toBe(false);
    expect(ctx.workspace.state().projects).toEqual([]);
    expect(ctx.workspace.state().diagnostics).toEqual(before);
    expect(log).toEqual([]);
  });

  /**
   * `cpSync` keeps the template's modes, so a read-only `game/spec.json`
   * copies fine and then refuses the `{{id}}` write (EACCES, non-root).
   * The refusal's fix says so. Here `zz/` is ALSO copied read-only, so
   * the cleanup's `rmSync` cannot unlink what is inside it — that failure
   * rides along in the message instead of replacing the first one, and
   * the partial copy stays where it is (the test opens it up again so
   * `afterEach` can remove it).
   */
  it.skipIf(!notRoot)(
    "a substitution that fails names cpSync's kept modes; a cleanup that fails says so too",
    async () => {
      templates();
      const good = join(templatesDir, 'good');
      chmodSync(join(good, 'game', 'spec.json'), 0o444);
      mkdirSync(join(good, 'zz'));
      writeFileSync(join(good, 'zz', 'a'), 'a');
      chmodSync(join(good, 'zz'), 0o555);
      const ctx = await boot();
      const dest = join(root, 'new-one');
      try {
        const refusal = await ctx.workspace.create({ template: 'good', id: 'new-one' });
        expect(refusal).toHaveLength(1);
        expect(refusal[0]).toMatchObject({ code: 'copy-failed' });
        expect(refusal[0].message).toContain(`EACCES`);
        expect(refusal[0].message).toContain(
          `; and the partial copy at ${dest} could not be removed: EACCES`,
        );
        expect(refusal[0].fix).toContain(
          "make the template's files writable — cpSync keeps their modes",
        );
        expect(existsSync(join(dest, 'zz', 'a'))).toBe(true);
        expect(ctx.workspace.state().projects).toEqual([]);
      } finally {
        chmodSync(join(good, 'zz'), 0o755);
        if (existsSync(join(dest, 'zz'))) chmodSync(join(dest, 'zz'), 0o755);
      }
    },
  );

  it.skipIf(!notRoot)(
    'a substitution that fails with a removable partial copy removes it',
    async () => {
      templates();
      chmodSync(join(templatesDir, 'good', 'game', 'spec.json'), 0o444);
      const ctx = await boot();
      const refusal = await ctx.workspace.create({ template: 'good', id: 'new-one' });
      expect(refusal).toHaveLength(1);
      expect(refusal[0]).toMatchObject({ code: 'copy-failed' });
      expect(refusal[0].message).toContain('EACCES');
      expect(refusal[0].message).not.toContain('could not be removed');
      expect(existsSync(join(root, 'new-one'))).toBe(false);
    },
  );

  it('create waits behind an in-flight open', async () => {
    templates();
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await Promise.all([
      ctx.workspace.open('one'),
      ctx.workspace.create({ template: 'good', id: 'new-one' }),
    ]);
    expect(log).toEqual([
      `open ${join(root, 'one')}`,
      `close ${join(root, 'one')}`,
      `open ${join(root, 'new-one')}`,
    ]);
    expect(ctx.workspace.state().active).toBe('new-one');
  });
});
