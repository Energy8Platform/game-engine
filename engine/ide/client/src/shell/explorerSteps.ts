import type { Diagnostic, FileEntry } from '@energy8engine/contracts';
import type { FilesService } from '../plugins/files';
import type { HistoryService, HistoryStep } from '../plugins/history';

/**
 * The Explorer's own `HistoryStep`s (design doc §4). Unlike `valueStep`
 * (history.ts), a file op has no single "current value" to compare a
 * step's "after" against — each builder below does its own
 * precondition check instead (read the bytes, walk the tree) before
 * acting, and refuses as "changed elsewhere" when what is on disk is no
 * longer what the op left there (or found there, for a redo).
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
  /** Whether a tab at `path`, or under it, has unsaved edits — a move would close it by force. */
  dirtyUnder(path: string): boolean;
  /** Closes the tabs at and under `from` and opens them again under `to`. */
  followMove(from: string, to: string): void;
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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The bytes `path` holds now, or `null` when it can't be read (not there, among others). */
async function bytesNow(deps: ExplorerStepDeps, path: string): Promise<Uint8Array | null> {
  const { bytes, diagnostics } = await deps.files.read(path);
  return diagnostics.length > 0 || bytes === undefined ? null : bytes;
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

/**
 * `move <from> → <to>` — either direction refused when the target name is
 * already taken (design doc §4), or while a tab under the path being moved
 * has unsaved edits (the same guard the Explorer's own move has); the open
 * tabs follow the path once it lands.
 */
export function moveStep(deps: ExplorerStepDeps, from: string, to: string): HistoryStep {
  async function attempt(source: string, target: string, verb: 'undo' | 'redo'): Promise<string | null> {
    if (deps.dirtyUnder(source)) return `a tab under ${source} has unsaved changes`;
    const { entries, diagnostics } = await deps.files.tree();
    if (diagnostics.length > 0 || entries.some((e) => e.path === target)) return changed(verb);
    const reason = await apply(deps, () => deps.files.move(source, target));
    if (reason === null) deps.followMove(source, target);
    return reason;
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
 * bytes to hand back. The tree's own sizes answer `overCap` first, without
 * reading a byte; otherwise reading stops the moment either becomes true —
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
  const listed = entries
    .filter((e) => e.kind === 'file' && under(e.path))
    .reduce((sum, e) => sum + (e.size ?? 0), 0);
  if (listed > REMOVE_UNDO_CAP_BYTES) return { dirs, files: [], overCap: true, unreadable: false };

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

/**
 * `remove <path>` — undo recreates every directory (parent first), then
 * writes every file's bytes back, then refreshes once; refused while the
 * tree lists any of those paths again. Redo removes it again; refused
 * once what is there differs from what was removed — a file's bytes, a
 * folder's file list and sizes.
 */
export function removeStep(
  deps: ExplorerStepDeps,
  path: string,
  dirs: readonly string[],
  files: readonly [string, Uint8Array][],
): HistoryStep {
  const paths = new Set([path, ...dirs, ...files.map(([p]) => p)]);
  const folder = dirs.includes(path);
  /** `path:size` of every file under a folder, sorted — what a tree listing can be compared with. */
  const listing = (list: [string, number][]) =>
    list
      .map(([p, size]) => `${p}:${size}`)
      .sort()
      .join('\n');

  async function unchanged(): Promise<boolean> {
    if (!folder) {
      const now = await bytesNow(deps, path);
      return now !== null && files.length === 1 && sameBytes(now, files[0][1]);
    }
    const { entries, diagnostics } = await deps.files.tree();
    if (diagnostics.length > 0) return false;
    const onDisk = entries
      .filter((e) => e.kind === 'file' && e.path.startsWith(`${path}/`))
      .map((e): [string, number] => [e.path, e.size ?? 0]);
    return listing(onDisk) === listing(files.map(([p, b]) => [p, b.length]));
  }

  return {
    label: `remove ${path}`,
    bytes: files.reduce((sum, [, b]) => sum + b.length, 0),
    async undo() {
      const { entries, diagnostics } = await deps.files.tree();
      if (diagnostics.length > 0 || entries.some((e) => paths.has(e.path))) return changed('undo');
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
    async redo() {
      if (!(await unchanged())) return changed('redo');
      return apply(deps, () => deps.files.remove(path));
    },
  };
}

/**
 * `upload <path>` — undo restores the bytes that were there before, or
 * removes a file that did not exist yet, refused once the file no longer
 * holds the upload; redo writes the upload again, refused once the file
 * no longer holds what undo put back (or is there at all, for a file
 * that did not exist).
 */
export function writeStep(
  deps: ExplorerStepDeps,
  path: string,
  before: Uint8Array | null,
  after: Uint8Array,
): HistoryStep {
  return {
    label: `upload ${path}`,
    bytes: (before?.length ?? 0) + after.length,
    async undo() {
      const now = await bytesNow(deps, path);
      if (now === null || !sameBytes(now, after)) return changed('undo');
      return before === null
        ? apply(deps, () => deps.files.remove(path))
        : apply(deps, () => deps.files.write(path, before));
    },
    async redo() {
      const now = await bytesNow(deps, path);
      const same = before === null ? now === null : now !== null && sameBytes(now, before);
      if (!same) return changed('redo');
      return apply(deps, () => deps.files.write(path, after));
    },
  };
}
