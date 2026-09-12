import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic, FileEntry } from '@energy8engine/contracts';

/**
 * One file, looked at, as a shell document: what `AssetsScreen` showed
 * once an entry was clicked, with the tree gone to the Explorer. Anything
 * the Explorer does not hand to `EditorDocument` lands here — images, and
 * whatever else a project holds.
 *
 * Three answers, decided in this order, and a file is fetched only for
 * the last: an entry the tree already says is too big is refused without
 * a read; an image goes into `<img>` through `ctx.files.urlFor`, so the
 * browser fetches and decodes it and this never reads the bytes; anything
 * else is read once and is either text, refused as binary, or — the tree
 * being a snapshot — gone by the time the read answers, in which case the
 * host's own diagnostic is shown unchanged and reported to the one list.
 * Every failure is words in the pane; nothing here throws or stays blank.
 */

/**
 * Bytes past which this refuses to fetch a file rather than decode a huge
 * buffer on the main thread.
 *
 * ponytail: a fixed threshold, not a streaming reader — nothing this IDE
 * shows (specs, scripts, sprites) is meant to sit above a few MB; a proper
 * asset pipeline (audio, video) is the upgrade path once that stops being
 * true.
 */
const TOO_BIG_BYTES = 5_000_000;

/** Extensions this can put in an `<img>` — the same list the host's own `CONTENT_TYPES` recognizes as an image. */
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);

/** The lower-cased extension of the last path segment, dot included; '' for none. */
export function extensionOf(path: string): string {
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
 * A NUL byte never appears in valid text of any encoding a document here
 * claims to read — the same cheap tell `file(1)` and most editors use —
 * so finding one in the leading bytes is a fast, honest signal that
 * decoding the rest would fill the pane with replacement-character mush.
 * `EditorDocument` runs the identical sniff before decoding, since a text
 * extension is a claim the bytes may not honour.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, SNIFF_BYTES).includes(0);
}

type View =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'binary' }
  /** A read that failed — most often the tree's own snapshot going stale between the click and the fetch. The host's message, unchanged. */
  | { kind: 'error'; message: string };

export function ViewerDocument({
  ctx,
  path,
  entry,
}: {
  ctx: Context;
  path: string;
  entry: FileEntry;
}): JSX.Element {
  const tooBig = entry.size !== undefined && entry.size > TOO_BIG_BYTES;
  const image = !tooBig && isImage(path);
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    if (tooBig || image) return undefined; // nothing to fetch either way
    let gone = false;
    ctx.files.read(path).then(({ bytes, diagnostics }) => {
      if (gone) return;
      if (!bytes) {
        setView({ kind: 'error', message: diagnostics[0]?.message ?? `"${path}" could not be read` });
        for (const diag of diagnostics as Diagnostic[]) ctx.connection.report(diag);
        return;
      }
      setView(
        looksBinary(bytes)
          ? { kind: 'binary' }
          : { kind: 'text', text: new TextDecoder().decode(bytes) },
      );
    });
    return () => {
      gone = true;
    };
  }, [ctx, path, tooBig, image]);

  if (tooBig) {
    return (
      <p className="e8-code-error" data-testid="too-big">
        "{path}" is too big to show here ({'>'}
        {TOO_BIG_BYTES.toLocaleString()} bytes).
      </p>
    );
  }
  if (image) return <img className="e8-viewer-image" src={ctx.files.urlFor(path)} alt={path} />;
  switch (view.kind) {
    case 'loading':
      return <p className="e8-empty">reading {path}…</p>;
    case 'text':
      return <pre className="e8-assets-text">{view.text}</pre>;
    case 'binary':
      return (
        <p className="e8-code-error" data-testid="binary">
          "{path}" doesn't look like text (it contains a NUL byte) and isn't a recognized image,
          so it isn't shown here.
        </p>
      );
    case 'error':
      return (
        <p className="e8-code-error" data-testid="open-error">
          {view.message}
        </p>
      );
  }
}
