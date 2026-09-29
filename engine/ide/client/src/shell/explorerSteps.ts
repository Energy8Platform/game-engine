import type { Diagnostic, FileEntry } from '@energy8engine/contracts';
import type { FilesService } from '../plugins/files';
import type { HistoryService, HistoryStep } from '../plugins/history';

/**
 * The Explorer's own `HistoryStep`s (design doc §4). Unlike `valueStep`
 * (history.ts), a file op has no single "current value" to compare a
 * step's "after" against — each builder below does its own
 * precondition check instead (read the bytes, walk the tree) before
 * acting, and only for the two ops the design doc calls out (create/
 * mkdir's undo, move either way).
 *
 * Every step's own write goes through `deps.history.replay` (§1: an
 * undo or redo is never itself recorded) and, once it lands, calls
 * `deps.refresh` so the Explorer's tree catches up — it is a
 * mounted-once sidebar, and nothing else pushes it a frame for a change
 * made through `ctx.files`.
 */
export interface ExplorerStepDeps {
  files: FilesService;
  history: HistoryService;
  refresh(): void;
}

/** The wording a precondition check reuses verbatim from `valueStep`'s own refusal — same meaning, "the thing this step expected to still be true no longer is". */
const changed = (verb: 'undo' | 'redo') => `changed elsewhere since — can't ${verb}`;

/** Runs `write` with recording off; its diagnostic's message (or `null`) is the step's own answer. No refresh — `removeStep`'s undo batches several of these before refreshing once. */
async function writeThrough(
  deps: ExplorerStepDeps,
  write: () => Promise<{ diagnostics: readonly Diagnostic[] }>,
): Promise<string | null> {
  const { diagnostics } = await deps.history.replay(write);
  return diagnostics.length > 0 ? (diagnostics[0]?.message ?? 'refused') : null;
}

/** `writeThrough`, plus the tree refresh every single-write step needs once it lands. */
async function apply(
  deps: ExplorerStepDeps,
  write: () => Promise<{ diagnostics: readonly Diagnostic[] }>,
): Promise<string | null> {
  const reason = await writeThrough(deps, write);
  if (reason === null) deps.refresh();
  return reason;
}

/** `create <path>` — undo only while the file is still empty and untouched (`read` answers 0 bytes); redo creates it again. */
export function createStep(deps: ExplorerStepDeps, path: string): HistoryStep {
  return {
    label: `create ${path}`,
    async undo() {
      const { bytes, diagnostics } = await deps.files.read(path);
      if (diagnostics.length > 0 || bytes === undefined || bytes.length > 0) return changed('undo');
      return apply(deps, () => deps.files.remove(path));
    },
    redo: () => apply(deps, () => deps.files.create(path)),
  };
}

/** `new folder <path>` — undo only while nothing has been placed inside it yet; redo creates it again. */
export function mkdirStep(deps: ExplorerStepDeps, path: string): HistoryStep {
  return {
    label: `new folder ${path}`,
    async undo() {
      const { entries, diagnostics } = await deps.files.tree();
      if (diagnostics.length > 0 || entries.some((e) => e.path.startsWith(`${path}/`))) {
        return changed('undo');
      }
      return apply(deps, () => deps.files.remove(path));
    },
    redo: () => apply(deps, () => deps.files.mkdir(path)),
  };
}

/** `move <from> → <to>` — either direction refused when the target name is already taken (design doc §4). */
export function moveStep(deps: ExplorerStepDeps, from: string, to: string): HistoryStep {
  async function attempt(source: string, target: string, verb: 'undo' | 'redo'): Promise<string | null> {
    const { entries, diagnostics } = await deps.files.tree();
    if (diagnostics.length > 0 || entries.some((e) => e.path === target)) return changed(verb);
    return apply(deps, () => deps.files.move(source, target));
  }
  return {
    label: `move ${from} → ${to}`,
    undo: () => attempt(to, from, 'undo'),
    redo: () => attempt(from, to, 'redo'),
  };
}

/** The brief's own cap, verbatim: past this many bytes under a removed path, the remove is not undoable. */
export const REMOVE_UNDO_CAP_BYTES = 20 * 1024 * 1024;
export const REMOVE_OVER_CAP_MESSAGE = "This can't be undone (over 20 MB).";
/** A file `tree()` listed that `read()` could not produce — restoring every OTHER file would still lose that one, so the whole remove is refused as undoable rather than partially restorable. */
export const REMOVE_UNREADABLE_MESSAGE = "This can't be undone (a file could not be read).";

export interface RemoveSnapshot {
  /** Every directory at or under the removed path — sorted, so undo's `mkdir`s land parent before child (a path is always a lexicographic prefix of its own children's). */
  dirs: string[];
  files: [string, Uint8Array][];
  overCap: boolean;
  /** A file under the path could not be read — see `REMOVE_UNREADABLE_MESSAGE`. Mutually exclusive with `overCap` in practice: reading stops the moment either becomes true. */
  unreadable: boolean;
}

/**
 * Reads what a remove of `path` would take with it, while it is still
 * there to read: the confirm needs `overCap`/`unreadable` before the
 * remove even happens (`Explorer.tsx`'s `confirm` now awaits this before
 * calling `ctx.files.remove` at all, so "yes" never races past knowing
 * whether the remove will be undoable), and `removeStep`'s undo needs the
 * bytes to hand back. Stops reading the moment either becomes true —
 * past that point the remove won't be undoable regardless of what any
 * later file holds.
 */
export async function snapshotForRemove(
  files: FilesService,
  path: string,
  entries: readonly FileEntry[],
): Promise<RemoveSnapshot> {
  const root = entries.find((e) => e.path === path);
  const under = (p: string) => p === path || p.startsWith(`${path}/`);
  const dirs =
    root?.kind === 'dir'
      ? entries
          .filter((e) => e.kind === 'dir' && under(e.path))
          .map((e) => e.path)
          .sort()
      : [];
  const filePaths =
    root?.kind === 'file'
      ? [path]
      : entries.filter((e) => e.kind === 'file' && under(e.path)).map((e) => e.path);

  const collected: [string, Uint8Array][] = [];
  let total = 0;
  for (const filePath of filePaths) {
    if (total > REMOVE_UNDO_CAP_BYTES) {
      return { dirs, files: collected, overCap: true, unreadable: false };
    }
    const { bytes, diagnostics } = await files.read(filePath);
    if (diagnostics.length > 0 || bytes === undefined) {
      return { dirs, files: collected, overCap: false, unreadable: true };
    }
    collected.push([filePath, bytes]);
    total += bytes.length;
  }
  return { dirs, files: collected, overCap: total > REMOVE_UNDO_CAP_BYTES, unreadable: false };
}

/** `remove <path>` — undo recreates every directory (parent first), then writes every file's bytes back, then refreshes once; redo removes it again. */
export function removeStep(
  deps: ExplorerStepDeps,
  path: string,
  dirs: readonly string[],
  files: readonly [string, Uint8Array][],
): HistoryStep {
  return {
    label: `remove ${path}`,
    async undo() {
      for (const dir of dirs) {
        const reason = await writeThrough(deps, () => deps.files.mkdir(dir));
        if (reason !== null) return reason;
      }
      for (const [filePath, bytes] of files) {
        const reason = await writeThrough(deps, () => deps.files.write(filePath, bytes));
        if (reason !== null) return reason;
      }
      deps.refresh();
      return null;
    },
    redo: () => apply(deps, () => deps.files.remove(path)),
  };
}

/** `upload <path>` — undo restores the bytes that were there before, or removes a file that did not exist yet; redo writes the upload again. */
export function writeStep(
  deps: ExplorerStepDeps,
  path: string,
  before: Uint8Array | null,
  after: Uint8Array,
): HistoryStep {
  return {
    label: `upload ${path}`,
    undo: () =>
      before === null
        ? apply(deps, () => deps.files.remove(path))
        : apply(deps, () => deps.files.write(path, before)),
    redo: () => apply(deps, () => deps.files.write(path, after)),
  };
}
