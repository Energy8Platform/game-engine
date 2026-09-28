import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { FILE_KEY_PREFIX } from '../plugins/shell';
import { activateOnKey } from './activate';
import { EditorDocument } from './EditorDocument';
import { ExplorerMenu } from './ExplorerMenu';
import { ViewerDocument, extensionOf } from './ViewerDocument';

/**
 * One sidebar view over the project tree, registered on `shell.sidebar` —
 * replacing the two screens (`AssetsScreen`, `CodeScreen`) that each fetched
 * `ctx.files.tree()` and drew their own copy of it. `entries` is fetched
 * on mount, and again each time the shell picks this sidebar back over
 * another one (see the effect below) — folding a directory changes only
 * which rows this draws; it never re-fetches on its own (see
 * `explorer.test.tsx`'s "one tree() call, not one per fold").
 *
 * Upload and delete are the same rule `AssetsScreen`'s own doc already
 * argues for, carried over whole: the tree on screen only ever shows what
 * the host confirmed, never what a click here merely asked for. A refused
 * write/remove leaves `entries` untouched and shows the host's own words;
 * only a clean answer triggers a refetch. Both a tree-read failure and an
 * action refusal also go to `ctx.connection.report()`, so they outlive this
 * view exactly as they outlived `AssetsScreen`.
 *
 * Clicking a directory toggles its fold; clicking a file calls `openPath`.
 * Either click also selects the row: the header's "new file"/"new folder"
 * create inside the selected directory (a selected file means its own
 * directory; nothing selected means the root). Right-click opens a menu
 * of what the row can do; rename and create both edit inline, in a row
 * that holds an `<input>` until Enter or Escape. A name is checked here
 * before any request — one segment, no `/`, not `.` or `..` — since the
 * host would refuse it anyway and the words are clearer up front.
 *
 * Rows drag. A row dropped on a directory (or on a file, meaning that
 * file's directory, or on the tree's empty space, meaning the root) is a
 * move to the same name there, through the same `move` the rename uses —
 * so a refusal shows the host's words and the tree stays put, and open
 * tabs follow. A directory dropped on itself or into its own subtree is
 * dropped silently: the host would only answer into-self. A file dragged
 * in from the desktop is an upload into that directory, with the same
 * overwrite question the header control asks.
 */

/** The type an internal drag carries: the dragged row's path. Anything else on a drop is the OS's `Files`. */
const DRAG_TYPE = 'text/x-e8-path';

/** What a confirm row is currently asking about — one state for both irreversible actions, same shape `AssetsScreen` used. */
type Pending =
  | { kind: 'delete'; path: string }
  | { kind: 'overwrite'; path: string; bytes: Uint8Array; also: Diagnostic[] };

/** Which inline input is up: a new entry inside `dir`, or a new name for `path`. */
type Editing =
  { kind: 'create'; what: 'dir' | 'file'; dir: string } | { kind: 'rename'; path: string };

const joinPath = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function invalidName(name: string): string | undefined {
  if (name === '' || name.includes('/') || name === '.' || name === '..')
    return `"${name}" is not a valid name — one segment, no "/"`;
  return undefined;
}

/**
 * Extensions a person edits by hand — opened in `EditorDocument`. Anything
 * else (images first among them) goes to `ViewerDocument`, which decides
 * for itself whether the bytes are text, binary, or too big to fetch. The
 * editor runs the same binary sniff, so a `.json` that is not text is
 * refused there rather than decoded.
 */
const EDITABLE_EXTENSIONS = new Set([
  '.spin',
  '.lua', // the math script, hand-edited one slice before this list existed
  '.ts',
  '.tsx',
  '.js',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.txt',
  '.html',
  '.css',
]);

/**
 * What opens for a path: a tab keyed `f:<path>`, holding a registered
 * viewer, the editor, or the catch-all viewer, in that order. Same key
 * twice activates. The Explorer calls this with the tree's own `entry`, so
 * a `viewers` match can see the size and a file the tree already says is
 * too big is refused without a read; `App` installs it on the shell
 * (`registerPathOpener`) for everyone else — a plugin's
 * `ctx.shell.openPath(path)`, and the address resolving `#/doc/f:<path>`
 * on a cold load — where no entry is at hand and the fallback viewer reads
 * to find out.
 */
export function openPath(ctx: Context, path: string, entry?: FileEntry): void {
  const viewer = ctx.viewers.pick(path, entry);
  const editable = EDITABLE_EXTENSIONS.has(extensionOf(path));
  const Viewer = viewer?.component;
  ctx.shell.open({
    key: `${FILE_KEY_PREFIX}${path}`,
    title: path.split('/').pop() ?? path,
    component: Viewer
      ? ({ ctx: c }) => <Viewer ctx={c} path={path} entry={entry} />
      : editable
        ? ({ ctx: c }) => <EditorDocument ctx={c} path={path} />
        : ({ ctx: c }) => <ViewerDocument ctx={c} path={path} entry={entry} />,
    closable: true,
    sidebar: viewer?.sidebar,
    sideRight: viewer?.sideRight,
  });
}

/**
 * The one text field the Explorer ever shows (and the Scenes sidebar's
 * "new scene" row borrows): Enter submits, Escape or leaving it cancels.
 * An accepted submit unmounts the input, which fires `onBlur` on the way
 * out — `submitted` keeps that blur from cancelling what Enter just did.
 * A refused one (`onSubmit` returns false: the name was bad) keeps the
 * input up, with the text, to be fixed.
 */
export function InlineInput({
  initial,
  onSubmit,
  onCancel,
  testId = 'explorer-input',
  list,
  placeholder,
}: {
  initial: string;
  onSubmit(value: string): boolean;
  onCancel(): void;
  testId?: string;
  list?: string;
  placeholder?: string;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const submitted = useRef(false);
  return (
    <input
      data-testid={testId}
      className="e8-explorer-input"
      list={list}
      placeholder={placeholder}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitted.current = onSubmit(value.trim());
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (!submitted.current) onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function Explorer({ ctx }: { ctx: Context }): JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [treeDiagnostics, setTreeDiagnostics] = useState<Diagnostic[]>([]);
  // The host's answer to the most recent verb — separate from
  // `treeDiagnostics`, same split `AssetsScreen` made, for the same reason:
  // it's about an action, not the listing.
  const [actionDiagnostics, setActionDiagnostics] = useState<Diagnostic[]>([]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  // Where the next upload lands: the root from the header, a directory
  // from its own menu's "Upload here".
  const [uploadDir, setUploadDir] = useState('');
  // The directory a drag is hovering, '' for the root; drawn as `e8-drop-target`.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  function applyTree(result: { entries: FileEntry[]; diagnostics: Diagnostic[] }) {
    setEntries(result.entries);
    setTreeDiagnostics(result.diagnostics);
    report(result.diagnostics);
  }

  function report(diagnostics: Diagnostic[]) {
    for (const diag of diagnostics) ctx.connection.report(diag);
  }

  useEffect(() => {
    let cancelled = false;
    ctx.files.tree().then((result) => {
      if (!cancelled) applyTree(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // A `shell.sidebar` entry shown once stays MOUNTED, just hidden, while
  // another takes over (Shell's own rule) — so unlike the old per-activity
  // screens, coming back to Explorer is not a fresh mount, and the fetch
  // above runs only that first time. `files.ts` pushes no live frame of
  // its own for a change another part of the app makes (the Scenes
  // sidebar's "add scene", a symbol import), so without this an already-
  // shown Explorer would keep drawing the tree as it stood before that
  // change until a reload. `'explorer'` is the key `App.tsx` registers
  // this component under; the ref is this component's own memory of
  // whether IT was the one shown last time this fired, so the refetch
  // happens only on the hidden→shown edge, never on every shell change
  // (a panel toggle, another tab's own pick) while Explorer already shows.
  const wasShown = useRef(ctx.shell.sidebar() === 'explorer');
  useEffect(
    () =>
      ctx.shell.subscribe(() => {
        const isShown = ctx.shell.sidebar() === 'explorer';
        if (isShown && !wasShown.current) void refreshTree();
        wasShown.current = isShown;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx],
  );

  // Shared by every verb: the only path that ever changes what `entries`
  // shows, and only ever called once the host has confirmed the change
  // actually happened.
  function refreshTree(): Promise<void> {
    return ctx.files.tree().then(applyTree);
  }

  /** The host's answer to a verb: shown, reported, and a refetch unless something failed (a warning rides along with a change that happened). */
  function finish(diagnostics: Diagnostic[]) {
    setActionDiagnostics(diagnostics);
    report(diagnostics);
    if (!diagnostics.some((diag) => diag.severity === 'error')) void refreshTree();
  }

  /** `also`: this view's own words about the upload, shown next to the host's answer once it lands. */
  function upload(path: string, bytes: Uint8Array, also: Diagnostic[] = []) {
    ctx.files.write(path, bytes).then(({ diagnostics }) => finish([...diagnostics, ...also]));
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // lets the same name be picked again
    if (file) readAndUpload(file, uploadDir);
    setUploadDir('');
  }

  /** A `File` off disk goes into `dir` under its own name — after the replace question when that name is taken. */
  function readAndUpload(file: File, dir: string, also: Diagnostic[] = []) {
    const path = joinPath(dir, file.name);
    // `FileReader`, not `file.arrayBuffer()` — see `AssetsScreen`'s own
    // comment: jsdom's shim only implements the callback-style reader.
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      if (entries?.some((entry) => entry.kind === 'file' && entry.path === path)) {
        setActionDiagnostics([]);
        setPending({ kind: 'overwrite', path, bytes, also });
        return;
      }
      upload(path, bytes, also);
    };
    reader.onerror = () => {
      const own = [
        diagnostic(
          'error',
          'files',
          file.name,
          `"${file.name}" could not be read from disk: ${reader.error?.message ?? 'unknown error'}`,
        ),
      ];
      setActionDiagnostics(own);
      report(own);
    };
    reader.readAsArrayBuffer(file);
  }

  function askDelete(path: string) {
    setActionDiagnostics([]); // an older refusal shouldn't linger over a new question
    setPending({ kind: 'delete', path });
  }

  function cancel() {
    setPending(null);
  }

  function confirm(asked: Pending) {
    setPending(null);
    if (asked.kind === 'overwrite') {
      upload(asked.path, asked.bytes, asked.also);
      return;
    }
    ctx.files.remove(asked.path).then(({ diagnostics }) => {
      finish(diagnostics);
      // A gone entry can't stay the target for "new file"/"new folder".
      if (diagnostics.length === 0)
        setSelected((prev) =>
          prev !== null && (prev === asked.path || prev.startsWith(`${asked.path}/`)) ? null : prev,
        );
    });
  }

  /** Where "new file"/"new folder" from the header go: the selected directory, a selected file's directory, or the root. */
  function targetDir(): string {
    if (selected === null) return '';
    return entries?.find((e) => e.path === selected)?.kind === 'dir' ? selected : dirOf(selected);
  }

  function startCreate(what: 'dir' | 'file', dir: string) {
    setActionDiagnostics([]);
    setEditing({ kind: 'create', what, dir });
    // The input row sits under `dir`; a folded one would swallow it.
    setFolded((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
  }

  function startRename(path: string) {
    setActionDiagnostics([]);
    setEditing({ kind: 'rename', path });
  }

  /**
   * A moved path takes its open tabs along: the document at `from`, and
   * — for a directory — every document under it, each closed (force: the
   * old path no longer exists to save to) and reopened at the new one.
   * No `entry` for `openPath`: the tree is being refetched right now, and
   * `viewers.pick` falls back to the extension.
   */
  function followMove(from: string, to: string) {
    const oldKey = `${FILE_KEY_PREFIX}${from}`;
    for (const doc of ctx.shell.documents()) {
      if (doc.key !== oldKey && !doc.key.startsWith(`${oldKey}/`)) continue;
      const newPath = to + doc.key.slice(oldKey.length);
      ctx.shell.close(doc.key, { force: true });
      openPath(ctx, newPath);
    }
  }

  /**
   * The one move both the rename input and a drop go through. Refused
   * here, before any request, when a tab at `from` (or under it) has
   * unsaved edits — `followMove` closes with `force`, so the move would
   * otherwise discard them silently.
   */
  function move(from: string, to: string) {
    const oldKey = `${FILE_KEY_PREFIX}${from}`;
    const dirty = ctx.shell
      .documents()
      .some((doc) => doc.dirty && (doc.key === oldKey || doc.key.startsWith(`${oldKey}/`)));
    if (dirty) {
      finish([
        diagnostic(
          'error',
          'files',
          from,
          `"${from}" has unsaved changes — save or close it before renaming or moving`,
        ),
      ]);
      return;
    }
    void ctx.files.move(from, to).then(({ diagnostics }) => {
      finish(diagnostics);
      if (diagnostics.length === 0) followMove(from, to);
    });
  }

  /** Enter in the inline input. Returns whether the name was accepted — a bad one is refused here, before any request. */
  function submitEditing(e: Editing, name: string): boolean {
    const bad = invalidName(name);
    if (bad) {
      const own = [{ ...diagnostic('error', 'files', name, bad), code: 'malformed-request' }];
      setActionDiagnostics(own);
      report(own);
      return false;
    }
    setEditing(null);
    if (e.kind === 'create') {
      const path = joinPath(e.dir, name);
      const request = e.what === 'dir' ? ctx.files.mkdir(path) : ctx.files.create(path);
      void request.then(({ diagnostics }) => finish(diagnostics));
      return true;
    }
    const to = joinPath(dirOf(e.path), name);
    if (to !== e.path) move(e.path, to);
    return true;
  }

  /** Where a drop on `entry` lands: the directory itself, or a file's directory. (The tree's own space is the root, `''`.) */
  const dropDirFor = (entry: FileEntry) => (entry.kind === 'dir' ? entry.path : dirOf(entry.path));

  function onDragStart(entry: FileEntry, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData(DRAG_TYPE, entry.path);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(target: string, e: DragEvent<HTMLElement>) {
    // Only what this view knows how to take: its own rows, or files from outside.
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? 'move' : 'copy';
    if (dropTarget !== target) setDropTarget(target);
  }

  function onDragLeave(target: string) {
    if (dropTarget === target) setDropTarget(null);
  }

  function onDrop(target: string, e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const from = e.dataTransfer.getData(DRAG_TYPE);
    if (from) {
      const to = joinPath(target, baseOf(from));
      // Dropping a directory on itself or into its own subtree: the host
      // would answer into-self; nothing to ask.
      if (to === from || target === from || target.startsWith(`${from}/`)) return;
      move(from, to);
      return;
    }
    const files = e.dataTransfer.files;
    const file = files[0];
    if (!file) return;
    // ponytail: one upload per drop — the replace question is per-file and
    // modal; a batch would need a queue. Said, not swallowed.
    const also =
      files.length > 1
        ? [
            diagnostic(
              'warning',
              'files',
              target || '.',
              `only "${file.name}" was uploaded — drop files one at a time`,
            ),
          ]
        : [];
    readAndUpload(file, target, also);
  }

  function toggleFold(path: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  /** Hidden when some folded directory is a strict ancestor of this entry. */
  function isHidden(entry: FileEntry): boolean {
    for (const dir of folded) {
      if (entry.path.startsWith(`${dir}/`)) return true;
    }
    return false;
  }

  function select(entry: FileEntry) {
    setSelected(entry.path);
    if (entry.kind === 'dir') {
      toggleFold(entry.path);
      return;
    }
    openPath(ctx, entry.path, entry);
  }

  function menuItems(entry: FileEntry) {
    const own = [
      { label: 'Rename', onPick: () => startRename(entry.path) },
      { label: 'Delete', onPick: () => askDelete(entry.path) },
    ];
    if (entry.kind === 'file') return own;
    return [
      { label: 'New file', onPick: () => startCreate('file', entry.path) },
      { label: 'New folder', onPick: () => startCreate('dir', entry.path) },
      {
        label: 'Upload here',
        onPick: () => {
          setUploadDir(entry.path);
          uploadInput.current?.click();
        },
      },
      ...own,
    ];
  }

  const visible = (entries ?? []).filter((entry) => !isHidden(entry));

  /** The row that holds the "new file"/"new folder" input, indented one level under `dir`. */
  function createRow(dir: string) {
    if (editing?.kind !== 'create' || editing.dir !== dir) return null;
    const depth = dir === '' ? 0 : dir.split('/').length;
    return (
      <li key={`/new:${dir}`} className="e8-explorer-entry" style={{ paddingLeft: 8 + depth * 12 }}>
        <span className="e8-explorer-chevron" aria-hidden="true" />
        <InlineInput
          initial=""
          onSubmit={(name) => submitEditing(editing, name)}
          onCancel={() => setEditing(null)}
        />
      </li>
    );
  }

  /** What the delete confirm asks: a directory's count is everything under it, the directory itself excluded. */
  function confirmText(entry: FileEntry): string {
    if (pending?.kind === 'overwrite') return `replace "${entry.path}"?`;
    if (entry.kind === 'file') return `delete "${entry.path}"?`;
    const count = (entries ?? []).filter((e) => e.path.startsWith(`${entry.path}/`)).length;
    return `delete folder "${entry.path}" and ${count} entries?`;
  }

  return (
    <div className="e8-explorer">
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">Explorer</span>
        <span className="e8-explorer-actions">
          <button
            type="button"
            className="e8-explorer-action"
            data-testid="explorer-new-file"
            title="new file"
            aria-label="new file"
            onClick={() => startCreate('file', targetDir())}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M9 2H4v12h8V5zM9 2v3h3M6 9h4M8 7v4" />
            </svg>
          </button>
          <button
            type="button"
            className="e8-explorer-action"
            data-testid="explorer-new-folder"
            title="new folder"
            aria-label="new folder"
            onClick={() => startCreate('dir', targetDir())}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M2 4v9h12V6H8L6.5 4zM8 8v3M6.5 9.5h3" />
            </svg>
          </button>
          {/* The one upload control, as an icon in the view's header — the
              input itself is visually hidden by the stylesheet and reached
              through the label, or clicked by a directory's "Upload here". */}
          <label
            className="e8-explorer-upload"
            title="upload file"
            onClick={(e) => {
              // The header control always uploads to the root. A dismissed
              // "Upload here" picker fires no change, so `uploadDir` would
              // still name that folder — reset it before the browser's
              // synthesized click on the input. That synthesized click (and
              // "Upload here"'s own `input.click()`) bubbles back through
              // here with the input as target, and must not undo the folder.
              if (e.target !== uploadInput.current) setUploadDir('');
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" />
            </svg>
            <input
              ref={uploadInput}
              type="file"
              data-testid="explorer-upload"
              aria-label="upload file"
              onChange={handleUpload}
            />
          </label>
        </span>
      </div>

      {treeDiagnostics.length > 0 &&
        treeDiagnostics.map((diag, i) => (
          <p className="e8-explorer-diagnostic" key={`tree-${i}`}>
            {diag.message}
          </p>
        ))}

      {actionDiagnostics.length > 0 &&
        actionDiagnostics.map((diag, i) => (
          <p className="e8-explorer-diagnostic" key={`action-${i}`}>
            {diag.message}
          </p>
        ))}

      {entries !== null && entries.length === 0 && treeDiagnostics.length === 0 && (
        <p className="e8-empty" data-testid="explorer-empty">
          the project has no files yet
        </p>
      )}

      {entries !== null && (entries.length > 0 || editing !== null) && (
        <ul
          className={dropTarget === '' ? 'e8-explorer-tree e8-drop-target' : 'e8-explorer-tree'}
          data-testid="explorer-root"
          onDragOver={(e) => onDragOver('', e)}
          onDragLeave={() => onDragLeave('')}
          onDrop={(e) => onDrop('', e)}
        >
          {createRow('')}
          {visible.flatMap((entry) => {
            const segments = entry.path.split('/');
            const depth = segments.length - 1;
            const isFile = entry.kind === 'file';
            const isFolded = folded.has(entry.path);
            const renaming = editing?.kind === 'rename' && editing.path === entry.path;
            const row = (
              <li
                key={entry.path}
                data-testid={`explorer-${entry.path}`}
                role="button"
                tabIndex={0}
                // A draggable ancestor takes the mouse from the rename input
                // (no caret, no selection, in Firefox) — not while it is up.
                draggable={!renaming}
                style={{ paddingLeft: 8 + depth * 12 }}
                className={[
                  'e8-explorer-entry',
                  isFile ? 'e8-explorer-file' : 'e8-explorer-dir',
                  selected === entry.path ? 'e8-explorer-selected' : '',
                  // A file row highlights nothing itself: its directory's row does.
                  !isFile && dropTarget === entry.path ? 'e8-drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => select(entry)}
                onDragStart={(e) => onDragStart(entry, e)}
                onDragOver={(e) => onDragOver(dropDirFor(entry), e)}
                onDragLeave={() => onDragLeave(dropDirFor(entry))}
                onDrop={(e) => onDrop(dropDirFor(entry), e)}
                onKeyDown={activateOnKey(() => select(entry))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, entry });
                }}
              >
                {/* Depth is the indent, so the label is the last segment
                    alone; a file gets an empty chevron cell to line up. */}
                <span className="e8-explorer-chevron" aria-hidden="true">
                  {isFile ? '' : isFolded ? '▸' : '▾'}
                </span>
                {renaming ? (
                  <InlineInput
                    initial={baseOf(entry.path)}
                    onSubmit={(name) => submitEditing(editing, name)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span className="e8-explorer-name">{segments[segments.length - 1]}</span>
                )}
                {pending?.path === entry.path ? (
                  <span className="e8-explorer-confirm">
                    {' '}
                    {confirmText(entry)}{' '}
                    <button
                      type="button"
                      data-testid="confirm-yes"
                      className="e8-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirm(pending);
                      }}
                    >
                      yes
                    </button>{' '}
                    <button
                      type="button"
                      data-testid="confirm-no"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancel();
                      }}
                    >
                      no
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid={`explorer-delete-${entry.path}`}
                    className="e8-explorer-delete"
                    aria-label={`delete ${entry.path}`}
                    title="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      askDelete(entry.path);
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
            const created = isFile ? null : createRow(entry.path);
            return created ? [row, created] : [row];
          })}
        </ul>
      )}

      {menu && (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
