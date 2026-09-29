import type { Context } from 'cordis';
import type { HistoryResult } from '../plugins/history';

/**
 * The letter a Mod chord means, lower-cased, or `''`. `key` is the
 * character the active layout produced and wins whenever it is a Latin
 * letter — QWERTZ puts Y on the physical Z key, so its Ctrl+Y must read
 * as `'y'`, not as the `'KeyZ'` its `code` says. `code` (the physical
 * key) is the fallback only for a layout that produces no Latin letter: a
 * Russian layout's Ctrl+Z reports `key: 'я'`, `code: 'KeyZ'`.
 */
export function chordLetter(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : '';
}

/**
 * `'undo'` for Mod+Z, `'redo'` for Mod+Shift+Z or Mod+Y — Alt held, no
 * Mod, or any other key is `null` (design doc §5). Which letter the chord
 * is comes from `chordLetter`.
 */
export function historyAction(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): 'undo' | 'redo' | null {
  if (e.altKey || (!e.metaKey && !e.ctrlKey)) return null;
  const letter = chordLetter(e);
  if (letter === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (letter === 'y') return 'redo';
  return null;
}

/**
 * The fields that keep their own text undo: a text-entry `<input>`, a
 * `<textarea>`, `[contenteditable]`, a Monaco editor — a key routed here
 * must not also run the IDE's (design doc §5). A checkbox, radio, range,
 * color, file or button input has no undo of its own, and neither does a
 * `<select>`: Mod+Z after toggling one is the IDE's.
 */
const EDITABLE = [
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])' +
    ':not([type=button]):not([type=submit]):not([type=reset]):not([type=file])',
  'textarea',
  '[contenteditable]',
  '.monaco-editor',
].join(', ');

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/** The Explorer sidebar — its file operations are the `files` key (design doc §4). */
function isExplorerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-testid="sidebar-explorer"]') !== null;
}

/**
 * Routes one key event to `ctx.history`: nothing for a text field or
 * Monaco (their own undo — see `EDITABLE`); the Explorer's `files` key with focus there;
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

/**
 * For a canvas's forwarded `undo`/`redo` event: the active tab's own keys
 * (design doc §5). Computes `keysFor(ctx.shell.active()?.key)` the same
 * way `runHistoryKey`'s own "elsewhere" branch does — not shared with it,
 * because the two disagree on what to do with an empty result: a canvas's
 * event always came from a real tab wanting a real answer, so this always
 * calls through and lets `history.undo`/`redo` say "nothing to undo"
 * itself, while `runHistoryKey` treats no keys as nothing having happened
 * at all (no call, `false`, so the caller does not swallow the keystroke).
 */
export async function runHistory(ctx: Context, action: 'undo' | 'redo'): Promise<HistoryResult> {
  const keys = ctx.history.keysFor(ctx.shell.active()?.key);
  return action === 'undo' ? ctx.history.undo(keys) : ctx.history.redo(keys);
}
