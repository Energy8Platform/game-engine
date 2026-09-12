import { useEffect, useRef, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { Monaco } from '../editor/Monaco';
import { looksBinary } from './ViewerDocument';

/**
 * One file in Monaco, as a shell document: what `CodeScreen` did once a
 * file was picked, with the picking gone to the Explorer and the tab
 * strip. `ctx.files` reads and writes the bytes, `ctx.check` says what is
 * wrong with text that was never saved, `<Monaco/>` turns `Diagnostic.at`
 * into a marker. This component is only the wiring between them.
 *
 * **Dirty is the shell's fact, told and never retracted here.** The one
 * irreversible thing an editor can do is lose typed math, and the shell
 * owns every door that leads there — the tab's close, reload through
 * `hasDirtyDocuments()`. So this calls `ctx.shell.markDirty(key, bool)` as
 * `text !== savedText` changes, and nothing else about closing: no guard
 * of its own, no confirm of its own, and — the part that matters for
 * order — no `markDirty(false)` on unmount. The shell asks its question
 * BEFORE it closes the tab; an unmount that cleared dirty would answer it
 * on the person's behalf.
 *
 * **Both readers, one report.** A save the host refuses goes to the
 * paragraph next to the button AND to `ctx.connection.report()`, the one
 * list that outlives this tab — the same rule the Explorer applies to
 * upload and delete.
 *
 * **Check diagnostics are NOT sent to the one list.** `connection.report()`
 * has no retract: a check answers for text that changes on every
 * keystroke, and a list that cannot forget would fill with "record block
 * has no name" for a record named two keystrokes later. A check's answer
 * lives only as long as the text it answered — as a marker when it has
 * `at`, as a paragraph beside the editor when it does not. The paragraph
 * is not optional: a stage no variant declares, a deleted `game {}`
 * block and `check.ts`'s own dead-network diagnostic all come with no
 * line, and "markers only" left the pane empty with the host having said
 * exactly what was wrong.
 *
 * **Only `.spin` is checked.** `ctx.check` runs the `.spin` grammar; over
 * TypeScript it finds `\bgame\b` in a variable name and draws "game block
 * has no quoted name" on code that is not `.spin`. Anything else is
 * edited, never checked — on open or on a keystroke.
 *
 * **The stale-check race is this component's problem, not the service's.**
 * `ctx.check` is a bare `fetch` with no sequence slot, so two in-flight
 * calls can resolve in either order. `checkSeq` is bumped on every call
 * made here, and an answer is applied only if it is still the most
 * recent one asked; an answer for text nobody is looking at anymore is
 * dropped. The debounce below cuts the volume — one POST per pause in
 * typing rather than one per keystroke — but does not replace the guard:
 * two requests can still overlap across a longer pause.
 */

/**
 * How long a pause in typing has to last before a check is actually sent.
 *
 * ponytail: 300 is a guess at the usual editor-lint magnitude, not a
 * measurement; it also sits inside the test harness's 1000ms `waitFor`
 * default. Measure perceived latency before moving it.
 */
const CHECK_DEBOUNCE_MS = 300;

/** What `ctx.check` knows how to read; everything else is edited, never checked. */
function isSpin(path: string): boolean {
  return path.endsWith('.spin');
}

export function EditorDocument({ ctx, path }: { ctx: Context; path: string }): JSX.Element {
  const key = `f:${path}`;
  // `null` until the read answers — the pane says "reading" rather than
  // showing an empty editor over a file it has not seen yet.
  const [text, setText] = useState<string | null>(null);
  // The last text this document knows the host actually holds — from the
  // read that opened the file, or the write that last saved it. `text !==
  // savedText` is the one fact "unsaved changes" reduces to.
  const [savedText, setSavedText] = useState('');
  const [checkDiagnostics, setCheckDiagnostics] = useState<Diagnostic[]>([]);
  const [saveDiagnostics, setSaveDiagnostics] = useState<Diagnostic[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const checkSeq = useRef(0);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = text !== null && text !== savedText;

  function report(diagnostics: Diagnostic[]) {
    for (const diag of diagnostics) ctx.connection.report(diag);
  }

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

  useEffect(() => {
    let gone = false;
    ctx.files.read(path).then(({ bytes, diagnostics }) => {
      if (gone) return;
      if (!bytes) {
        // The tree is a snapshot; the file can be gone by the time this
        // resolves. The host's own diagnostic says why.
        setOpenError(diagnostics[0]?.message ?? `"${path}" could not be read`);
        report(diagnostics);
        return;
      }
      if (looksBinary(bytes)) {
        // Decoding it as text would fill the pane with replacement-character
        // mush and offer a "save" button that would write that mush back.
        setOpenError(
          `"${path}" doesn't look like text (it contains a NUL byte) — not something this editor can edit.`,
        );
        return;
      }
      const source = new TextDecoder().decode(bytes);
      setText(source);
      setSavedText(source);
      // A file that is already broken says so on open, not after the
      // first keystroke.
      if (isSpin(path)) runCheck(source);
    });
    return () => {
      gone = true;
      // Nothing asked for this file may land after it: a timer still
      // pending is dropped, and any answer in flight fails the `seq` test.
      checkSeq.current += 1;
      if (checkTimer.current !== null) clearTimeout(checkTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, path]);

  // Told, never retracted on unmount — see the module doc for the order
  // this protects. `markDirty` on a key the shell does not hold (a test
  // rendering this outside any tab) is a no-op on the shell's side.
  useEffect(() => {
    ctx.shell.markDirty(key, dirty);
  }, [ctx, key, dirty]);

  function save() {
    if (text === null) return;
    const saving = text;
    ctx.files.write(path, new TextEncoder().encode(saving)).then(({ diagnostics }) => {
      setSaveDiagnostics(diagnostics);
      report(diagnostics);
      if (diagnostics.length === 0) setSavedText(saving);
    });
  }

  // Cmd/Ctrl+S from anywhere in the page. The shell keeps EVERY open
  // document mounted (Ruling 13), so every open editor hears this one
  // keystroke; only the one whose tab is active answers it, or one save
  // would write every dirty file at once. Read through a ref so the
  // listener registered once sees the current text rather than the text
  // at mount.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (ctx.shell.active()?.key !== key) return;
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx, key]);

  if (openError !== null) {
    return (
      <p className="e8-code-error" data-testid="open-error">
        {openError}
      </p>
    );
  }
  if (text === null) return <p className="e8-empty">reading {path}…</p>;

  return (
    <div className="e8-code-editor">
      <button type="button" className="e8-primary" onClick={save}>
        save
      </button>
      {saveDiagnostics.map((diag, i) => (
        <p className="e8-code-diagnostic" key={`save-${i}`}>
          {diag.message}
        </p>
      ))}
      {checkDiagnostics
        .filter((diag) => diag.at === undefined)
        .map((diag, i) => (
          <p className="e8-code-diagnostic" key={`check-${i}`}>
            {diag.message}
          </p>
        ))}
      <Monaco
        value={text}
        language={isSpin(path) ? 'spin' : 'plaintext'}
        diagnostics={checkDiagnostics}
        onChange={(next) => {
          setText(next);
          if (isSpin(path)) scheduleCheck(next);
        }}
      />
    </div>
  );
}
