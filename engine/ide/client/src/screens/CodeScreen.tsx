import { useEffect, useRef, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic, FileEntry } from '@energy8engine/contracts';
import { Monaco } from '../editor/Monaco';
import { looksBinary } from './AssetsScreen';

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
 * per the spec's own "Руками правятся ровно две вещи"). `plugins/**` can
 * still hold a binary file (an icon shipped inside a project plugin, say),
 * so opening one runs the assets screen's own `looksBinary` sniff before
 * decoding — reused, not copied, for the identical refusal instead of
 * garbage in the editor.
 *
 * Two things this screen does that the assets screen's own comment already
 * argues for, reused rather than reinvented:
 *
 *  - **Both readers, one report.** A save the host refuses goes to the
 *    paragraph next to the button AND to `ctx.connection.report()` — the
 *    one list that outlives this screen. Slice 5's own finding, repeated
 *    here rather than repeating its mistake: a diagnostic that lives only
 *    in this component's state is gone the moment someone switches tabs.
 *  - **Confirm before discarding.** The one irreversible thing here is
 *    losing unsaved edits, and it can happen two ways — opening a
 *    different file, or navigating to a different TAB — so both go
 *    through the same inline yes/no (`confirm-yes`/`confirm-no`), the
 *    shape the assets screen already uses for delete.
 *
 * **Cross-tab leaving asks first too, via `ctx.layout.guard`.** `go()`
 * unmounts whatever screen was current unconditionally — there was no
 * interception point for that until this task added one: `layout.guard()`
 * lets the CURRENT screen refuse a navigation before the hash moves, so
 * this screen is still mounted (nothing moved) when it shows the same
 * confirm switching files already uses. "Yes" disposes the guard itself
 * registered, then calls `ctx.layout.go()` a second time so the retry is
 * not blocked by the very thing it is trying to get past.
 *
 * **The stale-check race is this screen's problem, not the service's**
 * (Ruling 9 of this slice's ledger): `ctx.check` is a bare `fetch` with no
 * sequence slot, so two in-flight calls can resolve in either order. A
 * monotonic counter (`checkSeq`) is bumped on every call this screen makes
 * — to `ctx.check.check` on a keystroke, and to invalidate a stale
 * in-flight call when the open file changes — and a response is only ever
 * applied if it is still the most recent call issued. An answer for text
 * nobody is looking at anymore is simply dropped, whichever order the
 * network hands the two back. Debouncing the call itself (below) cuts the
 * volume — one `POST /api/check` per pause in typing rather than one per
 * keystroke, measured live at a dozen calls for a single inserted line —
 * but does not replace the guard: a debounce still fires two overlapping
 * requests across a longer pause, and the network can still hand them
 * back in either order.
 */

/**
 * How long a pause in typing has to last before a check is actually sent —
 * cuts the request volume without changing what gets checked.
 *
 * ponytail: 300 is a guess at the usual editor-lint magnitude, not a
 * measurement; it was also picked to sit inside the test harness's 1000ms
 * `waitFor` default. Measure perceived latency before moving it.
 */
const CHECK_DEBOUNCE_MS = 300;

/** `game/script.spin` and anything under `plugins/` — the two things the spec says are edited by hand. */
function isEditable(entry: FileEntry): boolean {
  return (
    entry.kind === 'file' &&
    (entry.path === 'game/script.spin' || entry.path.startsWith('plugins/'))
  );
}

/** What a confirm row is currently asking about — the same question either way: throw away the current edit, or not. */
type Pending = { kind: 'file'; path: string } | { kind: 'nav'; targetId: string };

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
  const [pending, setPending] = useState<Pending | null>(null);
  const checkSeq = useRef(0);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The disposer for this screen's OWN `ctx.layout.guard()` registration —
  // held so the "yes" of the cross-tab confirm can retract it before
  // retrying `go()`, rather than the retry being blocked by the very guard
  // that caused the confirm in the first place.
  const navGuardOff = useRef<(() => void) | null>(null);

  const dirty = text !== savedText;

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

  // Registered only while there is something a navigation would discard,
  // dropped the moment that stops being true — on save, on switching to a
  // clean file, or on unmount (the effect's own cleanup, which is also
  // what an ordinary "this screen went away" relies on).
  useEffect(() => {
    if (!dirty) return undefined;
    const off = ctx.layout.guard((targetId) => {
      setPending({ kind: 'nav', targetId });
      return false;
    });
    navGuardOff.current = off;
    return () => {
      off();
      if (navGuardOff.current === off) navGuardOff.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, dirty]);

  useEffect(
    () => () => {
      if (checkTimer.current !== null) clearTimeout(checkTimer.current);
    },
    [],
  );

  const editable = (entries ?? []).filter(isEditable);

  /** Issues a check for `source`, applying the answer only if nothing newer has been asked since. */
  function runCheck(source: string) {
    const seq = ++checkSeq.current;
    ctx.check.check(source).then(({ diagnostics }) => {
      if (seq === checkSeq.current) setCheckDiagnostics(diagnostics);
    });
  }

  /** Coalesces a burst of keystrokes into one check, sent once typing pauses. */
  function scheduleCheck(source: string) {
    if (checkTimer.current !== null) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(() => {
      checkTimer.current = null;
      runCheck(source);
    }, CHECK_DEBOUNCE_MS);
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
      if (looksBinary(bytes)) {
        // Decoding it as text would fill the pane with replacement-character
        // mush and offer a "save" button that would write that mush back —
        // the assets screen's own reason for refusing, borrowed whole.
        setOpenError(
          `"${path}" doesn't look like text (it contains a NUL byte) — not something this screen can edit.`,
        );
        return;
      }
      const source = new TextDecoder().decode(bytes);
      // Bumped before any state changes: any check still in flight for the
      // file being left behind must never be allowed to land on this one,
      // however long it takes to answer.
      checkSeq.current += 1;
      if (checkTimer.current !== null) {
        clearTimeout(checkTimer.current);
        checkTimer.current = null;
      }
      setSelected(path);
      setText(source);
      setSavedText(source);
      setCheckDiagnostics([]);
      setSaveDiagnostics([]);
    });
  }

  function select(path: string) {
    if (selected !== null && selected !== path && dirty) {
      setPending({ kind: 'file', path });
      return;
    }
    openFile(path);
  }

  function confirmYes() {
    if (pending === null) return;
    const asked = pending;
    setPending(null);
    if (asked.kind === 'file') {
      openFile(asked.path);
      return;
    }
    // Retract this screen's own guard before retrying — otherwise the
    // retry would ask the exact same question a second time.
    navGuardOff.current?.();
    navGuardOff.current = null;
    ctx.layout.go(asked.targetId);
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
          {pending !== null && (
            <p className="e8-code-confirm">
              discard unsaved changes{pending.kind === 'file' ? ` to "${selected}"` : ''}?{' '}
              <button type="button" data-testid="confirm-yes" onClick={confirmYes}>
                yes
              </button>{' '}
              <button type="button" data-testid="confirm-no" onClick={() => setPending(null)}>
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
                  scheduleCheck(next);
                }}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
