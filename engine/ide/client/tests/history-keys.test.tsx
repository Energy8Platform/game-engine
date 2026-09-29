import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Context } from 'cordis';
import * as slotsPlugin from '../src/plugins/slots';
import * as shellPlugin from '../src/plugins/shell';
import * as historyPlugin from '../src/plugins/history';
import { historyAction, runHistory, runHistoryKey } from '../src/shell/historyKeys';
import { HistoryStatus } from '../src/shell/HistoryStatus';

/**
 * `shell` (`inject: ['slots']`) and `history` (no deps) compose cleanly on
 * a bare `Context` — the same "boot the real plugins, no mocks" shape
 * `history.test.ts`'s own `boot()` uses. Nothing here needs `connection`,
 * `workspace` or any fetch: `shell.open()` is in-memory, and `keysFor`
 * only ever consults matchers this file registers itself.
 */
async function boot(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(slotsPlugin);
  await ctx.plugin(shellPlugin);
  await ctx.plugin(historyPlugin);
  return ctx;
}

/** Opens and activates a tab with the given key — `ShellService.open` activates by default. */
function openTab(ctx: Context, key: string) {
  ctx.shell.open({ key, title: key, component: () => null, closable: true });
}

/** A keydown whose `target` is set directly (`dispatchEvent` would require the element to be in the document). */
function keydown(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  return event;
}

describe('historyAction', () => {
  it('Mod+Z, meta or ctrl, is undo', () => {
    expect(
      historyAction({
        key: 'z',
        code: 'KeyZ',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('undo');
    expect(
      historyAction({
        key: 'z',
        code: 'KeyZ',
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('undo');
  });

  it('Mod+Shift+Z is redo', () => {
    expect(
      historyAction({
        key: 'Z',
        code: 'KeyZ',
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe('redo');
  });

  it('Mod+Y is redo', () => {
    expect(
      historyAction({
        key: 'y',
        code: 'KeyY',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('redo');
  });

  it('is null for Alt+Mod+Z, a plain Z, and Mod+X', () => {
    expect(
      historyAction({
        key: 'z',
        code: 'KeyZ',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toBeNull();
    expect(
      historyAction({
        key: 'z',
        code: 'KeyZ',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      historyAction({
        key: 'x',
        code: 'KeyX',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  // A Russian keyboard layout reports Ctrl+Z as `key: 'я'` — never 'z' —
  // so `code` (the physical key, layout-independent) is what recognizes it.
  it('a non-Latin layout is recognized by `code`: Ctrl+Z (я) undoes, Ctrl+Shift+Z (Я) and Ctrl+Y (н) redo', () => {
    expect(
      historyAction({
        key: 'я',
        code: 'KeyZ',
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('undo');
    expect(
      historyAction({
        key: 'Я',
        code: 'KeyZ',
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe('redo');
    expect(
      historyAction({
        key: 'н',
        code: 'KeyY',
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('redo');
  });
});

describe('runHistoryKey', () => {
  it('an <input> target answers false and calls neither undo nor redo', async () => {
    const ctx = await boot();
    openTab(ctx, 'a');
    ctx.history.scope((tabKey) => (tabKey === 'a' ? ['a'] : undefined));
    const undo = vi.spyOn(ctx.history, 'undo');
    const redo = vi.spyOn(ctx.history, 'redo');

    expect(runHistoryKey(ctx, keydown(document.createElement('input')))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('a <textarea> target answers false and calls neither undo nor redo', async () => {
    const ctx = await boot();
    openTab(ctx, 'a');
    ctx.history.scope((tabKey) => (tabKey === 'a' ? ['a'] : undefined));
    const undo = vi.spyOn(ctx.history, 'undo');

    expect(runHistoryKey(ctx, keydown(document.createElement('textarea')))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('a [contenteditable] target answers false and calls neither undo nor redo', async () => {
    const ctx = await boot();
    openTab(ctx, 'a');
    ctx.history.scope((tabKey) => (tabKey === 'a' ? ['a'] : undefined));
    const undo = vi.spyOn(ctx.history, 'undo');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');

    expect(runHistoryKey(ctx, keydown(div))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('an element inside .monaco-editor answers false and calls neither undo nor redo', async () => {
    const ctx = await boot();
    openTab(ctx, 'a');
    ctx.history.scope((tabKey) => (tabKey === 'a' ? ['a'] : undefined));
    const undo = vi.spyOn(ctx.history, 'undo');
    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    const inner = document.createElement('span');
    editor.appendChild(inner);

    // The target is a CHILD of `.monaco-editor`, not the editor root itself.
    expect(runHistoryKey(ctx, keydown(inner))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('focus inside the Explorer sidebar undoes/redoes the "files" key', async () => {
    const ctx = await boot();
    const undo = vi.spyOn(ctx.history, 'undo');
    const redo = vi.spyOn(ctx.history, 'redo');
    const sidebar = document.createElement('div');
    sidebar.setAttribute('data-testid', 'sidebar-explorer');
    const button = document.createElement('button');
    sidebar.appendChild(button);

    expect(runHistoryKey(ctx, keydown(button))).toBe(true);
    expect(undo).toHaveBeenCalledWith(['files']);

    expect(runHistoryKey(ctx, keydown(button, { shiftKey: true }))).toBe(true);
    expect(redo).toHaveBeenCalledWith(['files']);
  });

  it("elsewhere undoes/redoes the active tab's keys", async () => {
    const ctx = await boot();
    openTab(ctx, 'flow');
    ctx.history.scope((tabKey) => (tabKey === 'flow' ? ['flow'] : undefined));
    const undo = vi.spyOn(ctx.history, 'undo');
    const redo = vi.spyOn(ctx.history, 'redo');

    expect(runHistoryKey(ctx, keydown(document.body))).toBe(true);
    expect(undo).toHaveBeenCalledWith(['flow']);

    expect(runHistoryKey(ctx, keydown(document.body, { shiftKey: true }))).toBe(true);
    expect(redo).toHaveBeenCalledWith(['flow']);
  });

  it('no active tab and no Explorer focus does nothing', async () => {
    const ctx = await boot();
    const undo = vi.spyOn(ctx.history, 'undo');
    const redo = vi.spyOn(ctx.history, 'redo');

    expect(runHistoryKey(ctx, keydown(document.body))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});

describe('runHistory', () => {
  it("undoes/redoes the active tab's keys — for a canvas's forwarded key", async () => {
    const ctx = await boot();
    openTab(ctx, 'flow');
    ctx.history.scope((tabKey) => (tabKey === 'flow' ? ['flow'] : undefined));
    ctx.history.record('flow', {
      label: 'flow edit',
      undo: async () => null,
      redo: async () => null,
    });

    expect(await runHistory(ctx, 'undo')).toEqual({ kind: 'undo', ok: true, label: 'flow edit' });
    expect(await runHistory(ctx, 'redo')).toEqual({ kind: 'redo', ok: true, label: 'flow edit' });
  });
});

describe('HistoryStatus', () => {
  async function bootHistory(): Promise<Context> {
    const ctx = new Context();
    await ctx.plugin(historyPlugin);
    return ctx;
  }

  it('shows "Undo: <label>" right after an undo, then nothing 4 s later', async () => {
    const ctx = await bootHistory();
    ctx.history.record('a', { label: 'move node', undo: async () => null, redo: async () => null });
    vi.useFakeTimers();
    try {
      await ctx.history.undo(['a']);
      render(<HistoryStatus ctx={ctx} />);
      expect(screen.getByTestId('history-status')).toHaveTextContent('Undo: move node');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(screen.getByTestId('history-status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the refusal reason, not a label, when the undo fails', async () => {
    const ctx = await bootHistory();
    await ctx.history.undo(['missing']);
    render(<HistoryStatus ctx={ctx} />);
    expect(screen.getByTestId('history-status')).toHaveTextContent('nothing to undo');
  });

  it('a later undo replaces the shown result and restarts the 4 s window', async () => {
    const ctx = await bootHistory();
    ctx.history.record('a', { label: 'first', undo: async () => null, redo: async () => null });
    vi.useFakeTimers();
    try {
      await ctx.history.undo(['a']);
      render(<HistoryStatus ctx={ctx} />);
      expect(screen.getByTestId('history-status')).toHaveTextContent('Undo: first');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        await ctx.history.redo(['a']);
      });
      expect(screen.getByTestId('history-status')).toHaveTextContent('Redo: first');

      // 3 s past the FIRST result's own window: still showing, since the
      // second result reset the clock.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByTestId('history-status')).toHaveTextContent('Redo: first');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByTestId('history-status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });
});
