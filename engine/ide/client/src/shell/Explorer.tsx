import { useEffect, useState, type ChangeEvent, type ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';

/**
 * One sidebar view over the project tree, registered on `shell.sidebar` —
 * replacing the two screens (`AssetsScreen`, `CodeScreen`) that each fetched
 * `ctx.files.tree()` and drew their own copy of it. `entries` is fetched
 * once on mount; folding a directory only ever changes which rows this
 * draws — it never re-fetches (see `explorer.test.tsx`'s "one tree() call,
 * not one per fold").
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
 */

/** What a confirm row is currently asking about — one state for both irreversible actions, same shape `AssetsScreen` used. */
type Pending =
  { kind: 'delete'; path: string } | { kind: 'overwrite'; path: string; bytes: Uint8Array };

/**
 * What Explorer opens for a path. Task 5 provides the two real document
 * kinds (editor / asset viewer) and picks between them off `entry`; until
 * then this opens a placeholder tab so the shell gets a real key and a real
 * tab to activate — proving the plumbing this task owns without deciding
 * what Task 5 will actually render there.
 */
export function openPath(ctx: Context, path: string, entry: FileEntry): void {
  void entry; // unused until Task 5 branches on kind/extension
  ctx.shell.open({
    key: `f:${path}`,
    title: path.split('/').pop() ?? path,
    component: placeholderDocument(path),
    closable: true,
  });
}

function placeholderDocument(path: string): ComponentType<{ ctx: Context }> {
  return function PlaceholderDocument() {
    return <p data-testid="explorer-placeholder">{path}</p>;
  };
}

export function Explorer({ ctx }: { ctx: Context }): JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [treeDiagnostics, setTreeDiagnostics] = useState<Diagnostic[]>([]);
  // The host's answer to the most recent upload or delete — separate from
  // `treeDiagnostics`, same split `AssetsScreen` made, for the same reason:
  // it's about an action, not the listing.
  const [actionDiagnostics, setActionDiagnostics] = useState<Diagnostic[]>([]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

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

  // Shared by upload and delete: the only path that ever changes what
  // `entries` shows, and only ever called once the host has confirmed the
  // change actually happened.
  function refreshTree(): Promise<void> {
    return ctx.files.tree().then(applyTree);
  }

  function upload(path: string, bytes: Uint8Array) {
    ctx.files.write(path, bytes).then(({ diagnostics }) => {
      setActionDiagnostics(diagnostics);
      report(diagnostics);
      if (diagnostics.length === 0) void refreshTree();
    });
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // lets the same name be picked again
    if (!file) return;
    // `FileReader`, not `file.arrayBuffer()` — see `AssetsScreen`'s own
    // comment: jsdom's shim only implements the callback-style reader.
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      if (entries?.some((entry) => entry.kind === 'file' && entry.path === file.name)) {
        setActionDiagnostics([]);
        setPending({ kind: 'overwrite', path: file.name, bytes });
        return;
      }
      upload(file.name, bytes);
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
      upload(asked.path, asked.bytes);
      return;
    }
    ctx.files.remove(asked.path).then(({ diagnostics }) => {
      setActionDiagnostics(diagnostics);
      report(diagnostics);
      if (diagnostics.length === 0) void refreshTree();
    });
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
    if (entry.kind === 'dir') {
      toggleFold(entry.path);
      return;
    }
    openPath(ctx, entry.path, entry);
  }

  const visible = (entries ?? []).filter((entry) => !isHidden(entry));

  return (
    <div className="e8-explorer">
      <input
        type="file"
        data-testid="explorer-upload"
        className="e8-explorer-upload"
        onChange={handleUpload}
      />

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

      {entries === null ? null : entries.length === 0 && treeDiagnostics.length === 0 ? (
        <p className="e8-empty" data-testid="explorer-empty">
          the project has no files yet
        </p>
      ) : entries.length > 0 ? (
        <ul className="e8-explorer-tree">
          {visible.map((entry) => {
            const depth = entry.path.split('/').length - 1;
            const isFile = entry.kind === 'file';
            const isFolded = folded.has(entry.path);
            return (
              <li
                key={entry.path}
                data-testid={`explorer-${entry.path}`}
                role="button"
                tabIndex={0}
                style={{ paddingLeft: 14 + depth * 12 }}
                className={
                  isFile
                    ? 'e8-explorer-entry e8-explorer-file'
                    : 'e8-explorer-entry e8-explorer-dir'
                }
                onClick={() => select(entry)}
              >
                {isFile ? '' : isFolded ? '▸ ' : '▾ '}
                {entry.path}
                {pending?.path === entry.path ? (
                  <span className="e8-explorer-confirm">
                    {' '}
                    {pending.kind === 'delete' ? 'delete' : 'replace'} "{entry.path}"?{' '}
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
                  // Files only — a directory row's only possible answer is a
                  // refusal (`remove()` does not remove directories), same
                  // rule `AssetsScreen` already applies to its own delete
                  // button.
                  isFile && (
                    <button
                      type="button"
                      data-testid={`explorer-delete-${entry.path}`}
                      className="e8-explorer-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        askDelete(entry.path);
                      }}
                    >
                      delete
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
