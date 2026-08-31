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

  /**
   * The commonest real failure is not "already broken before start()" —
   * it's `start()` itself calling the renderer and the renderer failing
   * once actually attempted (measured: this is what happens under jsdom,
   * and is not guaranteed to be different in a real but WebGL-less
   * browser). `diagnostics` was clean when `apply()` first checked it, so
   * the pre-check alone would call `start()` and then say nothing further
   * — exactly the "blank mount, no white rectangle, but no text either"
   * gap this plugin exists to close. `start()` pushes onto the SAME
   * `diagnostics` array `apply()` already holds a reference to (mirroring
   * how `createGame` really wires this — see `runtime/src/index.ts`), so
   * the fix is a second check after `start()` resolves, not a different
   * code path.
   */
  it('renders the failure screen for an error start() itself discovers, even though diagnostics were clean going in', async () => {
    const ctx = new Context();
    const root = document.createElement('div');
    const diagnostics: Diagnostic[] = [];
    const start = vi.fn(async () => {
      diagnostics.push({
        severity: 'error',
        plugin: 'renderer-pixi',
        where: 'init',
        message: 'boom-discovered-during-start',
      });
    });

    await ctx.plugin(boot, { diagnostics, mount: root, start });

    expect(start).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('boom-discovered-during-start');

    await ctx.fiber.dispose();
  });

  it('does not render anything extra when start() adds only warnings', async () => {
    const ctx = new Context();
    const root = document.createElement('div');
    const diagnostics: Diagnostic[] = [];
    const start = vi.fn(async () => {
      diagnostics.push({
        severity: 'warning',
        plugin: 'stage',
        where: 'config',
        message: 'using a default',
      });
    });

    await ctx.plugin(boot, { diagnostics, mount: root, start });

    expect(root.textContent).toBe('');

    await ctx.fiber.dispose();
  });
});
