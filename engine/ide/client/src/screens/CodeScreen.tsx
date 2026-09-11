import { useEffect, useRef, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic, FileEntry } from '@energy8engine/contracts';
import { Monaco } from '../editor/Monaco';

/**
 * §5 of the design spec: "Monaco для `plugins/**` и `game/script.spin`,
 * маркеры от `e8 check`." Everything this screen needs already exists —
 * `ctx.files` for the tree and the bytes, `ctx.check` for what is wrong
 * with text that was never saved, `Diagnostic.at` and `<Monaco/>` for
 * turning that into a marker. This screen is only the wiring between them.
 *
 * The tree comes from the same `ctx.files.tree()` the assets screen calls —
 * a second walk of the same project would be a second source of truth for
 * "what files exist" for no reason. What differs is the filter: a project
 * has sprites and spec JSON in it too, and this screen can help with none
 * of that — only `game/script.spin` and anything under `plugins/` is
 * something a human edits by hand (the rest is written by the IDE itself,
 * per the spec's own "Руками правятся ровно две вещи").
 *
 * Two things this screen does that the assets screen's own comment already
 * argues for, reused rather than reinvented:
 *
 *  - **Both readers, one report.** A save the host refuses goes to the
 *    paragraph next to the button AND to `ctx.connection.report()` — the
 *    one list that outlives this screen. Slice 5's own finding, repeated
 *    here rather than repeating its mistake: a diagnostic that lives only
 *    in this component's state is gone the moment someone switches tabs.
 *  - **Confirm before discarding.** Switching to a different file while the
 *    current one has unsaved edits is the one irreversible thing here —
 *    same shape as the assets screen's delete confirmation (an inline
 *    yes/no next to the thing that was clicked), because it is the same
 *    question: throw away work, or not.
 *
 * **The stale-check race is this screen's problem, not the service's**
 * (Ruling 9 of this slice's ledger): `ctx.check` is a bare `fetch` with no
 * sequence slot, so two in-flight calls can resolve in either order. A
 * monotonic counter (`checkSeq`) is bumped on every call this screen makes
 * — to `ctx.check.check` on a keystroke, and to invalidate a stale
 * in-flight call when the open file changes — and a response is only ever
 * applied if it is still the most recent call issued. An answer for text
 * nobody is looking at anymore is simply dropped, whichever order the
 * network hands the two back.
 */

/** `game/script.spin` and anything under `plugins/` — the two things the spec says are edited by hand. */
function isEditable(entry: FileEntry): boolean {
  return (
    entry.kind === 'file' &&
    (entry.path === 'game/script.spin' || entry.path.startsWith('plugins/'))
  );
}

export function CodeScreen({ ctx }: { ctx: Context }): JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [treeDiagnostics, setTreeDiagnostics] = useState<Diagnostic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  // The last text this screen knows the host actually holds — from the
  // read that opened the file, or the write that last saved it. `text !==
  // savedText` is the one fact "unsaved changes" reduces to.
  const [savedText, setSavedText] = useState('');
  const [checkDiagnostics, setCheckDiagnostics] = useState<Diagnostic[]>([]);
  const [saveDiagnostics, setSaveDiagnostics] = useState<Diagnostic[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  // The file a click asked to open while the current one still has unsaved
  // edits — asked about, not yet acted on. Null means nothing is pending.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const checkSeq = useRef(0);

  /** Into the one list that outlives this screen — same call the assets screen makes. */
  function report(diagnostics: Diagnostic[]) {
    for (const diag of diagnostics) ctx.connection.report(diag);
  }

  useEffect(() => {
    let cancelled = false;
    ctx.files.tree().then((result) => {
      if (cancelled) return;
      setEntries(result.entries);
      setTreeDiagnostics(result.diagnostics);
      report(result.diagnostics);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const editable = (entries ?? []).filter(isEditable);

  /** Issues a check for `source`, applying the answer only if nothing newer has been asked since. */
  function runCheck(source: string) {
    const seq = ++checkSeq.current;
    ctx.check.check(source).then(({ diagnostics }) => {
      if (seq === checkSeq.current) setCheckDiagnostics(diagnostics);
    });
  }

  function openFile(path: string) {
    setOpenError(null);
    ctx.files.read(path).then(({ bytes, diagnostics }) => {
      if (!bytes) {
        // The tree is a snapshot; the file can be gone by the time this
        // resolves — the assets screen met the same race on its own
        // listing. The host's own diagnostic says why.
        const message = diagnostics[0]?.message ?? `"${path}" could not be read`;
        setOpenError(message);
        report(diagnostics);
        return;
      }
      const source = new TextDecoder().decode(bytes);
      // Bumped before any state changes: any check still in flight for the
      // file being left behind must never be allowed to land on this one,
      // however long it takes to answer.
      checkSeq.current += 1;
      setSelected(path);
      setText(source);
      setSavedText(source);
      setCheckDiagnostics([]);
      setSaveDiagnostics([]);
    });
  }

  function select(path: string) {
    if (selected !== null && selected !== path && text !== savedText) {
      setPendingSwitch(path);
      return;
    }
    openFile(path);
  }

  function save() {
    if (selected === null) return;
    const path = selected;
    ctx.files.write(path, new TextEncoder().encode(text)).then(({ diagnostics }) => {
      setSaveDiagnostics(diagnostics);
      report(diagnostics);
      if (diagnostics.length === 0) setSavedText(text);
    });
  }

  return (
    <main className="e8-code">
      <h1>Код</h1>

      {treeDiagnostics.length > 0 &&
        treeDiagnostics.map((diag, i) => (
          <p className="e8-code-diagnostic" key={`tree-${i}`}>
            {diag.message}
          </p>
        ))}

      <div className="e8-code-body">
        {entries === null ? null : editable.length === 0 ? (
          <p className="e8-empty" data-testid="code-empty">
            the project has no editable files yet
          </p>
        ) : (
          <ul className="e8-code-files">
            {editable.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  data-testid={`file-${entry.path}`}
                  aria-pressed={entry.path === selected}
                  onClick={() => select(entry.path)}
                >
                  {entry.path}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="e8-code-editor">
          {pendingSwitch !== null && (
            <p className="e8-code-confirm">
              discard unsaved changes to "{selected}"?{' '}
              <button
                type="button"
                data-testid="confirm-yes"
                onClick={() => {
                  const path = pendingSwitch;
                  setPendingSwitch(null);
                  openFile(path);
                }}
              >
                yes
              </button>{' '}
              <button type="button" data-testid="confirm-no" onClick={() => setPendingSwitch(null)}>
                no
              </button>
            </p>
          )}

          {openError !== null && (
            <p className="e8-code-error" data-testid="open-error">
              {openError}
            </p>
          )}

          {saveDiagnostics.length > 0 &&
            saveDiagnostics.map((diag, i) => (
              <p className="e8-code-diagnostic" key={`save-${i}`}>
                {diag.message}
              </p>
            ))}

          {selected === null ? (
            <p className="e8-empty" data-testid="editor-empty">
              select a file to edit
            </p>
          ) : (
            <>
              <button type="button" onClick={save}>
                save
              </button>
              <Monaco
                value={text}
                language={selected.endsWith('.spin') ? 'spin' : 'plaintext'}
                diagnostics={checkDiagnostics}
                onChange={(next) => {
                  setText(next);
                  runCheck(next);
                }}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
