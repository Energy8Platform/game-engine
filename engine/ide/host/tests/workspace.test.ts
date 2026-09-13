import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Context } from 'cordis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as workspace from '../src/plugins/workspace';
import type { ProjectScopeHandle } from '../src/plugins/workspace';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'e8-ws-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function project(id: string, spec?: unknown) {
  mkdirSync(join(root, id, 'game'), { recursive: true });
  writeFileSync(join(root, id, 'e8.yml'), '[]\n');
  if (spec !== undefined) writeFileSync(join(root, id, 'game', 'spec.json'), JSON.stringify(spec));
}

/** A scope that records its life; `fail` makes boot reject. */
function fakeScope(log: string[], opts: { fail?: boolean; previewUrl?: string | null } = {}) {
  return async (_ctx: Context, cwd: string): Promise<ProjectScopeHandle> => {
    log.push(`open ${cwd}`);
    if (opts.fail) throw new Error('boot failed');
    return {
      previewUrl: opts.previewUrl ?? 'http://127.0.0.1:5681',
      dispose: async () => {
        log.push(`close ${cwd}`);
      },
    };
  };
}

async function boot(log: string[] = [], opts?: Parameters<typeof fakeScope>[1]) {
  const ctx = new Context();
  await ctx.plugin(workspace, { root, scope: fakeScope(log, opts) });
  return ctx;
}

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
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['a-slot', 'b-slot', 'file-named-e8']);
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
    expect(byId).toEqual({ named: 'First Slot', unnamed: 'unnamed', 'bad-name': 'bad-name', 'bad-json': 'bad-json' });
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
    expect(ctx.workspace.state().diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'workspace' });
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
    expect(ctx.workspace.state()).toMatchObject({ active: 'one', previewUrl: 'http://127.0.0.1:5681' });
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
    await ctx.workspace.open('one');
    await ctx.workspace.open('two');
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`, `open ${join(root, 'two')}`]);
    expect(ctx.workspace.state().active).toBe('two');
  });

  it('two opens in flight run one after the other, not interleaved', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log);
    await Promise.all([ctx.workspace.open('one'), ctx.workspace.open('two')]);
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`, `open ${join(root, 'two')}`]);
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

  it('disposing the host disposes the open scope', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
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
