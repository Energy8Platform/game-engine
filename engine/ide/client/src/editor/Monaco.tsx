/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import type * as MonacoApi from './monacoSlice';
import type { Diagnostic } from '@energy8engine/contracts';
// Monaco runs its heavier text work in a web worker, and asks the page
// for one through `MonacoEnvironment.getWorker`. This `?worker` import is
// vite's way of bundling that worker as its own chunk — the reference to
// `vite/client` above types it. Vitest accepts the same import and never
// instantiates it, so this file loads under jsdom; what does NOT load
// there is Monaco itself, see `load()` below. The path has no `esm/vs/`
// segment on purpose — see `./monacoSlice.ts` for the exports-map reason.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

export interface MonacoProps {
  value: string;
  language: string;
  /** Markers, placed by `Diagnostic.at`. A diagnostic without `at` is not drawn. */
  diagnostics: readonly Diagnostic[];
  onChange(next: string): void;
}

type Api = typeof MonacoApi;
type Editor = MonacoApi.editor.IStandaloneCodeEditor;

/**
 * Loaded lazily, not imported at the top: Monaco throws while it evaluates
 * anywhere without a real browser (jsdom: `document.queryCommandSupported
 * is not a function`), and a static import here would carry that throw
 * into everything that imports the `ide-client` barrel — every test in
 * this package, and `App` — the same way one unconditional `node:fs`
 * import once took the whole IDE down at boot. Behind a dynamic import
 * the failure stays inside this component, which turns it into words on
 * screen instead. `./monacoSlice` is this IDE's own narrow assembly of the
 * editor, not the package's everything-included entry; its doc says why.
 */
const load = (): Promise<Api> => import('./monacoSlice');

const SEVERITY: Record<Diagnostic['severity'], keyof Api['MarkerSeverity']> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/** A code editor. It has no title of its own; the screen around it does. */
export function Monaco({ value, language, diagnostics, onChange }: MonacoProps) {
  const host = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<{ monaco: Api; editor: Editor } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // `onChange` is read through a ref so the content listener registered
  // once at creation sees the caller's CURRENT handler, without the editor
  // being torn down and rebuilt every time the parent re-renders.
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    let editor: Editor | undefined;
    let gone = false;
    load()
      .then((monaco) => {
        if (gone) return;
        self.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };
        editor = monaco.editor.create(host.current!, { value, language, automaticLayout: true });
        editor.onDidChangeModelContent(() => change.current(editor!.getValue()));
        setApi({ monaco, editor });
      })
      .catch((error: unknown) => {
        if (!gone) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      gone = true;
      editor?.dispose();
    };
    // `value`/`language` are creation-time only; later values are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only a value the editor does not already show — its own keystrokes
    // come back through this prop, and `setValue` on those would reset the
    // cursor and the undo stack on every one of them.
    if (api && api.editor.getValue() !== value) api.editor.setValue(value);
  }, [api, value]);

  useEffect(() => {
    if (!api) return;
    const model = api.editor.getModel();
    if (!model) return;
    // `setModelMarkers` REPLACES the owner's markers, which is the point:
    // markers from a diagnostics list that has since changed must not
    // linger. Only `at` places a marker — `where` is prose and is never
    // parsed back into a position (see `Diagnostic.at`). `endColumn:
    // Number.MAX_VALUE` with `startColumn: 1` is Monaco's own idiom for
    // "the whole line, from its first non-blank character".
    api.monaco.editor.setModelMarkers(
      model,
      'e8',
      diagnostics.flatMap((diag) =>
        diag.at
          ? [
              {
                severity: api.monaco.MarkerSeverity[SEVERITY[diag.severity]],
                message: diag.message,
                startLineNumber: diag.at.line,
                endLineNumber: diag.at.line,
                startColumn: diag.at.column ?? 1,
                endColumn: diag.at.column !== undefined ? diag.at.column + 1 : Number.MAX_VALUE,
              },
            ]
          : [],
      ),
    );
  }, [api, diagnostics]);

  if (failure !== null) {
    return (
      <p data-testid="editor" role="alert">
        the editor could not start here: {failure}
      </p>
    );
  }
  return <div ref={host} data-testid="editor" style={{ height: '100%', minHeight: 400 }} />;
}
