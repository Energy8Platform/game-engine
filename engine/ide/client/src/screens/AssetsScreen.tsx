import { useEffect, useState, type ChangeEvent } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';

/**
 * The project's own tree, and what one entry in it actually contains —
 * `ctx.files.tree()`/`read()`/`urlFor()` (Tasks 1-4) made this data
 * reachable from the browser; this is the first screen that draws it,
 * and — with `write()`/`remove()` below — the one that changes it.
 *
 * ponytail: the whole tree is fetched once on mount, not streamed or
 * paginated — an actual game project (a spec, a script, a handful of
 * sprites) is a few hundred entries at most, well inside what one JSON
 * response and one `<ul>` render comfortably. Paging becomes worth it if a
 * project ever grows into the thousands of files a node_modules-shaped
 * tree would have — `SKIPPED_DIRS` on the host already keeps that out.
 *
 * Upload and delete, on top of the tree Task 5 drew, follow one rule: the
 * tree on screen only ever shows what the host has confirmed, never what a
 * click here merely asked for. A write or a remove that comes back with
 * diagnostics leaves `entries` untouched and shows the host's own words
 * instead; only a clean `{ diagnostics: [] }` triggers a re-fetch of the
 * tree, which is also the only way an upload becomes visible without a
 * page reload.
 *
 * Every diagnostic this screen receives goes two places: to the `<p>`
 * below, where the person who just acted is already looking, and to
 * `ctx.connection.report()`, which is the one list §8 of the design spec
 * wants — outliving this screen, visible to the game, the IDE and an
 * agent alike. This screen used to do only the first, so navigating away
 * took the refusal with it and nothing outside this tab ever saw it. Two
 * readers, one report.
 */

/** Bytes past which this screen refuses to fetch a file's contents rather than decode a huge buffer on the main thread.
 * ponytail: a fixed threshold, not a streaming reader — nothing this editor
 * shows (specs, scripts, sprites) is meant to sit above a few MB; a proper
 * asset pipeline (audio, video) is the upgrade path once that stops being true. */
const TOO_BIG_BYTES = 5_000_000;

/** Extensions this screen can put in an `<img>` — the same list the host's own `CONTENT_TYPES` recognizes as an image. */
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** How many leading bytes `looksBinary` samples — enough to catch a real binary file's header without reading the whole thing. */
const SNIFF_BYTES = 8000;

/**
 * A NUL byte never appears in valid text of any encoding a screen here
 * claims to read — the same cheap tell `file(1)` and most editors use — so
 * finding one in the leading bytes is a fast, honest signal that decoding
 * the rest would just fill the pane with replacement-character mush
 * instead of throwing or staying blank. Exported: `CodeScreen` reads
 * `plugins/**`, which is just as free to hold a binary file as this
 * screen's own tree is, and needs the identical refusal rather than a
 * second copy of it.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, SNIFF_BYTES).includes(0);
}

/** The message of an error preview about this exact path — `undefined` for every other preview state or a different entry. */
function errorFor(preview: Preview, path: string): string | undefined {
  return preview.kind === 'error' && preview.path === path ? preview.message : undefined;
}

/** What a confirm row is currently asking about — see `pending` below. */
type Pending =
  { kind: 'delete'; path: string } | { kind: 'overwrite'; path: string; bytes: Uint8Array };

type Preview =
  | { kind: 'none' }
  | { kind: 'loading'; path: string }
  | { kind: 'image'; path: string; url: string }
  | { kind: 'text'; path: string; text: string }
  | { kind: 'too-big'; path: string }
  /** Read fine, but not text and not a recognized image extension — shown as a refusal instead of decoded mush. */
  | { kind: 'binary'; path: string }
  /** A read that failed — most often the tree's own snapshot going stale between the click and the fetch. The host's message, unchanged. */
  | { kind: 'error'; path: string; message: string };

export function AssetsScreen({ ctx }: { ctx: Context }): JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [treeDiagnostics, setTreeDiagnostics] = useState<Diagnostic[]>([]);
  const [preview, setPreview] = useState<Preview>({ kind: 'none' });
  // The host's answer to the most recent upload or delete — separate from
  // `treeDiagnostics` because it's about an action, not the listing, and
  // has to survive independently of whatever the tree itself is doing.
  const [actionDiagnostics, setActionDiagnostics] = useState<Diagnostic[]>([]);
  // What this screen is currently asking about, and why. Both irreversible
  // things here ask first: a delete, and an upload whose name collides
  // with a file already there — a person who drags in `logo.png` twice did
  // not ask to lose the first one, and the host replaces a file whole
  // without a word. One state and one confirm row for both, rather than a
  // second dialog that would do the same job in different words.
  const [pending, setPending] = useState<Pending | null>(null);

  function applyTree(result: { entries: FileEntry[]; diagnostics: Diagnostic[] }) {
    setEntries(result.entries);
    setTreeDiagnostics(result.diagnostics);
    report(result.diagnostics);
  }

  /**
   * Into the one list that outlives this screen. `report` dedupes a
   * byte-identical repeat on its own (see connection.ts), so re-reporting
   * the same still-unresolved tree diagnostic on every refresh costs
   * nothing.
   */
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
  }, [ctx]);

  // Shared by upload and delete: the only path that ever changes what
  // `entries` shows, and only ever called after the host has said the
  // change actually happened.
  function refreshTree(): Promise<void> {
    return ctx.files.tree().then(applyTree);
  }

  /** The write itself, past whatever confirming the collision needed. */
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
    // `FileReader`, not `file.arrayBuffer()` — jsdom's `File`/`Blob` shim
    // (the whole reason this screen is testable without a real browser)
    // implements the older reader API but not the newer promise-returning
    // one, and this needs to run under both.
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
    // Every other failure path on this screen surfaces something — the
    // tree fetch, a read, a write, a remove. A file the browser itself
    // can't read off disk (yanked media, a permissions error) is rare,
    // but rare isn't a reason to go back to silent; it's this one path's
    // own diagnostic, since the host never saw the request at all.
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

  function select(entry: FileEntry) {
    if (entry.size !== undefined && entry.size > TOO_BIG_BYTES) {
      setPreview({ kind: 'too-big', path: entry.path });
      return;
    }
    if (isImage(entry.path)) {
      // The point of `urlFor`: the browser fetches and decodes the image
      // itself, so this screen never reads the bytes to show one.
      setPreview({ kind: 'image', path: entry.path, url: ctx.files.urlFor(entry.path) });
      return;
    }
    setPreview({ kind: 'loading', path: entry.path });
    ctx.files.read(entry.path).then(({ bytes, diagnostics }) => {
      if (!bytes) {
        // The tree is a snapshot; the file the entry named can be gone by
        // the time this resolves. The host's own diagnostic says why —
        // passed through unchanged, same as `files.ts`'s own rule.
        const message = diagnostics[0]?.message ?? `"${entry.path}" could not be read`;
        setPreview({ kind: 'error', path: entry.path, message });
        report(diagnostics);
        return;
      }
      if (looksBinary(bytes)) {
        setPreview({ kind: 'binary', path: entry.path });
        return;
      }
      setPreview({ kind: 'text', path: entry.path, text: new TextDecoder().decode(bytes) });
    });
  }

  return (
    <main className="e8-assets">
      <h1>Ассеты</h1>

      <input
        type="file"
        data-testid="upload"
        className="e8-assets-upload"
        onChange={handleUpload}
      />

      {treeDiagnostics.length > 0 &&
        treeDiagnostics.map((diag, i) => (
          <p className="e8-assets-diagnostic" key={i}>
            {diag.message}
          </p>
        ))}

      {actionDiagnostics.length > 0 &&
        actionDiagnostics.map((diag, i) => (
          <p className="e8-assets-diagnostic" key={`action-${i}`}>
            {diag.message}
          </p>
        ))}

      {entries === null ? null : entries.length === 0 && treeDiagnostics.length === 0 ? (
        <p className="e8-empty" data-testid="assets-empty">
          the project has no files yet
        </p>
      ) : entries.length > 0 ? (
        <ul className="e8-assets-tree">
          {entries.map((entry) => {
            const depth = entry.path.split('/').length - 1;
            const isFile = entry.kind === 'file';
            // A failed read is reported ON the entry that failed, as one
            // combined string, rather than in a separate panel that would
            // just repeat the same path a second time on screen — the
            // entry that went stale is exactly where a human is already
            // looking.
            const error = errorFor(preview, entry.path);
            const label = error === undefined ? entry.path : `${entry.path} — ${error}`;
            return (
              <li
                key={entry.path}
                data-testid={`entry-${entry.path}`}
                role={isFile ? 'button' : undefined}
                tabIndex={isFile ? 0 : undefined}
                style={{ paddingLeft: depth * 12 }}
                className={
                  isFile
                    ? `e8-assets-entry e8-assets-file${error === undefined ? '' : ' e8-assets-file-error'}`
                    : 'e8-assets-entry e8-assets-dir'
                }
                onClick={isFile ? () => select(entry) : undefined}
              >
                {label}
                {pending?.path === entry.path ? (
                  <span className="e8-assets-confirm">
                    {' '}
                    {pending.kind === 'delete' ? 'delete' : 'replace'} "{entry.path}"?{' '}
                    <button
                      type="button"
                      data-testid="confirm-yes"
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
                  // Files only. A directory row used to get one too, and
                  // its only possible outcome was a refusal: `remove()`
                  // does not remove directories, and the row's own click
                  // handler is already file-gated.
                  isFile && (
                    <button
                      type="button"
                      data-testid={`delete-${entry.path}`}
                      className="e8-assets-delete"
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

      {preview.kind === 'loading' && <p>reading {preview.path}…</p>}
      {preview.kind === 'image' && <img src={preview.url} alt={preview.path} />}
      {preview.kind === 'text' && <pre className="e8-assets-text">{preview.text}</pre>}
      {preview.kind === 'too-big' && (
        <p data-testid="too-big">
          "{preview.path}" is too big to show here ({'>'}
          {TOO_BIG_BYTES.toLocaleString()} bytes).
        </p>
      )}
      {preview.kind === 'binary' && (
        <p data-testid="binary">
          "{preview.path}" doesn't look like text (it contains a NUL byte) and isn't a recognized
          image, so it isn't shown here.
        </p>
      )}
    </main>
  );
}
