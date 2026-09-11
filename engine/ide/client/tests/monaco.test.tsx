import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  return {
    editors,
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
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
    },
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
  await screen.findByTestId('editor');
  await act(async () => {});
  return result;
}

describe('Monaco', () => {
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
});
