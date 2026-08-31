import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as boot from '../src/index';
import { renderBootFailure } from '../src/index';

describe('the boot failure screen', () => {
  it('renders every diagnostic it was given', () => {
    const root = document.createElement('div');
    renderBootFailure(root, [
      { severity: 'error', plugin: 'reels', where: 'config', message: 'speed must be a number' },
      { severity: 'error', plugin: 'session', where: 'binary', message: 'e8-server not found' },
    ]);
    expect(root.textContent).toContain('speed must be a number');
    expect(root.textContent).toContain('e8-server not found');
  });

  it('shows the fix hint when there is one', () => {
    const root = document.createElement('div');
    renderBootFailure(root, [
      { severity: 'error', plugin: 'p', where: 'w', message: 'm', fix: 'install it' },
    ]);
    expect(root.textContent).toContain('install it');
  });

  it('needs no renderer — it is DOM, so a broken renderer can still be reported', () => {
    const root = document.createElement('div');
    expect(() => renderBootFailure(root, [])).not.toThrow();
  });

  it('says something even when handed an empty list', () => {
    const root = document.createElement('div');
    renderBootFailure(root, []);
    expect(root.textContent?.length).toBeGreaterThan(0);
  });

  it('replaces whatever was already in root, rather than appending to it', () => {
    const root = document.createElement('div');
    root.textContent = 'stale content from a previous attempt';
    renderBootFailure(root, [
      { severity: 'error', plugin: 'p', where: 'w', message: 'fresh message' },
    ]);
    expect(root.textContent).not.toContain('stale content');
    expect(root.textContent).toContain('fresh message');
  });
});

/**
 * The `boot` cordis plugin is the piece that decides, given the diagnostics
 * collected so far, whether to call `start()` (bring up the renderer and
 * everything after it) or show the failure screen instead — never both.
 * `start` is handed in by whoever composes the game (Task 10's
 * `createGame`), so this suite never imports `renderer-pixi`/`stage` at
 * all: from `boot`'s point of view, "start" is just a callback.
 */
describe('the boot plugin', () => {
  async function run(diagnostics: Diagnostic[], mount?: HTMLElement) {
    const ctx = new Context();
    const start = vi.fn(async () => {});
    await ctx.plugin(boot, { diagnostics, mount, start });
    await ctx.fiber.dispose();
    return start;
  }

  it('calls start() when there are no diagnostics at all', async () => {
    const start = await run([]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('calls start() when every diagnostic is a warning', async () => {
    const start = await run([
      { severity: 'warning', plugin: 'reels', where: 'config', message: 'using a default' },
    ]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not call start() when there is at least one error, even alongside warnings', async () => {
    const start = await run([
      { severity: 'warning', plugin: 'reels', where: 'config', message: 'using a default' },
      { severity: 'error', plugin: 'session', where: 'binary', message: 'e8-server not found' },
    ]);
    expect(start).not.toHaveBeenCalled();
  });

  it('renders the failure screen into mount on error', async () => {
    const root = document.createElement('div');
    await run(
      [{ severity: 'error', plugin: 'session', where: 'binary', message: 'e8-server not found' }],
      root,
    );
    expect(root.textContent).toContain('e8-server not found');
  });

  it('does not throw on error when no mount was given — a headless caller still gets diagnostics back', async () => {
    await expect(
      run([{ severity: 'error', plugin: 'p', where: 'w', message: 'm' }], undefined),
    ).resolves.toBeDefined();
  });

  it('awaits an async start() before the plugin is considered booted', async () => {
    const ctx = new Context();
    let resolved = false;
    const start = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    await ctx.plugin(boot, { diagnostics: [], start });
    expect(resolved).toBe(true);
    await ctx.fiber.dispose();
  });
});
