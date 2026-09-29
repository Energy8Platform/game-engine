import type { Context } from 'cordis';
import type { HistoryResult } from '../plugins/history';

/**
 * `'undo'` for Mod+Z, `'redo'` for Mod+Shift+Z or Mod+Y — Alt held, no
 * Mod, or any other key is `null` (design doc §5). `key` is lower-cased
 * before comparing: a real keyboard already reports Shift+Z as `'Z'`
 * regardless of this function's own `shiftKey` check, and comparing case-
 * insensitively keeps the two independent.
 */
export function historyAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): 'undo' | 'redo' | null {
  if (e.altKey || (!e.metaKey && !e.ctrlKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  return null;
}

/**
 * An `<input>`/`<textarea>`/`[contenteditable]`/Monaco editor — each keeps
 * its own undo, so a key routed here must not also run the IDE's (design
 * doc §5).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, [contenteditable], .monaco-editor') !== null
  );
}

/** The Explorer sidebar — its file operations are the `files` key (design doc §4). */
function isExplorerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-testid="sidebar-explorer"]') !== null;
}

/**
 * Routes one key event to `ctx.history`: nothing for a text field or
 * Monaco (their own undo); the Explorer's `files` key with focus there;
 * otherwise the active tab's keys (design doc §3–§5). Answers whether it
 * acted, so the caller `preventDefault()`s only then — a key that matches
 * Mod+Z/Y shape but has nothing to act on (no active tab, not the
 * Explorer) answers `false` too, same as a key this router doesn't
 * recognize at all.
 */
export function runHistoryKey(ctx: Context, e: KeyboardEvent): boolean {
  const action = historyAction(e);
  if (action === null || isEditableTarget(e.target)) return false;

  const keys = isExplorerTarget(e.target)
    ? ['files']
    : ctx.history.keysFor(ctx.shell.active()?.key);
  if (keys.length === 0) return false;

  void (action === 'undo' ? ctx.history.undo(keys) : ctx.history.redo(keys));
  return true;
}

/** For a canvas's forwarded `undo`/`redo` event: the active tab's own keys (design doc §5). */
export async function runHistory(ctx: Context, action: 'undo' | 'redo'): Promise<HistoryResult> {
  const keys = ctx.history.keysFor(ctx.shell.active()?.key);
  return action === 'undo' ? ctx.history.undo(keys) : ctx.history.redo(keys);
}
