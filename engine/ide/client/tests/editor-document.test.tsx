import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import {
  EditorDocument,
  createIdeClient,
  type CheckService,
  type FilesService,
} from '../src/index';

/**
 * One file, edited: what `CodeScreen` did once a file was picked, with the
 * picking itself gone to the Explorer and the tab strip. Step 1 below
 * copies every test from the old `code-screen.test.tsx` (deleted with
 * `CodeScreen` in Task 6) that pins a property of the editor; Step 2
 * is what only a document does: tell the shell it is dirty, and stay
 * dirty until the host has actually taken the bytes.
 *
 * `harness()`/`harnessWithCalls()` go through the real `createIdeClient`
 * with a fake `fetchFn`, the same precedent `explorer.test.tsx` set —
 * writes are observed through the PUT requests, checks through the POSTs
 * (`calls` on `ctx.check`, same name `code-screen.test.tsx` attached).
 *
 * Monaco does not import under jsdom (`monaco.test.tsx`'s own doc says
 * why) — this file mocks `../src/editor/monacoSlice` with the same
 * recording fake, so a test here sees an editor instead of the "could not
 * start" explanation pane.
 */
const fake = vi.hoisted(() => {
  type Marker = { startLineNumber: number; message: string };
  type Editor = {
    el: HTMLElement;
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
          model,
          disposed: false,
          listeners: [],
          getValue: () => model.value,
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
      // The wrapper defines its own themes on creation; this file does not test them.
      defineTheme(_name: string, _data: Record<string, unknown>) {},
      setTheme(_name: string) {},
    },
  };
});

vi.mock('../src/editor/monacoSlice', () => fake);
vi.mock('monaco-editor/editor/editor.worker.js?worker', () => ({ default: class {} }));

/** The (only ever one, in this suite) live editor for a given host element. */
function editorOn(el: HTMLElement) {
  const editor = fake.editors.find((e) => e.el === el && !e.disposed);
  if (!editor) throw new Error('no live editor on that element');
  return editor;
}

/** A keystroke, wrapped: the fake fires its listener synchronously, which triggers a React state update outside any event React itself dispatched. */
function type(el: HTMLElement, next: string) {
  act(() => editorOn(el).type(next));
}

/** These tests only care about `.message` — severity/plugin/where are fixed filler, `at` added where a test needs a marker. */
function d(message: string, at?: Diagnostic['at']): Diagnostic {
  const base = diagnostic('error', 'files', 'test', message);
  return at ? { ...base, at } : base;
}

/** The tab a document lives in — opened by the test, the way Explorer's `openPath` would, so `markDirty` has a row to land on. */
const Nop = () => null;
function openTab(ctx: Context, path: string) {
  ctx.shell.open({
    key: `f:${path}`,
    title: path.split('/').pop() ?? path,
    component: Nop,
    closable: true,
  });
}

function files(contents: Record<string, string>): {
  entries: FileEntry[];
  contents: Record<string, string>;
} {
  return {
    entries: Object.keys(contents).map((path) => ({ path, kind: 'file', size: 0 })),
    contents,
  };
}

function decodeBase64(value: string): number[] {
  const binary = atob(value);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

type TestFiles = FilesService & { written: [string, number[]][] };
type TestCheck = CheckService & { calls: string[] };

interface HostAnswers {
  writeDiagnostics?: Diagnostic[];
  checkDiagnostics?: Diagnostic[];
  /** For the out-of-order test: lets the test control exactly when each POST /api/check answers. */
  checkResponder?: (source: string) => Promise<Diagnostic[]>;
}

async function harnessWithCalls(
  project: { entries: FileEntry[]; contents: Record<string, string> },
  hostAnswers: HostAnswers = {},
): Promise<{ ctx: Context & { files: TestFiles; check: TestCheck }; calls: string[] }> {
  const { entries, contents } = project;
  const written: [string, number[]][] = [];
  const checks: string[] = [];
  const calls: string[] = [];

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : String((input as { toString(): string }).toString());
    calls.push(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/composition') {
      return new Response(JSON.stringify({ rows: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/files' && method === 'GET') {
      return new Response(JSON.stringify({ entries, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/check' && method === 'POST') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { source?: string };
      const source = body.source ?? '';
      checks.push(source);
      const diagnostics = hostAnswers.checkResponder
        ? await hostAnswers.checkResponder(source)
        : (hostAnswers.checkDiagnostics ?? []);
      return new Response(JSON.stringify({ diagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const path = decodeURIComponent(url.slice('/api/files/'.length));

    if (method === 'PUT') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { base64?: string };
      written.push([path, decodeBase64(body.base64 ?? '')]);
      return new Response(JSON.stringify({ diagnostics: hostAnswers.writeDiagnostics ?? [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (Object.prototype.hasOwnProperty.call(contents, path)) {
      return new Response(contents[path]);
    }
    return new Response(JSON.stringify({ diagnostics: [d(`"${path}" was not found: ENOENT`)] }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const socket = { readyState: 1, addEventListener() {}, send() {}, close() {} };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });

  const testFiles = ctx.files as TestFiles;
  testFiles.written = written;
  const testCheck = ctx.check as TestCheck;
  testCheck.calls = checks;

  return { ctx: ctx as Context & { files: TestFiles; check: TestCheck }, calls };
}

async function harness(
  project: { entries: FileEntry[]; contents: Record<string, string> },
  hostAnswers: HostAnswers = {},
): Promise<Context & { files: TestFiles; check: TestCheck }> {
  const { ctx } = await harnessWithCalls(project, hostAnswers);
  return ctx;
}

// `ctx.shell.open` writes `location.hash` — `shell.test.tsx`'s own harness
// hits the identical leak and resets it the same way.
beforeEach(() => {
  location.hash = '';
});

describe('EditorDocument — ported from CodeScreen', () => {
  it('opening a file shows its text', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'game = Spin' }));
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('game = Spin');
  });

  it('typing checks, and the markers arrive without saving', async () => {
    // Asserts the marker itself lands — polling `calls.length` alone was
    // green with `diagnostics={[]}` hardcoded on the `<Monaco/>` mount.
    const ctx = await harness(files({ 'game/script.spin': 'game = Spin' }), {
      checkDiagnostics: [d('record block has no name', { line: 2 })],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'game = Spin\nrecord {\n}');
    await waitFor(() => expect(ctx.check.calls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'record block has no name' }),
      ]),
    );
    expect(ctx.files.written).toEqual([]); // nothing saved
  });

  it('debounces rapid typing into one check call for the last text, not one per keystroke', async () => {
    const ctx = await harness(files({ 'game/script.spin': '' }));
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'a');
    type(editorEl, 'ab');
    type(editorEl, 'abc');
    // The first call is the one opening the file makes (see "a file that
    // is already broken" below); the keystrokes add exactly one more.
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'abc']));
    // Give the debounce window a second chance to fire, if the three
    // keystrokes had each scheduled their own call instead of collapsing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ctx.check.calls).toEqual(['', 'abc']);
  });

  it('saving writes through ctx.files.write, and says when the host refused', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'game = Spin' }), {
      writeDiagnostics: [d('that is outside the project')],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    await screen.findByTestId('editor');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/outside the project/)).toBeTruthy();
    expect(ctx.files.written.map(([path]) => path)).toEqual(['game/script.spin']);
  });

  it('a refusal reaches the one list, not only this document', async () => {
    // Both readers, one report: a diagnostic that lives only in this
    // component's state is gone the moment someone switches tabs.
    const ctx = await harness(files({ 'game/script.spin': 'x' }), {
      writeDiagnostics: [d('that is outside the project')],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    await screen.findByTestId('editor');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/outside the project/);
    expect(ctx.connection.diagnostics.map((x) => x.message)).toContain(
      'that is outside the project',
    );
  });

  it('an opened, untouched editor leaves its tab clean', async () => {
    // Was "a clean code screen does not block switching tabs": the shell
    // now decides what a clean tab may do; the document's half of that is
    // to not call the tab dirty for merely having been opened.
    const ctx = await harness(files({ 'game/script.spin': 'one' }));
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    await screen.findByTestId('editor');
    expect(ctx.shell.documents()[0].dirty).toBe(false);
    expect(ctx.shell.close('f:game/script.spin')).toBe(true);
  });

  it('a file that vanished between listing and opening says so', async () => {
    const ctx = await harness(files({})); // read — but it is already gone
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    expect(await screen.findByText(/was not found/)).toBeTruthy();
    expect(ctx.connection.diagnostics.some((diag) => /was not found/.test(diag.message))).toBe(
      true,
    );
    // No broken editor was mounted over it.
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('a binary file is refused instead of decoded as mush', async () => {
    // `plugins/**` can hold a PNG shipped inside a project plugin, and
    // decoding it as text (and offering "save" on the result) would write
    // that mush back.
    const ctx = await harness(files({ 'plugins/icon.png': '\x00\x01\x02binary stuff' }));
    render(<EditorDocument ctx={ctx} path="plugins/icon.png" />);
    expect(await screen.findByText(/doesn't look like text/)).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('a stale check answer never overwrites markers for text that is no longer current', async () => {
    // `ctx.check` has no sequence slot of its own, so the document owns
    // discarding a late answer. Typed 'a', then 'ab'; the answer FOR 'a'
    // is made to land LAST — without the guard the last answer to arrive
    // would win and the marker would say 'stale', not 'current'.
    let resolveForA: ((diagnostics: Diagnostic[]) => void) | undefined;
    let resolveForAb: ((diagnostics: Diagnostic[]) => void) | undefined;
    const ctx = await harness(files({ 'game/script.spin': '' }), {
      checkResponder: (source) =>
        new Promise((resolve) => {
          if (source === 'a') resolveForA = resolve;
          else if (source === 'ab') resolveForAb = resolve;
          else resolve([]); // the check opening the file makes
        }),
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');

    type(editorEl, 'a');
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'a']));
    type(editorEl, 'ab');
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'a', 'ab']));

    // Out of order: the newer text's answer arrives FIRST.
    await act(async () => {
      resolveForAb?.([d('current for ab', { line: 1 })]);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'current for ab' }),
      ]),
    );
    // The stale answer for 'a' arrives second — must be dropped, not applied.
    await act(async () => {
      resolveForA?.([d('stale for a', { line: 1 })]);
      await Promise.resolve();
      await Promise.resolve(); // let its own .then run, if it were going to
    });
    expect(editorOn(editorEl).model.markers).toEqual([
      expect.objectContaining({ message: 'current for ab' }),
    ]);
  });

  it('a check diagnostic with no `at` is shown beside the editor, since it cannot be a marker', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'game = Spin' }), {
      checkDiagnostics: [d('no "game { ... }" block found')],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'gam');
    expect(await screen.findByText('no "game { ... }" block found')).toHaveClass(
      'e8-code-diagnostic',
    );
    expect(editorOn(editorEl).model.markers).toEqual([]);
  });

  it('a check diagnostic WITH `at` is a marker only, not also a paragraph', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'game = Spin' }), {
      checkDiagnostics: [d('record block has no name', { line: 1 })],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    await waitFor(() => expect(editorOn(editorEl).model.markers).toHaveLength(1));
    expect(screen.queryByText('record block has no name')).toBeNull();
  });

  it('a file that is already broken shows it on open, before any keystroke', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'record {\n}' }), {
      checkDiagnostics: [d('record block has no name', { line: 1 })],
    });
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    await waitFor(() => expect(ctx.check.calls).toEqual(['record {\n}']));
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'record block has no name' }),
      ]),
    );
  });

  it('a TypeScript file is never checked as .spin', async () => {
    // Measured: one keystroke in `plugins/reel-step/src/step.ts` drew a
    // "game block has no quoted name" warning from `findBlocks` matching
    // `\bgame\b` in TypeScript — a .spin grammar error asserted over code
    // that is not .spin.
    const ctx = await harness(files({ 'plugins/step.ts': 'const game = 1;' }), {
      checkDiagnostics: [d('game block has no quoted name', { line: 1 })],
    });
    render(<EditorDocument ctx={ctx} path="plugins/step.ts" />);
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'const game = 2;');
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the debounce
    expect(ctx.check.calls).toEqual([]);
    expect(editorOn(editorEl).model.markers).toEqual([]);
    expect(screen.queryByText('game block has no quoted name')).toBeNull();
  });

  it('unsaved changes are a shell-level fact, held until saved', async () => {
    // Was "a reload with unsaved changes is held for the browser's own
    // confirm": `beforeunload` is registered once, off
    // `shell.hasDirtyDocuments()`, not by each editor — the document's
    // half is that the fact is true while there is something to lose.
    const ctx = await harness(files({ 'game/script.spin': 'a' }));
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    const editorEl = await screen.findByTestId('editor');
    expect(ctx.shell.hasDirtyDocuments()).toBe(false);
    type(editorEl, 'ab');
    await waitFor(() => expect(ctx.shell.hasDirtyDocuments()).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(ctx.shell.hasDirtyDocuments()).toBe(false));
  });
});

describe('EditorDocument', () => {
  it('typing marks the tab dirty; saving clears it', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'x' }));
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    type(await screen.findByTestId('editor'), 'xy');
    expect(ctx.shell.documents()[0].dirty).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(ctx.shell.documents()[0].dirty).toBe(false));
    expect(ctx.files.written).toEqual([['game/script.spin', [120, 121]]]);
  });

  it('a refused save leaves the tab dirty', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'x' }), {
      writeDiagnostics: [d('outside the project')],
    });
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    type(await screen.findByTestId('editor'), 'xy');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/outside the project/);
    expect(ctx.shell.documents()[0].dirty).toBe(true);
  });

  it('Cmd/Ctrl+S saves', async () => {
    const { ctx, calls } = await harnessWithCalls(files({ 'game/script.spin': 'x' }));
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    type(await screen.findByTestId('editor'), 'xy');
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await waitFor(() =>
      expect(calls.some((u) => u.includes('/api/files/game/script.spin'))).toBe(true),
    );
    expect(ctx.files.written).toEqual([['game/script.spin', [120, 121]]]);
    await userEvent.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(ctx.files.written).toHaveLength(2));
  });

  it('Cmd/Ctrl+S saves the ACTIVE editor only, not every open one', async () => {
    // Every open document stays mounted (Ruling 13), so two editors both
    // hear the one keystroke. Two dirty editors, one keystroke, one write
    // — and it is the active tab's file, not the first-mounted one's.
    const ctx = await harness(files({ 'a.spin': 'x', 'b.spin': 'x' }));
    openTab(ctx, 'a.spin');
    openTab(ctx, 'b.spin');
    // Mounted one after the other, not in one commit: two concurrent
    // `import()`s of the mocked `monacoSlice` leave the second hanging
    // under vitest (a browser dedupes module imports natively), so the
    // second editor would never be created.
    const { rerender } = render(<EditorDocument ctx={ctx} path="a.spin" />);
    const first = await screen.findByTestId('editor');
    await waitFor(() => editorOn(first));
    rerender(
      <>
        <EditorDocument ctx={ctx} path="a.spin" />
        <EditorDocument ctx={ctx} path="b.spin" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(2));
    const editors = screen.getAllByTestId('editor');
    await waitFor(() => editors.forEach((el) => editorOn(el)));
    type(editors[0], 'xa');
    type(editors[1], 'xb');
    ctx.shell.activate('f:a.spin');
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await waitFor(() => expect(ctx.files.written).toHaveLength(1));
    expect(ctx.files.written).toEqual([['a.spin', [120, 97]]]);
    ctx.shell.activate('f:b.spin');
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await waitFor(() => expect(ctx.files.written).toHaveLength(2));
    expect(ctx.files.written[1]).toEqual(['b.spin', [120, 98]]);
  });

  // Debt B2: check diagnostics go to the one list too (spec §8 restored).
  // The module doc used to say they did NOT, because `report()` had no
  // retract; now it has one (debt B1), so a check's rows live exactly as
  // long as the text they answered — replaced by the next check's rows,
  // cleared by a clean check, gone with the editor.
  describe('check diagnostics in the one list', () => {
    /**
     * The messages `connection.diagnostics` holds from THIS editor, in
     * order — `d()` stamps `where: 'test'`; the harness's fake `fetch`
     * also 404s an unrelated boot GET, whose row is not the point here.
     */
    const listed = (ctx: Context) =>
      ctx.connection.diagnostics.filter((x) => x.where === 'test').map((x) => x.message);

    it("a second check replaces the first check's rows", async () => {
      const ctx = await harness(files({ 'game/script.spin': '' }), {
        checkResponder: async (source) => (source === '' ? [] : [d(`bad: ${source}`, { line: 1 })]),
      });
      render(<EditorDocument ctx={ctx} path="game/script.spin" />);
      const editorEl = await screen.findByTestId('editor');

      type(editorEl, 'a');
      await waitFor(() => expect(listed(ctx)).toEqual(['bad: a']));
      type(editorEl, 'ab');
      await waitFor(() => expect(listed(ctx)).toEqual(['bad: ab']));
    });

    it('a check that answers [] leaves nothing in the list', async () => {
      const ctx = await harness(files({ 'game/script.spin': '' }), {
        checkResponder: async (source) => (source === 'a' ? [d('bad: a'), d('also bad: a')] : []),
      });
      render(<EditorDocument ctx={ctx} path="game/script.spin" />);
      const editorEl = await screen.findByTestId('editor');

      type(editorEl, 'a');
      await waitFor(() => expect(listed(ctx)).toEqual(['bad: a', 'also bad: a']));
      type(editorEl, 'ab');
      await waitFor(() => expect(listed(ctx)).toEqual([]));
    });

    it('a refused save is in the list until a later save succeeds', async () => {
      let refuse = true;
      const ctx = await harness(files({ 'game/script.spin': 'x' }));
      // `harness` answers PUT from a fixed `writeDiagnostics`; this test
      // needs the answer to change between two saves, so it swaps the
      // write path itself.
      const realWrite = ctx.files.write.bind(ctx.files);
      ctx.files.write = async (path, bytes) =>
        refuse ? { diagnostics: [d('outside the project')] } : realWrite(path, bytes);
      render(<EditorDocument ctx={ctx} path="game/script.spin" />);
      await screen.findByTestId('editor');

      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(listed(ctx)).toEqual(['outside the project']));

      refuse = false;
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(listed(ctx)).toEqual([]));
      expect(screen.queryByText('outside the project')).toBeNull();
    });

    it('unmounting the editor takes its check and save rows with it', async () => {
      let refuse = true;
      const ctx = await harness(files({ 'game/script.spin': 'x' }), {
        checkDiagnostics: [d('bad on open', { line: 1 })],
      });
      const realWrite = ctx.files.write.bind(ctx.files);
      ctx.files.write = async (path, bytes) =>
        refuse ? { diagnostics: [d('outside the project')] } : realWrite(path, bytes);
      const { unmount } = render(<EditorDocument ctx={ctx} path="game/script.spin" />);
      await screen.findByTestId('editor');
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() =>
        expect(listed(ctx).sort()).toEqual(['bad on open', 'outside the project']),
      );

      unmount();
      expect(listed(ctx)).toEqual([]);
    });
  });

  it('unmounting a dirty editor does not lose the guard racing the tab', async () => {
    // The shell closes the tab only after the confirm says yes; the
    // editor's own unmount must not clear dirty before the shell has
    // asked. The sequence: dirty → unmount → the shell still refuses a
    // plain close → only a forced close goes through.
    const ctx = await harness(files({ 'game/script.spin': 'x' }));
    openTab(ctx, 'game/script.spin');
    const { unmount } = render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    type(await screen.findByTestId('editor'), 'xy');
    expect(ctx.shell.documents()[0].dirty).toBe(true);
    unmount();
    expect(ctx.shell.documents()[0].dirty).toBe(true);
    expect(ctx.shell.close('f:game/script.spin')).toBe(false);
    expect(ctx.shell.documents()).toHaveLength(1);
    expect(ctx.shell.close('f:game/script.spin', { force: true })).toBe(true);
  });
});
