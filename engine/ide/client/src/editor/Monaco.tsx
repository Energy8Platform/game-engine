/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import type * as MonacoApi from './monacoSlice';
import type { Diagnostic } from '@energy8engine/contracts';
import type { LanguageDef, LanguagesService } from '../plugins/languages';
// Monaco runs its heavier text work in a web worker, and asks the page
// for one through `MonacoEnvironment.getWorker`. This `?worker` import is
// vite's way of bundling that worker as its own chunk — the reference to
// `vite/client` above types it. Vitest accepts the same import and never
// instantiates it, so this file loads under jsdom; what does NOT load
// there is Monaco itself, see `load()` below. The path has no `esm/vs/`
// segment on purpose — see `./monacoSlice.ts` for the exports-map reason.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

/** What the wrapper reads from `ctx.languages` — a source of definitions, and somewhere to report a grammar that failed. */
export type LanguageSource = Pick<LanguagesService, 'list' | 'subscribe' | 'failed'>;

export interface MonacoProps {
  value: string;
  language: string;
  /** Markers, placed by `Diagnostic.at`. A diagnostic without `at` is not drawn. */
  diagnostics: readonly Diagnostic[];
  /** Where languages come from; without it the editor knows only Monaco's own `plaintext`. */
  languages?: LanguageSource;
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

type ThemeName = 'e8-dark' | 'e8-light';

/** The shell's `data-theme` (see `StatusItems.tsx`'s `applyTheme`) picks the theme name. */
function themeFor(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'e8-light' : 'e8-dark';
}

/** Which themes each Monaco instance has been told about — once per name, per API object, so tests with a fresh fake start empty. */
const defined = new WeakMap<Api['editor'], Set<ThemeName>>();

/**
 * Which definition each language id was last applied FROM, per Monaco API
 * object — `monaco.languages` is global to the page, so two editors must
 * not register (or load) the same definition twice, while a REPLACED
 * definition (same id, new object) must be loaded again. Keyed by the API
 * object for the same reason `defined` is: a test with a fresh fake starts
 * empty. Monaco cannot unregister a language, so a retracted definition
 * simply stops being re-applied; its id stays known to Monaco.
 */
const applied = new WeakMap<Api['languages'], Map<string, LanguageDef>>();

/**
 * Registers every id Monaco has not seen (synchronously — a model created
 * for an unknown id is plaintext for good), then loads each grammar and
 * hands it over; a grammar that cannot be loaded or compiled goes to
 * `source.failed`, and the other languages are unaffected.
 */
function applyLanguages(monaco: Api, source: LanguageSource): void {
  let seen = applied.get(monaco.languages);
  if (!seen) applied.set(monaco.languages, (seen = new Map()));
  for (const def of source.list()) {
    if (seen.get(def.id) === def) continue;
    seen.set(def.id, def);
    monaco.languages.register({ id: def.id, extensions: def.extensions });
    def
      .load()
      .then(({ language, conf }) => {
        // Replaced while loading: the newer definition's own load applies.
        if (seen!.get(def.id) !== def) return;
        monaco.languages.setMonarchTokensProvider(def.id, language);
        if (conf) monaco.languages.setLanguageConfiguration(def.id, conf);
      })
      .catch((error: unknown) => {
        source.failed(def.id, error instanceof Error ? error.message : String(error));
      });
  }
}

/**
 * Monaco's built-in `vs-dark` paints `#1e1e1e`; the editor card is
 * `--e8-editor-bg` (`#1f1f1f`), and the 1px seam between them was visible.
 * Each theme is defined on first use, reading the token AT THAT MOMENT —
 * `data-theme` has already flipped when the observer fires, so the value
 * read is the light one for `e8-light`. A missing token (a test with no
 * stylesheet) defines the theme with no colours: Monaco's own default,
 * the seam, and no throw.
 */
function ensureTheme(monaco: Api, name: ThemeName): ThemeName {
  let set = defined.get(monaco.editor);
  if (!set) defined.set(monaco.editor, (set = new Set()));
  if (!set.has(name)) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--e8-editor-bg').trim();
    monaco.editor.defineTheme(name, {
      base: name === 'e8-light' ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [],
      colors: bg ? { 'editor.background': bg } : {},
    });
    set.add(name);
  }
  return name;
}

/** A code editor. It has no title of its own; the screen around it does. */
export function Monaco({ value, language, diagnostics, languages, onChange }: MonacoProps) {
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
    let observer: MutationObserver | undefined;
    let unsubscribe: (() => void) | undefined;
    let gone = false;
    load()
      .then((monaco) => {
        if (gone) return;
        self.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };
        if (languages) {
          applyLanguages(monaco, languages);
          unsubscribe = languages.subscribe(() => applyLanguages(monaco, languages));
        }
        editor = monaco.editor.create(host.current!, {
          value,
          language,
          automaticLayout: true,
          theme: ensureTheme(monaco, themeFor()),
        });
        editor.onDidChangeModelContent(() => change.current(editor!.getValue()));
        // The theme toggle flips `data-theme` on `<html>`; the editor was
        // white inside a dark shell until it followed. `setTheme` is
        // global to every Monaco on the page, which is what a theme is.
        observer = new MutationObserver(() =>
          monaco.editor.setTheme(ensureTheme(monaco, themeFor())),
        );
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        });
        setApi({ monaco, editor });
      })
      .catch((error: unknown) => {
        if (!gone) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      gone = true;
      observer?.disconnect();
      unsubscribe?.();
      editor?.dispose();
    };
    // `value`/`language`/`languages` are creation-time only; later values are synced below,
    // and the source object is stable for the life of a document.
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
  // Sized by the stylesheet (`.e8-monaco` fills the editor document's
  // pane); `automaticLayout` above is what makes Monaco follow that box.
  return <div ref={host} data-testid="editor" className="e8-monaco" />;
}
