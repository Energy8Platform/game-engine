import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { Monaco } from '../src/editor/Monaco';

/**
 * Real Monaco does not start under jsdom — its import throws at
 * module-evaluation time (`document.queryCommandSupported is not a
 * function`, from `base/browser/canIUse.js`), before any editor exists.
 * `monaco-jsdom.test.tsx` proves the wrapper survives exactly that. Every
 * other claim about the wrapper therefore has to be observed through a
 * stand-in: this fake stands in for `src/editor/monacoSlice.ts` — the wrapper's
 * own assembly of the editor, the one module it loads — and records what
 * the wrapper asked of it (`create`, `setModelMarkers`, `dispose`) while
 * mimicking the one observable Monaco behaviour the first test reads back
 * (the value shows up inside the host element). It is not a claim that
 * Monaco renders — the real browser check in the task report is; it is a
 * claim about what the wrapper HANDS Monaco.
 *
 * `vi.mock` is hoisted and file-wide, which is why the real-import test
 * lives in its own file rather than at the bottom of this one.
 */
const fake = vi.hoisted(() => {
  type Marker = { startLineNumber: number; message: string };
  type Editor = {
    el: HTMLElement;
    options: Record<string, unknown>;
    model: { value: string; markers: Marker[]; getValue(): string };
    disposed: boolean;
    listeners: Array<() => void>;
    getValue(): string;
    setValue(v: string): void;
    getModel(): Editor['model'];
    onDidChangeModelContent(cb: () => void): { dispose(): void };
    dispose(): void;
    /** What a keystroke does: the content moves underneath and listeners hear about it, with no `setValue` involved. */
    type(v: string): void;
  };
  const editors: Editor[] = [];
  /** A fresh `editor` API per test: the wrapper remembers which themes it defined per API object, so a new object starts it empty. */
  const makeEditorApi = () => {
    const api = {
      themes: [] as Array<{ name: string; data: Record<string, unknown> }>,
      applied: [] as string[],
      defineTheme(name: string, data: Record<string, unknown>) {
        api.themes.push({ name, data });
      },
      setTheme(name: string) {
        api.applied.push(name);
      },
      create(el: HTMLElement, options: Record<string, unknown>): Editor {
        const model = {
          value: String(options.value ?? ''),
          markers: [] as Marker[],
          getValue: () => model.value,
        };
        const editor: Editor = {
          el,
          options,
          model,
          disposed: false,
          listeners: [],
          getValue: () => model.value,
          // Real Monaco's `setValue` also fires `onDidChangeModelContent`.
          setValue: (v) => editor.type(v),
          getModel: () => model,
          onDidChangeModelContent(cb) {
            editor.listeners.push(cb);
            return { dispose() {} };
          },
          dispose() {
            editor.disposed = true;
          },
          type(v) {
            model.value = v;
            el.textContent = v;
            editor.listeners.forEach((cb) => cb());
          },
        };
        el.textContent = model.value;
        editors.push(editor);
        return editor;
      },
      setModelMarkers(model: Editor['model'], _owner: string, markers: Marker[]) {
        model.markers = markers;
      },
    };
    return api;
  };
  /** The `monaco.languages` surface the wrapper drives; fresh per test, same as `editor`. */
  const makeLanguagesApi = () => {
    const api = {
      registered: [] as Array<{ id: string; extensions?: string[] }>,
      providers: {} as Record<string, unknown>,
      configurations: {} as Record<string, unknown>,
      /** Ids whose `setMonarchTokensProvider` throws — the compile-failure seam. */
      broken: new Set<string>(),
      register(def: { id: string; extensions?: string[] }) {
        api.registered.push(def);
      },
      setMonarchTokensProvider(id: string, grammar: unknown) {
        if (api.broken.has(id)) throw new Error(`cannot compile ${id}`);
        api.providers[id] = grammar;
      },
      setLanguageConfiguration(id: string, conf: unknown) {
        api.configurations[id] = conf;
      },
    };
    return api;
  };
  return {
    editors,
    makeEditorApi,
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: makeEditorApi(),
    makeLanguagesApi,
    languages: makeLanguagesApi(),
  };
});

vi.mock('../src/editor/monacoSlice', () => fake);
vi.mock('monaco-editor/editor/editor.worker.js?worker', () => ({ default: class {} }));

function d(message: string, at?: Diagnostic['at']): Diagnostic {
  const base = diagnostic('error', 'schema', 'line 2', message);
  return at ? { ...base, at } : base;
}

/** The editor the wrapper created for this host element — the seam every marker/teardown test observes through. */
function editorOn(el: HTMLElement) {
  const editor = fake.editors.find((e) => e.el === el && !e.disposed);
  if (!editor) throw new Error('no live editor on that element');
  return editor;
}

async function mount(props: Partial<React.ComponentProps<typeof Monaco>> = {}) {
  const result = render(
    <Monaco value="a\nb\nc" language="spin" diagnostics={[]} onChange={() => {}} {...props} />,
  );
  // Scoped to this render's own container, not the global `screen`: two
  // `mount()` calls in one test (two editors on one page, sharing a
  // `languages` source) each get their own div in `document.body`, and a
  // page-wide query would find both and call it ambiguous.
  await within(result.container).findByTestId('editor');
  await act(async () => {});
  return result;
}

describe('Monaco', () => {
  beforeEach(() => {
    fake.editors.length = 0;
    fake.editor = fake.makeEditorApi();
    fake.languages = fake.makeLanguagesApi();
  });

  it('shows the text it was given', async () => {
    await mount({ value: 'game = Spin' });
    expect(await screen.findByTestId('editor')).toHaveTextContent('game = Spin');
  });

  it('a diagnostic with `at` becomes a marker on that line', async () => {
    await mount({ diagnostics: [d('bad', { line: 2 })] });
    expect(editorOn(screen.getByTestId('editor')).model.markers).toEqual([
      expect.objectContaining({ startLineNumber: 2, message: 'bad' }),
    ]);
  });

  it('a diagnostic without `at` is not drawn as a marker', async () => {
    // A marker at line 1 for a whole-file problem accuses innocent code.
    await mount({ diagnostics: [d('whole file is wrong'), d('bad', { line: 2 })] });
    expect(editorOn(screen.getByTestId('editor')).model.markers).toEqual([
      expect.objectContaining({ startLineNumber: 2, message: 'bad' }),
    ]);
  });

  it('replaces its markers when the diagnostics change, rather than adding', async () => {
    // Otherwise every keystroke leaves its errors behind and the gutter fills
    // with problems that are already fixed.
    const { rerender } = await mount({ diagnostics: [d('old', { line: 1 })] });
    rerender(
      <Monaco
        value="a\nb\nc"
        language="spin"
        diagnostics={[d('new', { line: 3 })]}
        onChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(editorOn(screen.getByTestId('editor')).model.markers).toEqual([
      expect.objectContaining({ startLineNumber: 3, message: 'new' }),
    ]);
  });

  it('reports what was typed through onChange', async () => {
    const seen: string[] = [];
    await mount({ onChange: (next) => seen.push(next) });
    editorOn(screen.getByTestId('editor')).type('typed');
    expect(seen).toEqual(['typed']);
  });

  it('follows a new value from outside without touching one it already shows', async () => {
    // A file reloaded from disk must reach the editor; a keystroke echoed
    // back through props must not — `setValue` would reset the cursor and
    // the undo stack on every one. The echo is the case that matters: the
    // prop CHANGES (so the sync effect runs) to text the editor already
    // holds. A rerender with an unchanged prop never runs the effect at all
    // and would pass with the guard deleted.
    const { rerender } = await mount({ value: 'one' });
    const editor = editorOn(screen.getByTestId('editor'));
    const setValue = vi.spyOn(editor, 'setValue');
    editor.type('one two');
    rerender(<Monaco value="one two" language="spin" diagnostics={[]} onChange={() => {}} />);
    await act(async () => {});
    expect(setValue).not.toHaveBeenCalled();
    rerender(<Monaco value="from disk" language="spin" diagnostics={[]} onChange={() => {}} />);
    await act(async () => {});
    expect(setValue).toHaveBeenCalledWith('from disk');
  });

  it('tears its editor down when unmounted', async () => {
    // Monaco holds workers and DOM. A screen you can navigate away from and
    // back to must not leak one editor per visit.
    const { unmount } = await mount();
    const editor = editorOn(screen.getByTestId('editor'));
    unmount();
    expect(editor.disposed).toBe(true);
  });

  it('defines the dark theme on the card colour the stylesheet names, once, and uses it', async () => {
    document.documentElement.style.setProperty('--e8-editor-bg', '#1f1f1f');
    delete document.documentElement.dataset.theme;
    // Two editors, one definition: the theme is per Monaco, not per editor.
    // Mounted one after the other — see `editor-document.test.tsx` for why
    // two concurrent `import()`s of the mocked slice leave the second hanging.
    const { rerender } = render(
      <Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />,
    );
    await waitFor(() => expect(fake.editors.length).toBe(1));
    rerender(
      <>
        <Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />
        <Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />
      </>,
    );
    await waitFor(() => expect(fake.editors.length).toBe(2));
    expect(fake.editor.themes).toEqual([
      {
        name: 'e8-dark',
        data: {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: { 'editor.background': '#1f1f1f' },
        },
      },
    ]);
    expect(fake.editors.map((e) => e.options.theme)).toEqual(['e8-dark', 'e8-dark']);
  });

  it('defines the light theme when data-theme flips, on the colour the token has THEN', async () => {
    document.documentElement.style.setProperty('--e8-editor-bg', '#1f1f1f');
    delete document.documentElement.dataset.theme;
    render(<Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />);
    await waitFor(() => expect(fake.editors.length).toBe(1));
    document.documentElement.style.setProperty('--e8-editor-bg', '#ffffff');
    document.documentElement.dataset.theme = 'light';
    await waitFor(() =>
      expect(fake.editor.themes.map((t) => t.name)).toEqual(['e8-dark', 'e8-light']),
    );
    expect(fake.editor.themes[1].data).toMatchObject({
      base: 'vs',
      colors: { 'editor.background': '#ffffff' },
    });
    expect(fake.editor.applied).toEqual(['e8-light']);
  });

  it('registers a theme without colours when the token is not on :root', async () => {
    document.documentElement.style.removeProperty('--e8-editor-bg');
    delete document.documentElement.dataset.theme;
    render(<Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />);
    await waitFor(() => expect(fake.editors.length).toBe(1));
    expect(fake.editor.themes[0].data).toMatchObject({ base: 'vs-dark', colors: {} });
  });

  /** A stand-in for `ctx.languages`: the three members the wrapper reads. */
  function source(defs: Array<{ id: string; extensions: string[]; load: () => Promise<any> }>) {
    const listeners = new Set<() => void>();
    const failures: [string, string][] = [];
    return {
      defs,
      failures,
      list: () => defs,
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      failed(id: string, message: string) {
        failures.push([id, message]);
      },
      add(def: { id: string; extensions: string[]; load: () => Promise<any> }) {
        defs.push(def);
        listeners.forEach((fn) => fn());
      },
    };
  }

  const spinGrammar = { tokenizer: { root: [] } };
  const spinConf = { comments: { lineComment: '--' } };

  it('registers every language id before creating the editor', async () => {
    const src = source([
      {
        id: 'spin',
        extensions: ['.spin'],
        load: async () => ({ language: spinGrammar, conf: spinConf }),
      },
      {
        id: 'yaml',
        extensions: ['.yml'],
        load: async () => ({ language: { tokenizer: { root: [] } } }),
      },
    ]);
    await mount({ languages: src });
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['spin', 'yaml']);
    expect(fake.languages.registered[0].extensions).toEqual(['.spin']);
    // `registered` is filled inside `load().then(...)` before `create` — the fake records creation order through `editors`.
    expect(fake.editors).toHaveLength(1);
  });

  it('hands each grammar and configuration to Monaco once loaded', async () => {
    const src = source([
      {
        id: 'spin',
        extensions: ['.spin'],
        load: async () => ({ language: spinGrammar, conf: spinConf }),
      },
      {
        id: 'yaml',
        extensions: ['.yml'],
        load: async () => ({ language: { tokenizer: { root: [] } } }),
      },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(fake.languages.configurations.spin).toBe(spinConf);
    expect(fake.languages.providers.yaml).toBeDefined();
    expect(fake.languages.configurations.yaml).toBeUndefined();
    expect(src.failures).toEqual([]);
  });

  it('a language registered after the editor exists is applied too', async () => {
    const src = source([]);
    await mount({ languages: src });
    src.add({ id: 'late', extensions: ['.late'], load: async () => ({ language: spinGrammar }) });
    await waitFor(() => expect(fake.languages.providers.late).toBe(spinGrammar));
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['late']);
  });

  it('a grammar that fails to load is reported through failed(); the others still apply', async () => {
    const src = source([
      {
        id: 'bad',
        extensions: ['.bad'],
        load: async () => {
          throw new Error('no such module');
        },
      },
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(src.failures).toEqual([['bad', 'no such module']]));
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['bad', 'spin']);
  });

  it('a grammar Monaco cannot compile is reported the same way', async () => {
    fake.languages.broken.add('spin');
    const src = source([
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(src.failures).toEqual([['spin', 'cannot compile spin']]));
  });

  it('the same definition is not applied twice across two editors on one page', async () => {
    const def = {
      id: 'spin',
      extensions: ['.spin'],
      load: vi.fn(async () => ({ language: spinGrammar })),
    };
    const src = source([def]);
    await mount({ languages: src });
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(def.load).toHaveBeenCalledTimes(1);
    expect(fake.languages.registered).toHaveLength(1);
  });

  it('a replaced definition (same id, new object) is loaded again', async () => {
    const src = source([
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    const next = { tokenizer: { root: [[/x/, 'x']] } };
    src.defs.length = 0;
    src.add({ id: 'spin', extensions: ['.spin'], load: async () => ({ language: next }) });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(next));
  });

  it('works without a languages source, as before', async () => {
    await mount();
    expect(fake.languages.registered).toEqual([]);
  });
});
