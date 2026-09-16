import { useEffect, useRef, useState } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { FILE_KEY_PREFIX } from '../plugins/shell';
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
 * **Both readers, one report — and the report is taken back.** A save the
 * host refuses and a check's answer both go to the paragraph beside the
 * button (or a marker, when the diagnostic has `at`) AND to
 * `ctx.connection.report()`, the one list that outlives this tab — the
 * same rule the Explorer applies to upload and delete (spec §8). A check
 * answers for text that changes on every keystroke, so this keeps the
 * retracts `report()` hands back (`checkRetracts`, `saveRetracts`) and
 * runs them when the answer is outgrown: a new check answer retracts the
 * previous check's rows before reporting its own (an answer of `[]`
 * leaves nothing); a refused save retracts the previous refusal; a save
 * that succeeds retracts the refusal; a read that fails holds its rows
 * the same way (in `checkRetracts` — an editor that never opened never
 * checks); and unmount runs every retract it still holds — a closed
 * editor's rows go with it, since nothing is left to take them back
 * later — and an answer that lands after it reports nothing (`gone`).
 * Until debt B1 gave `report()` a retract, checks
 * stayed out of the list on purpose; that deviation is retired. The
 * paragraph beside the editor is not optional: a stage no variant
 * declares, a deleted `game {}` block and `check.ts`'s own dead-network
 * diagnostic all come with no line, and "markers only" left the pane
 * empty with the host having said exactly what was wrong.
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

/**
 * What `ctx.check` knows how to read; everything else is edited, never
 * checked. The DOCUMENT's language — what Monaco highlights it as — comes
 * from `ctx.languages.languageFor(path)` instead; this predicate only
 * gates `ctx.check`.
 */
function isSpin(path: string): boolean {
  return path.endsWith('.spin');
}

export function EditorDocument({ ctx, path }: { ctx: Context; path: string }): JSX.Element {
  const key = `${FILE_KEY_PREFIX}${path}`;
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
  // The retracts for the rows this editor currently holds in the one
  // list — see the module doc for when each set is run.
  const checkRetracts = useRef<Array<() => void>>([]);
  const saveRetracts = useRef<Array<() => void>>([]);
  // Set by the unmount cleanup: an answer (the read, a save) that resolves
  // after it reports nothing — there is no editor left to take it back.
  const gone = useRef(false);

  const dirty = text !== null && text !== savedText;

  /** Runs and forgets every retract in `held`, then reports `diagnostics` and holds their retracts instead. */
  function replaceReported(held: { current: Array<() => void> }, diagnostics: Diagnostic[]) {
    for (const retract of held.current) retract();
    held.current = diagnostics.map((diag) => ctx.connection.report(diag));
  }

  /** Issues a check for `source`, applying the answer only if nothing newer has been asked since. */
  function runCheck(source: string) {
    const seq = ++checkSeq.current;
    ctx.check.check(source).then(({ diagnostics }) => {
      if (seq !== checkSeq.current) return;
      setCheckDiagnostics(diagnostics);
      replaceReported(checkRetracts, diagnostics);
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
    gone.current = false;
    ctx.files.read(path).then(({ bytes, diagnostics }) => {
      if (gone.current) return;
      if (!bytes) {
        // The tree is a snapshot; the file can be gone by the time this
        // resolves. The host's own diagnostic says why — held with the
        // check rows (a file that did not open is never checked, so the
        // set is free), and gone with the editor like them.
        setOpenError(diagnostics[0]?.message ?? `"${path}" could not be read`);
        replaceReported(checkRetracts, diagnostics);
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
      gone.current = true;
      // Nothing asked for this file may land after it: a timer still
      // pending is dropped, and any answer in flight fails the `seq` test.
      checkSeq.current += 1;
      if (checkTimer.current !== null) clearTimeout(checkTimer.current);
      // A closed editor's rows go with it: nothing is left to take them
      // back later, and a check answers only for text someone can see.
      replaceReported(checkRetracts, []);
      replaceReported(saveRetracts, []);
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
      if (gone.current) return;
      setSaveDiagnostics(diagnostics);
      // A refusal replaces the previous refusal's rows; a success (an
      // empty answer) retracts them and reports nothing.
      replaceReported(saveRetracts, diagnostics);
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
        language={ctx.languages.languageFor(path)}
        languages={ctx.languages}
        diagnostics={checkDiagnostics}
        onChange={(next) => {
          setText(next);
          if (isSpin(path)) scheduleCheck(next);
        }}
      />
    </div>
  );
}
